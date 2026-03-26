'use client'

import { useCallback, useEffect, useRef } from 'react'
import { createLogger } from '@sim/logger'
import { getEnv, isFalsy } from '@/lib/core/config/env'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

const logger = createLogger('AutoSaveWorkflow')

const AUTO_SAVE_DEBOUNCE_MS = 3000 // Save 3 seconds after last change

/**
 * Hook that auto-saves workflow state to the database when socket is disabled.
 *
 * In normal mode (socket enabled), every operation is persisted by the socket server.
 * When socket is disabled, operations are only applied locally. This hook bridges
 * that gap by periodically saving the full workflow state via PUT /api/workflows/{id}/state.
 */
export function useAutoSaveWorkflow() {
  const isSocketDisabled = isFalsy(getEnv('NEXT_PUBLIC_SOCKET_ENABLED'))
  const activeWorkflowId = useWorkflowRegistry((s) => s.activeWorkflowId)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isSavingRef = useRef(false)
  const lastSavedHashRef = useRef<string>('')

  const saveWorkflowState = useCallback(async () => {
    if (!activeWorkflowId || isSavingRef.current) return

    const workflowState = useWorkflowStore.getState().getWorkflowState()
    const mergedBlocks = mergeSubblockState(workflowState.blocks, activeWorkflowId)

    // Simple hash to detect actual changes
    const stateHash = JSON.stringify({
      blocks: mergedBlocks,
      edges: workflowState.edges,
      loops: workflowState.loops,
      parallels: workflowState.parallels,
    })

    if (stateHash === lastSavedHashRef.current) {
      logger.debug('No changes detected, skipping auto-save')
      return
    }

    isSavingRef.current = true
    try {
      const payload = {
        blocks: mergedBlocks,
        edges: workflowState.edges,
        loops: workflowState.loops || {},
        parallels: workflowState.parallels || {},
        lastSaved: Date.now(),
      }

      const response = await fetch(`/api/workflows/${activeWorkflowId}/state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (response.ok) {
        lastSavedHashRef.current = stateHash
        useWorkflowStore.setState({ lastSaved: Date.now() })
        logger.info(`Auto-saved workflow ${activeWorkflowId} to database`)
      } else {
        const errorText = await response.text().catch(() => '')
        logger.error(`Auto-save failed for workflow ${activeWorkflowId}: ${response.status}`, errorText)
      }
    } catch (error) {
      logger.error('Auto-save error:', error)
    } finally {
      isSavingRef.current = false
    }
  }, [activeWorkflowId])

  // Subscribe to workflow store changes and debounce saves
  useEffect(() => {
    if (!isSocketDisabled || !activeWorkflowId) return

    logger.info(`Auto-save enabled for workflow ${activeWorkflowId} (socket disabled mode)`)

    // Subscribe to both workflow store AND subblock store changes
    const unsubWorkflow = useWorkflowStore.subscribe(() => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(saveWorkflowState, AUTO_SAVE_DEBOUNCE_MS)
    })

    const unsubSubblock = useSubBlockStore.subscribe(() => {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(saveWorkflowState, AUTO_SAVE_DEBOUNCE_MS)
    })

    // Save when page is about to unload (fire pending save immediately)
    const handleBeforeUnload = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      // Use synchronous XHR as last resort to save before page closes
      try {
        const workflowState = useWorkflowStore.getState().getWorkflowState()
        const mergedBlocks = mergeSubblockState(workflowState.blocks, activeWorkflowId)
        const payload = JSON.stringify({
          blocks: mergedBlocks,
          edges: workflowState.edges,
          loops: workflowState.loops || {},
          parallels: workflowState.parallels || {},
          lastSaved: Date.now(),
        })
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', `/api/workflows/${activeWorkflowId}/state`, false) // synchronous
        xhr.setRequestHeader('Content-Type', 'application/json')
        xhr.send(payload)
      } catch {
        // Best effort - page is closing
      }
    }

    window.addEventListener('beforeunload', handleBeforeUnload)

    return () => {
      unsubWorkflow()
      unsubSubblock()
      window.removeEventListener('beforeunload', handleBeforeUnload)
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
        // Trigger one final save on cleanup
        saveWorkflowState()
      }
    }
  }, [isSocketDisabled, activeWorkflowId, saveWorkflowState])
}
