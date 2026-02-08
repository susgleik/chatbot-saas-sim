# Socket Disabled Mode

## Overview

Sim.ai uses Socket.IO for real-time collaborative editing between multiple users working on the same workflow. However, in self-hosted or single-user deployments where no socket server is running, the WebSocket connection attempts cause unnecessary errors.

The `NEXT_PUBLIC_SOCKET_ENABLED` environment variable allows disabling the socket entirely while keeping all workflow editing functionality working in local-only mode.

## Configuration

In `apps/sim/.env`:

```env
# WebSocket (Optional - disable to avoid connection errors when no socket server is running)
NEXT_PUBLIC_SOCKET_ENABLED=false
```

- **`true`** (default): Socket.IO connects normally, collaborative editing is active.
- **`false`**: Socket is never created, all operations work locally without real-time sync.

The variable is defined in `lib/core/config/env.ts` as a boolean with `default(true)`, so omitting it keeps sockets enabled.

## Architecture

### Normal Flow (Socket Enabled)

```
User action (add block, edit subblock, etc.)
  -> useCollaborativeWorkflow.executeQueuedOperation()
     -> isInActiveRoom() check (requires currentWorkflowId to be set)
     -> localAction() applies change to Zustand stores immediately
     -> addToQueue() queues the operation
     -> processNextOperation() emits via socket
     -> Server receives, persists, broadcasts to other clients
     -> Server sends 'operation-confirmed' event
     -> confirmOperation() removes from queue
```

### Socket Disabled Flow

```
User action (add block, edit subblock, etc.)
  -> useCollaborativeWorkflow.executeQueuedOperation()
     -> isInActiveRoom() check (currentWorkflowId set from URL)
     -> localAction() applies change to Zustand stores immediately
     -> addToQueue() queues the operation
     -> processNextOperation() detects isSocketDisabled=true
     -> confirmOperation() auto-confirms and removes from queue immediately
```

## How It Works (3 files modified)

### 1. SocketProvider (`app/workspace/providers/socket-provider.tsx`)

When socket is disabled, the main `useEffect` that creates the Socket.IO connection returns early. However, a separate `useEffect` sets `currentWorkflowId` from the URL params:

```typescript
// When socket is disabled, still track the current workflow from URL
// so that isInActiveRoom() works and local operations can proceed
useEffect(() => {
  if (!isFalsy(getEnv('NEXT_PUBLIC_SOCKET_ENABLED'))) return
  if (!urlWorkflowId) return

  if (currentWorkflowId !== urlWorkflowId) {
    setCurrentWorkflowId(urlWorkflowId)
  }
}, [urlWorkflowId, currentWorkflowId])
```

**Why this is needed**: `currentWorkflowId` is normally set when the socket connects and joins a workflow room. Without this, `isInActiveRoom()` in `use-collaborative-workflow.ts` always returns `false`, silently blocking all operations.

### 2. Operation Queue (`stores/operation-queue/store.ts`)

The `registerEmitFunctions` now accepts a `socketDisabled` flag:

```typescript
let isSocketDisabled = false

export function registerEmitFunctions(
  workflowEmit: ...,
  subblockEmit: ...,
  variableEmit: ...,
  workflowId: string | null,
  socketDisabled?: boolean
) {
  // ... register functions ...
  isSocketDisabled = !!socketDisabled
}
```

In `processNextOperation`, when socket is disabled, operations are auto-confirmed instead of emitted:

```typescript
if (isSocketDisabled) {
  get().confirmOperation(nextOperation.id)
  return
}
```

**Why this is needed**: Without this, operations would be emitted to no-op functions (socket is null), then wait 5-15 seconds for a server confirmation that never arrives, eventually triggering retries and offline mode.

### 3. Collaborative Workflow Hook (`hooks/use-collaborative-workflow.ts`)

Extracts `socket` from `useSocket()` and derives the `socketDisabled` flag:

```typescript
const { socket, ...rest } = useSocket()

const socketDisabled = !socket
useEffect(() => {
  registerEmitFunctions(
    emitWorkflowOperation,
    emitSubblockUpdate,
    emitVariableUpdate,
    currentWorkflowId,
    socketDisabled
  )
}, [emitWorkflowOperation, emitSubblockUpdate, emitVariableUpdate, currentWorkflowId, socketDisabled])
```

## What Works in Disabled Mode

- Adding, moving, editing, and deleting blocks
- Adding and removing edges (connections)
- Editing subblock values (text fields, dropdowns, etc.)
- Loop and parallel configuration
- Variables (add, update, delete)
- Undo/redo
- Workflow saving (via API, not socket)

## What Does NOT Work in Disabled Mode

- Real-time collaboration (seeing other users' cursors/changes)
- Presence indicators (who's editing)
- Server-side operation confirmation (operations are trusted locally)
- Live workflow state sync between browser tabs

## When to Use

- **Self-hosted single-user deployments** where no socket server is running
- **Development** when you don't need collaborative features
- **Cost optimization** (our WhatsApp Bot SaaS architecture) where Sim.ai is used only as a visual editor and doesn't need real-time sync
