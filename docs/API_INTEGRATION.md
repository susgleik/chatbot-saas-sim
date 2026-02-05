# API Integration - SaaS ↔ Sim.ai

## 📋 Summary

This document describes the API integration between the WhatsApp SaaS frontend and the Sim.ai workflow engine.

**Date**: 2026-01-08
**Status**: 🔄 Implementation in progress

---

## 🔗 Sim.ai API Endpoints

### Authentication

Sim.ai uses **Better Auth** for authentication. For API calls from the SaaS, we have two options:

1. **API Keys** (Recommended for server-to-server)
   - Endpoint: `/api/copilot/api-keys`
   - Generate workspace-specific or personal API keys
   - Pass in `Authorization: Bearer <api_key>` header

2. **Session-based** (For embedded UI)
   - Use Better Auth session cookies
   - Requires SSO or shared authentication

### Key Endpoints

#### 1. Workspace Management

**GET /api/v1/admin/workspaces**
- List all workspaces
- Requires admin authentication
- Query params: `limit`, `offset`
- Response:
```typescript
{
  data: Array<{
    id: string
    name: string
    slug: string
    organizationId: string | null
    createdAt: string
    updatedAt: string
  }>
  pagination: {
    total: number
    limit: number
    offset: number
  }
}
```

**POST /api/organizations/[id]/workspaces**
- Create workspace for an organization
- Body:
```typescript
{
  name: string
  slug: string
}
```

#### 2. Workflow Management

**GET /api/workflows**
- Get workflows for a user or workspace
- Query params: `workspaceId` (optional)
- Requires authentication
- Response:
```typescript
{
  data: Array<{
    id: string
    name: string
    description: string
    workspaceId: string
    userId: string
    isDeployed: boolean
    createdAt: string
    updatedAt: string
  }>
}
```

**POST /api/workflows**
- Create a new workflow
- Body:
```typescript
{
  name: string
  description?: string
  color?: string
  workspaceId?: string
  folderId?: string | null
}
```

#### 3. Workflow Execution

**POST /api/webhooks/trigger/[path]**
- Trigger workflow via webhook
- The `[path]` is a unique identifier for the webhook
- Body: Any JSON payload (passed as input to workflow)
- Response:
```typescript
{
  executionId: string
  status: 'queued' | 'running' | 'completed' | 'failed'
}
```

**Important**: The webhook must be configured in Sim.ai first:
1. Workflow must have a "Webhook Trigger" block
2. Webhook is automatically created with a unique path
3. Path format: `/api/webhooks/trigger/[unique-id]`

#### 4. Execution Logs

**GET /api/logs**
- Get workflow execution logs
- Query params: `workflowId`, `limit`, `offset`
- Response:
```typescript
{
  data: Array<{
    id: string
    workflowId: string
    startedAt: string
    endedAt: string
    status: string
    triggerType: string
    input: any
    output: any
    error?: string
  }>
}
```

---

## 🏗️ Integration Architecture

### Data Flow

```
┌─────────────────────────────────────────────────────────────┐
│                      User Actions                            │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              chatbot-saas-frontend (Next.js)                 │
│                                                              │
│  1. Organization created                                     │
│     └──> Trigger: Create workspace in Sim.ai                │
│                                                              │
│  2. WhatsApp message received                                │
│     └──> Find workflow for organization                     │
│     └──> Call Sim.ai webhook endpoint                       │
│                                                              │
│  3. User manages workflows                                   │
│     └──> Embedded Sim.ai UI (iframe or direct)             │
└─────────────────────────────────────────────────────────────┘
                           │
                           │ HTTP/REST API
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              chatbot-saas-sim (Sim.ai)                       │
│                                                              │
│  • Receives API calls                                        │
│  • Authenticates via API key                                │
│  • Executes workflows                                        │
│  • Stores results in sim_engine schema                      │
│  • Returns execution logs                                    │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Supabase PostgreSQL                             │
│                                                              │
│  public.organizations ──sim_workspace_id──> sim_engine.workspace
│  public.workflow_configs ──workflow_id───> sim_engine.workflow
└─────────────────────────────────────────────────────────────┘
```

### Integration Scenarios

#### Scenario 1: Organization Creation

```typescript
// In chatbot-saas-frontend
// After creating organization in Supabase

async function handleOrganizationCreated(orgId: string, orgName: string) {
  // 1. Create workspace in Sim.ai
  const response = await fetch('http://localhost:3000/api/organizations/[id]/workspaces', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SIM_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: orgName,
      slug: `org-${orgId}`
    })
  })

  const { workspace } = await response.json()

  // 2. Update organization with workspace ID
  await supabase
    .from('organizations')
    .update({ sim_workspace_id: workspace.id })
    .eq('id', orgId)
}
```

