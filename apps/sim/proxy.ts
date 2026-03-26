import { db } from '@sim/db'
import * as schema from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { getSessionCookie } from 'better-auth/cookies'
import { eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { isAuthDisabled, isHosted } from './lib/core/config/feature-flags'
import { generateRuntimeCSP } from './lib/core/security/csp'

const logger = createLogger('Proxy')

// ---------------------------------------------------------------------------
// Supabase Auth Bridge
// ---------------------------------------------------------------------------

const SESSION_COOKIE = 'better-auth.session_token'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

interface SupabaseUser {
  id: string
  email: string
  user_metadata?: { full_name?: string; name?: string }
}

async function validateSupabaseToken(token: string): Promise<SupabaseUser | null> {
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) return null
  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: supabaseAnonKey },
    })
    if (!res.ok) return null
    return (await res.json()) as SupabaseUser
  } catch {
    return null
  }
}

async function upsertBridgeSession(supabaseUser: SupabaseUser): Promise<string | null> {
  try {
    const userId = `supabase_${supabaseUser.id}`
    const email = supabaseUser.email
    const name =
      supabaseUser.user_metadata?.full_name ??
      supabaseUser.user_metadata?.name ??
      email.split('@')[0]
    const now = new Date()

    await db
      .insert(schema.user)
      .values({ id: userId, name, email, emailVerified: true, createdAt: now, updatedAt: now })
      .onConflictDoUpdate({ target: schema.user.email, set: { name, updatedAt: now } })

    const existingUser = await db.query.user.findFirst({ where: eq(schema.user.email, email) })
    if (!existingUser) return null

    const token = crypto.randomUUID()
    await db.insert(schema.session).values({
      id: crypto.randomUUID(),
      token,
      userId: existingUser.id,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      createdAt: now,
      updatedAt: now,
    })

    logger.info('Auth bridge: session created', { email })
    return token
  } catch (err) {
    logger.error('Auth bridge: failed to upsert session', { err })
    return null
  }
}

