/**
 * GET /api/v1/admin/workspaces — List all workspaces with pagination.
 * POST /api/v1/admin/workspaces — Create a workspace for a specific user (SaaS bridge).
 *
 * Both routes require x-admin-key header.
 */

import { db } from '@sim/db'
import { permissions, workspace } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { count } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import { withAdminAuth } from '@/app/api/v1/admin/middleware'
import {
  badRequestResponse,
  internalErrorResponse,
  listResponse,
  singleResponse,
} from '@/app/api/v1/admin/responses'
import {
  type AdminWorkspace,
  createPaginationMeta,
  parsePaginationParams,
  toAdminWorkspace,
} from '@/app/api/v1/admin/types'

const logger = createLogger('AdminWorkspacesAPI')

const createWorkspaceSchema = z.object({
  userId: z.string().min(1),
  name: z.string().trim().min(1),
})

export const GET = withAdminAuth(async (request) => {
  const url = new URL(request.url)
  const { limit, offset } = parsePaginationParams(url)

  try {
    const [countResult, workspaces] = await Promise.all([
      db.select({ total: count() }).from(workspace),
      db.select().from(workspace).orderBy(workspace.name).limit(limit).offset(offset),
    ])

    const total = countResult[0].total
    const data: AdminWorkspace[] = workspaces.map(toAdminWorkspace)
    const pagination = createPaginationMeta(total, limit, offset)

    logger.info(`Admin API: Listed ${data.length} workspaces (total: ${total})`)

    return listResponse(data, pagination)
  } catch (error) {
    logger.error('Admin API: Failed to list workspaces', { error })
    return internalErrorResponse('Failed to list workspaces')
  }
})

export const POST = withAdminAuth(async (request) => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return badRequestResponse('Invalid JSON body')
  }

  const parsed = createWorkspaceSchema.safeParse(body)
  if (!parsed.success) {
    return badRequestResponse('userId and name are required', parsed.error.flatten())
  }

  const { userId, name } = parsed.data
  const workspaceId = crypto.randomUUID()
  const now = new Date()

  try {
    await db.transaction(async (tx) => {
      await tx.insert(workspace).values({
        id: workspaceId,
        name,
        ownerId: userId,
        billedAccountUserId: userId,
        allowPersonalApiKeys: true,
        createdAt: now,
        updatedAt: now,
      })

      await tx.insert(permissions).values({
        id: crypto.randomUUID(),
        entityType: 'workspace' as const,
        entityId: workspaceId,
        userId,
        permissionType: 'admin' as const,
        createdAt: now,
        updatedAt: now,
      })
    })

    logger.info(`Admin API: Workspace ${workspaceId} created for user ${userId}`)

    return singleResponse({
      id: workspaceId,
      name,
      ownerId: userId,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    })
  } catch (error) {
    logger.error('Admin API: Failed to create workspace', { error, userId, name })
    return internalErrorResponse('Failed to create workspace')
  }
})