#### Scenario 2: Execute Workflow on WhatsApp Message

```typescript
// In chatbot-saas-frontend
// WhatsApp webhook handler

async function handleWhatsAppMessage(message: {
  from: string,
  body: string,
  conversationId: string
}) {
  // 1. Get organization from phone number
  const { data: phoneNumber } = await supabase
    .from('phone_numbers')
    .select('organization_id, organizations(sim_workspace_id)')
    .eq('number', message.from)
    .single()

  // 2. Get configured workflow for this organization
  const { data: config } = await supabase
    .from('workflow_configs')
    .select('sim_workflow_id, webhook_path')
    .eq('organization_id', phoneNumber.organization_id)
    .eq('trigger_type', 'whatsapp_message')
    .single()

  if (!config?.webhook_path) {
    // No workflow configured, use default response
    return handleDefaultResponse(message)
  }

  // 3. Execute workflow in Sim.ai
  const response = await fetch(`http://localhost:3000${config.webhook_path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: message.body,
      from: message.from,
      conversationId: message.conversationId,
      timestamp: new Date().toISOString()
    })
  })

  const { executionId, output } = await response.json()

  // 4. Log execution
  await supabase.from('workflow_executions').insert({
    execution_id: executionId,
    conversation_id: message.conversationId,
    workflow_id: config.sim_workflow_id,
    triggered_at: new Date().toISOString()
  })

  // 5. Process workflow output (send response to WhatsApp)
  if (output?.response) {
    await sendWhatsAppMessage(message.from, output.response)
  }
}
```

#### Scenario 3: User Manages Workflows

Option A: **Embedded iframe**
```typescript
// In chatbot-saas-frontend
// Workflow editor page