const SUSPICIOUS_UA_PATTERNS = [
  /^\s*$/, // Empty user agents
  /\.\./, // Path traversal attempt
  /<\s*script/i, // Potential XSS payloads
  /^\(\)\s*{/, // Command execution attempt
  /\b(sqlmap|nikto|gobuster|dirb|nmap)\b/i, // Known scanning tools
] as const

/**
 * Handles authentication-based redirects for root paths
 */
function handleRootPathRedirects(
  request: NextRequest,
  hasActiveSession: boolean,
  base: string
): NextResponse | null {
  const url = request.nextUrl

  if (url.pathname !== '/') {
    return null
  }

  if (!isHosted) {
    // Self-hosted: Always redirect based on session
    if (hasActiveSession) {
      return NextResponse.redirect(new URL(`${base}/workspace`, request.url))
    }
    return NextResponse.redirect(new URL(`${base}/login`, request.url))
  }

  // For root path, redirect authenticated users to workspace
  // Unless they have a 'from' query parameter (e.g., ?from=nav, ?from=settings)
  // This allows intentional navigation to the homepage from anywhere in the app
  if (hasActiveSession) {
    const from = url.searchParams.get('from')
    if (!from) {
      return NextResponse.redirect(new URL(`${base}/workspace`, request.url))
    }
  }

  return null
}

/**
 * Handles invitation link redirects for unauthenticated users
 */
function handleInvitationRedirects(
  request: NextRequest,
  hasActiveSession: boolean,
  base: string
): NextResponse | null {
  if (!request.nextUrl.pathname.startsWith('/invite/')) {
    return null
  }

  if (
    !hasActiveSession &&
    !request.nextUrl.pathname.endsWith('/login') &&
    !request.nextUrl.pathname.endsWith('/signup') &&
    !request.nextUrl.search.includes('callbackUrl')
  ) {
    const token = request.nextUrl.searchParams.get('token')
    const inviteId = request.nextUrl.pathname.split('/').pop()
    const callbackParam = encodeURIComponent(`/invite/${inviteId}${token ? `?token=${token}` : ''}`)
    return NextResponse.redirect(
      new URL(`${base}/login?callbackUrl=${callbackParam}&invite_flow=true`, request.url)
    )
  }
  return NextResponse.next()
}

/**
 * Handles workspace invitation API endpoint access
 */
function handleWorkspaceInvitationAPI(
  request: NextRequest,
  hasActiveSession: boolean,
  base: string
): NextResponse | null {
  if (!request.nextUrl.pathname.startsWith('/api/workspaces/invitations')) {
    return null
  }

  if (request.nextUrl.pathname.includes('/accept') && !hasActiveSession) {
    const token = request.nextUrl.searchParams.get('token')
    if (token) {
      return NextResponse.redirect(new URL(`${base}/invite/${token}?token=${token}`, request.url))
    }
  }
  return NextResponse.next()
}

/**
 * Handles security filtering for suspicious user agents
 */
function handleSecurityFiltering(request: NextRequest): NextResponse | null {
  const userAgent = request.headers.get('user-agent') || ''
  const isWebhookEndpoint = request.nextUrl.pathname.startsWith('/api/webhooks/trigger/')
  const isSuspicious = SUSPICIOUS_UA_PATTERNS.some((pattern) => pattern.test(userAgent))

  // Block suspicious requests, but exempt webhook endpoints from User-Agent validation
  if (isSuspicious && !isWebhookEndpoint) {
    logger.warn('Blocked suspicious request', {
      userAgent,
      ip: request.headers.get('x-forwarded-for') || 'unknown',
      url: request.url,
      method: request.method,
      pattern: SUSPICIOUS_UA_PATTERNS.find((pattern) => pattern.test(userAgent))?.toString(),
    })

    return new NextResponse(null, {
      status: 403,
      statusText: 'Forbidden',
      headers: {
        'Content-Type': 'text/plain',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'none'",
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        Pragma: 'no-cache',
        Expires: '0',
      },
    })
  }

  return null
}

export async function proxy(request: NextRequest) {
  const url = request.nextUrl
  const base = url.basePath // '/sim' when basePath is configured, '' otherwise

  // Auth bridge: if x-supabase-token is present and no Better Auth session exists,
  // validate the JWT and create a session transparently.
  let bridgeToken: string | null = null
  const supabaseToken = request.headers.get('x-supabase-token')
  if (supabaseToken && !getSessionCookie(request)) {
    const supabaseUser = await validateSupabaseToken(supabaseToken)
    if (supabaseUser?.email) {
      bridgeToken = await upsertBridgeSession(supabaseUser)
    }
  }

  const sessionCookie = bridgeToken ?? getSessionCookie(request)
  const hasActiveSession = isAuthDisabled || !!sessionCookie

  // Helper: attach the new session cookie to any response produced in this request.
  const withBridgeCookie = (response: NextResponse): NextResponse => {
    if (bridgeToken) {
      response.cookies.set(SESSION_COOKIE, bridgeToken, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: SESSION_TTL_MS / 1000,
      })
    }
    return response
  }

  const redirect = handleRootPathRedirects(request, hasActiveSession, base)
  if (redirect) return withBridgeCookie(redirect)

  if (url.pathname === '/login' || url.pathname === '/signup') {
    if (hasActiveSession) {
      return withBridgeCookie(NextResponse.redirect(new URL(`${base}/workspace`, request.url)))
    }
    const response = NextResponse.next()
    response.headers.set('Content-Security-Policy', generateRuntimeCSP())
    return withBridgeCookie(response)
  }

  if (url.pathname.startsWith('/chat/')) {
    return withBridgeCookie(NextResponse.next())
  }

  // Allow public access to template pages for SEO
  if (url.pathname.startsWith('/templates')) {
    return withBridgeCookie(NextResponse.next())
  }

  if (url.pathname.startsWith('/workspace')) {
    // Allow public access to workspace template pages - they handle their own redirects
    if (url.pathname.match(/^\/workspace\/[^/]+\/templates/)) {
      return withBridgeCookie(NextResponse.next())
    }

    if (!hasActiveSession) {
      return withBridgeCookie(NextResponse.redirect(new URL(`${base}/login`, request.url)))
    }
    return withBridgeCookie(NextResponse.next())
  }

  const invitationRedirect = handleInvitationRedirects(request, hasActiveSession, base)
  if (invitationRedirect) return withBridgeCookie(invitationRedirect)

  const workspaceInvitationRedirect = handleWorkspaceInvitationAPI(request, hasActiveSession, base)
  if (workspaceInvitationRedirect) return withBridgeCookie(workspaceInvitationRedirect)

  const securityBlock = handleSecurityFiltering(request)
  if (securityBlock) return securityBlock // No bridge cookie on security blocks

  const response = NextResponse.next()
  response.headers.set('Vary', 'User-Agent')

  if (
    url.pathname.startsWith('/workspace') ||
    url.pathname.startsWith('/chat') ||
    url.pathname === '/'
  ) {
    response.headers.set('Content-Security-Policy', generateRuntimeCSP())
  }

  return withBridgeCookie(response)
}

export const config = {
  matcher: [
    '/', // Root path for self-hosted redirect logic
    '/terms', // Whitelabel terms redirect
    '/privacy', // Whitelabel privacy redirect
    '/w', // Legacy /w redirect
    '/w/:path*', // Legacy /w/* redirects
    '/workspace/:path*', // New workspace routes
    '/login',
    '/signup',
    '/invite/:path*', // Match invitation routes
    // Catch-all for other pages, excluding static assets and public directories
    '/((?!_next/static|_next/image|favicon.ico|logo/|static/|footer/|social/|enterprise/|favicon/|twitter/|robots.txt|sitemap.xml).*)',
  ],
}
