import { toNextJsHandler } from 'better-auth/next-js'
import { type NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { createAnonymousSession, ensureAnonymousUserExists } from '@/lib/auth/anonymous'
import { isAuthDisabled } from '@/lib/core/config/feature-flags'

export const dynamic = 'force-dynamic'

const { GET: betterAuthGET, POST: betterAuthPOST } = toNextJsHandler(auth.handler)

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  // Use split to handle basePath prefix (/sim/api/auth/... or /api/auth/...)
  const path = url.pathname.split('/api/auth/').pop() ?? ''

  if (path === 'get-session' && isAuthDisabled) {
    try {
      await ensureAnonymousUserExists()
    } catch (err) {
      console.error('[auth route] ensureAnonymousUserExists failed:', err)
    }
    return NextResponse.json(createAnonymousSession())
  }

  return betterAuthGET(request)
}

export const POST = betterAuthPOST
