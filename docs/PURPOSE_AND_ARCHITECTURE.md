# Chatbot SaaS Sim - Purpose and Architecture

## 📋 Summary

This document explains the purpose of the `chatbot-saas-sim` repository, why it exists, and how it integrates with the WhatsApp Bot SaaS project.

**Date**: 2026-01-08
**Repository**: Fork of [Sim.ai](https://github.com/sim-ai/sim) for SaaS integration

---

## 🎯 What is chatbot-saas-sim?

### Sim.ai - Workflow Engine

`chatbot-saas-sim` is a **fork of the Sim.ai project**, a visual workflow engine (low-code) designed for:

- **Creating complex workflows** through a visual drag-and-drop interface
- **Integrating multiple services** (APIs, databases, AI tools)
- **Executing custom business logic** without needing to write code
- **Managing states and contexts** throughout conversations or processes

### Why a fork?

A separate fork was created instead of using Sim.ai directly because:

1. **SaaS-specific needs**: Requires custom integrations with the SaaS database
2. **Dependency control**: Allows managing versions and updates independently
3. **Schema customization**: Needs separate PostgreSQL schema (`sim_engine`) to coexist with the SaaS
4. **Parallel development**: Allows working on SaaS features without depending on Sim.ai upstream

---

## 🔗 Integration with WhatsApp Bot SaaS

### Global Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Supabase PostgreSQL                        │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌─────────────────────┐         ┌──────────────────────┐   │
│  │   public schema     │         │  sim_engine schema   │   │
│  │   (SaaS Tables)     │◄────┐   │  (Sim.ai Tables)     │   │
│  └─────────────────────┘     │   └──────────────────────┘   │
│                               │                               │
│  • organizations ─────────────┘                               │
│    - sim_workspace_id ────────────► workspace                 │
│  • users (SaaS)                     • user (Sim.ai)           │
│  • phone_numbers                    • workflow                │
│  • conversations                    • workflow_blocks         │
│  • messages                         • workflow_edges          │
│  • workflow_configs                 • workflow_executions     │
│                                     • settings                │
│                                     • api_key                 │
└──────────────────────────────────────────────────────────────┘
         ▲                                      ▲
         │                                      │
         │                                      │
┌────────┴─────────────┐           ┌───────────┴──────────────┐
│  chatbot-saas-       │           │  chatbot-saas-sim        │
│  frontend            │           │  (Sim.ai Fork)           │
│                      │           │                          │
│  Next.js App         │◄─────────►│  Next.js App             │
│  • Supabase Auth     │   API     │  • Better Auth           │
│  • SaaS UI           │           │  • Workflow Canvas       │
│  • Org Management    │           │  • Workflow Execution    │
│  • WhatsApp Manager  │           │  • Visual Editor         │
└──────────────────────┘           └──────────────────────────┘
         │                                      │
         │                                      │
         ▼                                      ▼
┌──────────────────────────────────────────────────────────────┐
│                      WhatsApp Business API                    │
│                   (Twilio / Meta Cloud API)                   │
└──────────────────────────────────────────────────────────────┘
```

### Workflow Flow

1. **SaaS user creates an organization** in `chatbot-saas-frontend`
   - A record is created in `public.organizations`
   - A `workspace` is automatically created in `sim_engine.workspace`
   - They are linked via `sim_workspace_id`

2. **User designs a workflow** in the Sim.ai Canvas
   - Uses the visual editor from `chatbot-saas-sim`
   - Workflows are saved in `sim_engine.workflow`
   - Workflow blocks are saved in `sim_engine.workflow_blocks`

3. **User configures WhatsApp Bot** in the SaaS frontend
   - Connects a WhatsApp number
   - Selects which workflow to execute for conversations
   - Configures triggers (keywords, schedules, webhooks)

4. **WhatsApp message arrives**
   - WhatsApp webhook reaches the SaaS frontend
   - Frontend identifies the organization and configured workflow
   - Corresponding workflow is executed in Sim.ai
   - The workflow can:
     - Respond automatically
     - Query databases
     - Call external APIs
     - Make AI-based decisions
     - Log information in CRM

---

## 💡 Why Sim.ai for this project?

### Problems it solves

#### Without Sim.ai (Traditional approach):
```typescript
// Hardcoded code for each conversation flow
if (message.includes('price')) {
  await sendMessage(phone, 'Prices are...')
} else if (message.includes('schedule')) {
  await sendMessage(phone, 'Schedule: ...')
} else if (message.includes('buy')) {
  // Complex hardcoded purchase logic
  // ...
}
```

**Problems**:
- ❌ Each change requires code modification and redeploy
- ❌ Not scalable for multiple clients with different needs
- ❌ Difficult to maintain and test
- ❌ Clients cannot customize without developers

#### With Sim.ai (Workflow approach):
```
Client designs visually:
[Trigger: Message received]
  ↓
[Condition: Contains "price"?]
  ├─ Yes → [Send price message]
  └─ No → [Condition: Contains "schedule"?]
            ├─ Yes → [Query DB] → [Send schedule]
            └─ No → [AI: Generic response]
```

**Benefits**:
- ✅ Clients create and modify workflows without code
- ✅ Real-time changes without redeploy
- ✅ Scalable: each organization has its own workflows
- ✅ Visual and easy to understand
- ✅ Reusable: common workflow templates

### Sim.ai Capabilities

1. **Visual Editor (Canvas)**
   - Drag & drop blocks
   - Visual connections between steps
   - Real-time preview

2. **Pre-built Blocks**
   - HTTP Requests (call APIs)
   - Database Queries (query data)
   - AI Models (ChatGPT, Claude, etc.)
   - Conditionals (if/else, switch)
   - Loops (repeat actions)
   - Transformers (manipulate data)

3. **Robust Execution**
   - Detailed execution logs
   - Automatic error handling
   - Configurable retries
   - Webhooks for external triggers
   - Scheduling (cron jobs)

4. **Multi-tenancy**
   - Isolated workspaces per organization
   - Granular permissions
   - Environment variables per workspace
   - API keys per workspace

---

## 🏗️ Real Use Cases

### Case 1: E-commerce with WhatsApp

**Workflow flow**:
```
[Webhook: WhatsApp Message] → "Hello, I want to buy"
  ↓
[AI: Extract intent] → "purchase"
  ↓
[DB Query: Get client catalog]
  ↓
[AI: Recommend products based on history]
  ↓
[HTTP: Send message with products and prices]
  ↓
[Wait for response]
  ↓
[Conditional: Did user choose product?]
  ├─ Yes → [Create order in DB]
  │        ↓
  │       [API: Process payment]
  │        ↓
  │       [Send confirmation]
  │
  └─ No → [Loop: Offer alternatives]
```

**Without Sim.ai**: Would require weeks of custom development per client.

**With Sim.ai**: Client creates workflow in hours using templates.

### Case 2: Automated Technical Support

**Workflow flow**:
```
[Webhook: Message] → "My product doesn't work"
  ↓
[AI: Classify problem] → Category: "Technical - Hardware"
  ↓
[DB: Search common solutions]
  ↓
[Conditional: Solution found?]
  ├─ Yes → [Send troubleshooting steps]
  │        ↓
  │       [Wait for confirmation]
  │        ↓
  │       [Did it work?]
  │          ├─ Yes → [Close ticket]
  │          └─ No → [Escalate to human]
  │
  └─ No → [Create ticket in system]
           ↓
          [Notify technical team]
           ↓
          [Send "An agent will contact you"]
```

**Benefit**: Reduces 70% of basic inquiries without human intervention.

### Case 3: Marketing Campaigns

**Workflow flow**:
```
[Schedule: Every Monday 9am]
  ↓
[DB: Get active customers]
  ↓
[Loop: For each customer]
  ↓
  [DB: Get last purchase]
  ↓
  [Conditional: More than 30 days ago?]
    ├─ Yes → [AI: Generate personalized message]
    │        ↓
    │       [HTTP: Send message with discount]
    │        ↓
    │       [Log: Register send in analytics]
    │
    └─ No → [Skip]
```

**Benefit**: Automatic personalized campaigns without code.

---

## 🔧 Technical Configuration

### System Requirements

1. **Shared database**
   - PostgreSQL (via Supabase)
   - Separate schemas: `public` (SaaS) and `sim_engine` (Sim.ai)

2. **Separate authentication**
   - SaaS: Supabase Auth
   - Sim.ai: Better Auth (independent)

3. **Environment variables**
   ```env
   # Sim.ai
   DATABASE_URL=postgresql://postgres:password@localhost:54322/postgres
   BETTER_AUTH_SECRET=...
   DISABLE_AUTH=true  # For local development

   # SaaS Frontend
   NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
   NEXT_PUBLIC_SUPABASE_ANON_KEY=...
   ```

### Data Mapping

| SaaS (public)          | Sim.ai (sim_engine)    | Relationship                 |
|------------------------|------------------------|------------------------------|
| organizations          | workspace              | 1:1 via sim_workspace_id     |
| users (SaaS)           | user (Sim.ai)          | Separate (different auth)    |
| workflow_configs       | workflow               | Reference to workflow_id     |
| conversations          | workflow_execution_logs| Executes workflows per convo |

### Integration API

**Example endpoint**: Execute workflow from SaaS

```typescript
// In chatbot-saas-frontend
async function executeWorkflow(organizationId: string, input: any) {
  // 1. Get workspace_id from organization
  const { data: org } = await supabase
    .from('organizations')
    .select('sim_workspace_id')
    .eq('id', organizationId)
    .single()

  // 2. Call Sim.ai API
  const response = await fetch('http://localhost:3000/api/workflows/execute', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SIM_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      workspaceId: org.sim_workspace_id,
      workflowId: 'workflow-uuid',
      input: input
    })
  })

  return response.json()
}
```

---

## 🚀 Approach Benefits

### For Developers

1. **Separation of concerns**
   - SaaS: UI, authentication, client management
   - Sim.ai: Business logic, workflows, execution

2. **Independent maintenance**
   - Sim.ai updates don't break SaaS
   - Each system can scale separately

3. **Easier testing**
   - Workflows can be tested in isolation
   - Simpler mocks

### For Business

1. **Flexibility**
   - Each client can have completely different workflows
   - No hardcoded logic limitations

2. **Scalability**
   - Adding new clients is trivial (just create workspace)
   - No custom development required

3. **Time to Market**
   - Clients can activate features without waiting for releases
   - Rapid iteration based on feedback

### For End Clients

1. **Autonomy**
   - Create and modify workflows without depending on support
   - Full control over their business logic

2. **Visual and accessible**
   - No programming knowledge required
   - Low learning curve

3. **Unlimited customization**
   - Integrations with their own systems
   - Industry-specific workflows

---

## 📊 Metrics and Monitoring

### What can be tracked

1. **Workflow executions**
   - Total executions per organization
   - Average execution time
   - Success/error rate

2. **Block usage**
   - Most used blocks
   - Most called APIs
   - Most utilized AI models

3. **Billing**
   - Cost per execution (AI tokens, API calls)
   - Limits per plan
   - Usage alerts

### Example Query

```sql
-- Get usage statistics for an organization
SELECT
  w.name as workflow_name,
  COUNT(wel.id) as total_executions,
  AVG(EXTRACT(EPOCH FROM (wel.ended_at - wel.started_at))) as avg_duration_seconds,
  SUM(CASE WHEN wel.status = 'failed' THEN 1 ELSE 0 END) as failed_count