export default function WorkflowEditor({ workspaceId }: { workspaceId: string }) {
  return (
    <iframe
      src={`http://localhost:3000/workspace/${workspaceId}/workflows`}
      style={{ width: '100%', height: '100vh', border: 'none' }}
      allow="clipboard-write"
    />
  )
}
```

Option B: **Direct navigation**
```typescript
// Redirect to Sim.ai with SSO token
window.location.href = `http://localhost:3000/workspace/${workspaceId}/workflows?token=${ssoToken}`
```

---

## 🔐 Authentication Strategy

### Recommended: API Key Authentication

1. **Generate API Key** (one-time setup):
```typescript
// Run once to generate API key for the SaaS application
const response = await fetch('http://localhost:3000/api/copilot/api-keys/generate', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${adminToken}`, // Initial admin session
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: 'WhatsApp SaaS Integration',
    type: 'personal'
  })
})

const { key } = await response.json()
// Store this key securely in environment variables
```

2. **Use API Key** (in all requests):
```typescript
const headers = {
  'Authorization': `Bearer ${process.env.SIM_API_KEY}`,
  'Content-Type': 'application/json'
}
```

### Alternative: Workspace-Specific API Keys

For multi-tenant security, generate API keys per workspace:

```typescript
// When organization is created
async function createWorkspaceWithAPIKey(orgId: string, orgName: string) {
  // 1. Create workspace
  const workspace = await createWorkspace(orgName)

  // 2. Generate API key for this workspace
  const { key } = await generateAPIKey({
    workspaceId: workspace.id,
    type: 'workspace'
  })

  // 3. Store encrypted key in SaaS database
  await supabase.from('organizations').update({
    sim_workspace_id: workspace.id,
    sim_api_key_encrypted: encrypt(key) // Use encryption
  }).eq('id', orgId)
}
```

---

## 📊 Database Schema Updates

### SaaS Frontend (public schema)

Add these columns to existing tables:

```sql
-- Link organizations to Sim.ai workspaces
ALTER TABLE public.organizations
ADD COLUMN IF NOT EXISTS sim_workspace_id TEXT REFERENCES sim_engine.workspace(id);

-- Store workflow configurations
CREATE TABLE IF NOT EXISTS public.workflow_configs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  sim_workflow_id TEXT NOT NULL, -- References sim_engine.workflow(id)
  webhook_path TEXT, -- Path like /api/webhooks/trigger/abc123
  trigger_type TEXT NOT NULL, -- 'whatsapp_message', 'schedule', 'manual'
  config JSONB, -- Additional configuration
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Track workflow executions
CREATE TABLE IF NOT EXISTS public.workflow_executions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  execution_id TEXT NOT NULL, -- From Sim.ai
  conversation_id UUID REFERENCES public.conversations(id),
  workflow_id TEXT NOT NULL,
  triggered_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  status TEXT, -- 'queued', 'running', 'completed', 'failed'
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_workflow_executions_conversation ON public.workflow_executions(conversation_id);
CREATE INDEX idx_workflow_executions_workflow ON public.workflow_executions(workflow_id);
```

---

## 🚀 Implementation Steps

### Phase 1: Basic Workspace Sync (MVP)

1. **Create API client utility**
   - File: `chatbot-saas-frontend/lib/sim-client.ts`
   - Functions: `createWorkspace()`, `getWorkflows()`, `executeWorkflow()`

2. **Add database migration**
   - File: `chatbot-saas-frontend/supabase/migrations/20260108000000_add_sim_integration.sql`
   - Add columns and tables above

3. **Create workspace on org creation**
   - Hook into organization creation flow
   - Call Sim.ai API to create workspace
   - Update `sim_workspace_id`

### Phase 2: Workflow Execution

4. **Store workflow configuration**
   - UI for linking workflow to organization
   - Store webhook path in `workflow_configs`

5. **Execute workflow on WhatsApp message**
   - Modify WhatsApp webhook handler
   - Call Sim.ai webhook endpoint
   - Process response

### Phase 3: UI Integration

6. **Embed workflow editor**
   - Iframe or direct link to Sim.ai
   - SSO for seamless authentication

### Phase 4: Advanced Features

7. **Bidirectional sync**
   - Webhooks from Sim.ai to SaaS
   - Real-time execution status updates

8. **Analytics**
   - Track workflow performance
   - Cost per execution
   - Usage metrics

---

## 🔧 Environment Variables

### chatbot-saas-frontend

```env
# Sim.ai API
SIM_API_URL=http://localhost:3000
SIM_API_KEY=your-api-key-here

# For production
# SIM_API_URL=https://sim.yourdomain.com
```

### chatbot-saas-sim

```env
# Already configured
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres
BETTER_AUTH_SECRET=...
DISABLE_AUTH=true  # For development only
```

---

## ⚠️ Security Considerations

1. **API Key Storage**
   - NEVER commit API keys to git
   - Use environment variables
   - Encrypt keys in database if stored per-workspace

2. **Rate Limiting**
   - Implement rate limiting on SaaS side
   - Prevent abuse of Sim.ai API

3. **Webhook Validation**
   - Verify webhook signatures (if Sim.ai supports it)
   - Validate payloads before execution

4. **CORS**
   - Configure CORS on Sim.ai if using embedded iframe
   - Whitelist SaaS domain

5. **Data Isolation**
   - Ensure workspace isolation
   - Use workspace-specific API keys for multi-tenancy

---

## 📚 Example: Complete Integration Flow

```typescript
// File: chatbot-saas-frontend/lib/sim-client.ts

const SIM_API_URL = process.env.SIM_API_URL || 'http://localhost:3000'
const SIM_API_KEY = process.env.SIM_API_KEY!

export class SimClient {
  private headers = {
    'Authorization': `Bearer ${SIM_API_KEY}`,
    'Content-Type': 'application/json'
  }

  async createWorkspace(name: string, organizationId?: string) {
    const response = await fetch(`${SIM_API_URL}/api/v1/admin/workspaces`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        name,
        slug: `org-${organizationId || Date.now()}`,
        organizationId
      })
    })

    if (!response.ok) {
      throw new Error(`Failed to create workspace: ${response.statusText}`)
    }

    return response.json()
  }

  async executeWorkflow(webhookPath: string, payload: any) {
    const response = await fetch(`${SIM_API_URL}${webhookPath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })

    if (!response.ok) {
      throw new Error(`Workflow execution failed: ${response.statusText}`)
    }

    return response.json()
  }

  async getWorkflows(workspaceId: string) {
    const response = await fetch(
      `${SIM_API_URL}/api/workflows?workspaceId=${workspaceId}`,
      { headers: this.headers }
    )

    if (!response.ok) {
      throw new Error(`Failed to fetch workflows: ${response.statusText}`)
    }

    return response.json()
  }
}

export const simClient = new SimClient()
```

---

**Last updated**: 2026-01-08
**Author**: Claude Code
**Status**: 🔄 Implementation in progress