FROM sim_engine.workspace ws
JOIN sim_engine.workflow w ON w.workspace_id = ws.id
JOIN sim_engine.workflow_execution_logs wel ON wel.workflow_id = w.id
WHERE ws.id = (
  SELECT sim_workspace_id
  FROM public.organizations
  WHERE id = 'org-uuid'
)
GROUP BY w.id, w.name
ORDER BY total_executions DESC;
```

---

## 🔒 Security and Isolation

### Isolation Guarantees

1. **Schema Level**: Tables in separate schemas (`public` vs `sim_engine`)
2. **Workspace Level**: Each organization has its isolated workspace
3. **Permission Level**: RLS (Row Level Security) in Supabase
4. **API Level**: API keys per workspace

### Cross-Tenant Leakage Prevention

```sql
-- Example RLS policy
CREATE POLICY "Users can only access their workspace data"
  ON sim_engine.workflow
  FOR ALL
  USING (
    workspace_id IN (
      SELECT ws.id
      FROM sim_engine.workspace ws
      JOIN public.organizations org ON org.sim_workspace_id = ws.id
      JOIN public.organization_members om ON om.organization_id = org.id
      WHERE om.user_id = auth.uid()
    )
  );
```

---

## 🔄 Roadmap and Evolution

### Current Phase: MVP
- ✅ Schema separation implemented
- ✅ Core table migrations completed
- ✅ Organizations ↔ workspaces mapping
- 🔄 SaaS ↔ Sim.ai API integration (in progress)

### Next Steps
1. **Unified authentication**: SSO between SaaS and Sim.ai
2. **Embedded UI**: Embed Sim.ai canvas in SaaS frontend
3. **Workflow templates**: Library of pre-built workflows
4. **Analytics dashboard**: Real-time usage metrics

### Long-term Future
- **Block marketplace**: Third-party custom extensions
- **Multi-region**: Distribute executions geographically
- **Edge computing**: Execute workflows closer to end users

---

## 📚 References

- [Sim.ai GitHub](https://github.com/sim-ai/sim)
- [Sim.ai Self-Hosted Docs](https://docs.sim.ai/self-hosted)
- [Supabase Multi-Schema](https://supabase.com/docs/guides/database/schemas)
- [PostgreSQL Schema Documentation](https://www.postgresql.org/docs/current/ddl-schemas.html)

---

## 🎓 Key Concepts

| Term               | Definition                                                                 |
|--------------------|---------------------------------------------------------------------------|
| **Workflow**       | Visual workflow that defines a sequence of actions                        |
| **Workspace**      | Isolated container for workflows of an organization                       |
| **Block**          | Basic unit of a workflow (e.g.: HTTP request, conditional, AI)          |
| **Execution**      | Execution instance of a workflow with specific inputs                     |
| **Schema**         | PostgreSQL namespace to group related tables                              |
| **Fork**           | Independent copy of a repository for custom development                   |

---

**Last updated**: 2026-01-08
**Author**: Claude Code
**Status**: ✅ Complete documentation