# Workspace Creation System

## 📋 Overview

This document describes the automatic workspace creation system that creates Sim.ai workspaces when new organizations are created in the SaaS platform.

**Status**: ✅ Implemented
**Date**: 2026-01-08

---

## 🏗️ Architecture

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                  New Organization Created                    │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│          Database Trigger: queue_workspace_creation()        │
│  • Fires on INSERT to public.organizations                   │
│  • Adds entry to workspace_creation_queue                    │
│  • Status: 'pending'                                         │
│  • next_retry_at: NOW()                                      │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│           Queue Table: workspace_creation_queue              │
│  • Stores pending workspace creations                        │
│  • Tracks retry attempts and errors                          │
│  • Supports exponential backoff                              │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│          Worker: processWorkspaceCreationQueue()             │
│  • Fetches pending entries from queue                        │
│  • Calls Sim.ai API to create workspace                      │
│  • Updates organization with workspace_id                    │
│  • Marks as completed or failed                              │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                  Sim.ai Workspace Created                    │
│  • Organization.sim_workspace_id updated                     │
│  • Queue entry marked as 'completed'                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 🗄️ Database Schema

### Table: `workspace_creation_queue`

```sql
CREATE TABLE public.workspace_creation_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  organization_name TEXT NOT NULL,

  -- Status tracking
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'processing', 'completed', 'failed'
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,

  -- Result data
  sim_workspace_id TEXT,
  error_message TEXT,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ
);
```

### Trigger: `trigger_create_sim_workspace`

Automatically fires when a new organization is created:

```sql
CREATE TRIGGER trigger_create_sim_workspace
  AFTER INSERT ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION queue_workspace_creation();
```

### Helper Functions

1. **`queue_workspace_creation()`** - Adds entry to queue when org is created
2. **`update_organization_workspace(p_organization_id, p_workspace_id)`** - Updates org with workspace ID
3. **`mark_workspace_creation_failed(p_queue_id, p_error_message)`** - Handles failures with exponential backoff

---

## 🚀 Usage

### Automatic Processing

The queue is processed automatically in two ways:

1. **Via Cron Job** (Recommended for production)
2. **Via API Call** (Manual trigger)

### Option 1: Cron Job Setup

You can set up a cron job to process the queue periodically:

```bash
# Add to crontab (process every 5 minutes)
*/5 * * * * curl -X POST http://localhost:3000/api/workers/process-workspace-queue \
  -H "Authorization: Bearer YOUR_WORKER_TOKEN"
```

Or use a service like:
- **Vercel Cron** (if deployed on Vercel)
- **GitHub Actions** (scheduled workflow)
- **Supabase Edge Function** (with pg_cron extension)

### Option 2: Manual API Call

Process the entire queue manually:

```bash
curl -X POST http://localhost:3000/api/workers/process-workspace-queue \
  -H "Authorization: Bearer YOUR_WORKER_TOKEN" \
  -H "Content-Type: application/json"
```

Response:

```json
{
  "success": true,
  "message": "Workspace creation queue processed",
  "result": {
    "processed": 5,
    "succeeded": 4,
    "failed": 1
  }
}
```

### Option 3: Process Specific Organization

Process a single organization immediately:

```bash
curl -X POST http://localhost:3000/api/workers/process-organization-workspace \
  -H "Authorization: Bearer YOUR_WORKER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"organizationId": "123e4567-e89b-12d3-a456-426614174000"}'
```

### Option 4: Check Status

Check workspace creation status for an organization:

```bash
curl -X GET "http://localhost:3000/api/workers/process-organization-workspace?organizationId=123e4567-e89b-12d3-a456-426614174000" \
  -H "Authorization: Bearer YOUR_WORKER_TOKEN"
```

Response:

```json
{
  "success": true,
  "organizationId": "123e4567-e89b-12d3-a456-426614174000",
  "status": {
    "status": "completed",
    "workspace_id": "ws_abc123",
    "attempts": 1
  }
}
```

---

## ⚙️ Configuration

### Environment Variables

Add to your `.env`:

```env
# Sim.ai API Configuration
SIM_API_URL=http://localhost:3001
SIM_API_KEY=your-sim-api-key-here

# Worker Authentication
WORKER_AUTH_TOKEN=your-secure-worker-token-here

# Supabase Service Role (for queue operations)
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

### Queue Settings

You can adjust queue behavior by modifying the migration:

```sql
-- In 20260108000001_add_workspace_creation_trigger.sql

-- Change max retry attempts (default: 3)
max_attempts INTEGER DEFAULT 3,

-- Change exponential backoff formula (default: 2^attempts minutes)
next_retry_at = NOW() + (INTERVAL '1 minute' * POWER(2, v_attempts))
```

**Retry Schedule Example:**
- Attempt 1: Immediate
- Attempt 2: After 2 minutes (2^1)
- Attempt 3: After 4 minutes (2^2)
- After 3 attempts: Marked as 'failed'

---

## 🔍 Monitoring

### Check Queue Status

Query the queue table to see pending/failed entries:

```sql
-- View pending entries
SELECT * FROM public.workspace_creation_queue
WHERE status = 'pending'
ORDER BY created_at ASC;

-- View failed entries
SELECT * FROM public.workspace_creation_queue
WHERE status = 'failed'
ORDER BY created_at DESC;

-- Count by status
SELECT status, COUNT(*)
FROM public.workspace_creation_queue
GROUP BY status;
```

### View Logs

The worker logs to console with prefix `[WorkspaceCreator]`:

```
[WorkspaceCreator] Starting queue processing...
[WorkspaceCreator] Found 3 pending entries
[WorkspaceCreator] Processing queue entry abc-123 for org MyCompany
[WorkspaceCreator] Creating workspace in Sim.ai for: MyCompany
[WorkspaceCreator] Workspace created: ws_xyz789
[WorkspaceCreator] Successfully linked workspace ws_xyz789 to organization abc-123
[WorkspaceCreator] Completed: 3 succeeded, 0 failed
```

---

## 🐛 Troubleshooting

### Problem: Workspaces Not Being Created

**Check 1: Is the trigger enabled?**

```sql
SELECT tgname, tgenabled
FROM pg_trigger
WHERE tgname = 'trigger_create_sim_workspace';
```

**Check 2: Are there pending entries in the queue?**

```sql
SELECT * FROM public.workspace_creation_queue WHERE status = 'pending';
```

**Check 3: Is the worker being called?**

Check if your cron job is running or manually call the API endpoint.

### Problem: All Attempts Failing

**Check 1: Verify Sim.ai API is reachable**

```bash
curl http://localhost:3001/api/status
```

**Check 2: Verify API key is correct**

```bash
echo $SIM_API_KEY
```

**Check 3: Check error messages in queue**

```sql
SELECT organization_name, error_message, attempts
FROM public.workspace_creation_queue
WHERE status = 'failed';
```

### Problem: Exponential Backoff Not Working

**Check the `next_retry_at` timestamp:**

```sql
SELECT
  organization_name,
  attempts,
  next_retry_at,
  next_retry_at - NOW() as time_until_retry
FROM public.workspace_creation_queue
WHERE status = 'pending';
```

---

## 🔄 Manual Retry

To manually retry a failed workspace creation:

### Option 1: Reset via SQL

```sql
-- Reset a specific entry
UPDATE public.workspace_creation_queue
SET
  status = 'pending',
  attempts = 0,
  error_message = NULL,
  next_retry_at = NOW()
WHERE organization_id = 'your-org-id';
```

### Option 2: Use API Endpoint

```bash
curl -X POST http://localhost:3000/api/workers/process-organization-workspace \
  -H "Authorization: Bearer YOUR_WORKER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"organizationId": "your-org-id"}'
```

---

## 🔐 Security

### API Authentication

The worker endpoints are protected with a bearer token:

```typescript
const authHeader = request.headers.get('authorization')
const expectedToken = process.env.WORKER_AUTH_TOKEN

if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```

**Best Practices:**
- Generate a strong random token for `WORKER_AUTH_TOKEN`
- Never commit this token to version control
- Rotate the token periodically
- Use HTTPS in production

### Database Security

The helper functions use `SECURITY DEFINER` to execute with elevated privileges:

```sql
CREATE OR REPLACE FUNCTION update_organization_workspace(...)
RETURNS VOID AS $$
...
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

This allows the worker (using service role) to update organizations even with RLS enabled.

---

## 📊 Performance

### Batch Processing

The queue processes up to **10 entries at a time** to avoid overwhelming the Sim.ai API:

```typescript
.limit(10) // Process max 10 at a time
```

### Rate Limiting

A **1-second delay** is added between API calls:

```typescript
await new Promise((resolve) => setTimeout(resolve, 1000))
```

For production with higher volume:
- Increase batch size
- Reduce delay between requests
- Consider parallel processing with rate limiting

---

## 🧪 Testing

### Test the Complete Flow

1. **Create a test organization:**

```bash
curl -X POST http://localhost:3000/api/organizations \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Org", "slug": "test-org"}'
```

2. **Verify queue entry was created:**

```sql
SELECT * FROM public.workspace_creation_queue
WHERE organization_name = 'Test Org';
```

3. **Process the queue:**

```bash
curl -X POST http://localhost:3000/api/workers/process-workspace-queue \
  -H "Authorization: Bearer YOUR_WORKER_TOKEN"
```

4. **Verify workspace was created:**

```sql
SELECT id, name, sim_workspace_id
FROM public.organizations
WHERE name = 'Test Org';
```

---

## 📝 Next Steps

After implementing workspace creation, you can:

1. **Implement workflow execution** - Execute workflows when WhatsApp messages arrive
2. **Add UI for workspace management** - Allow users to view/manage their workspace
3. **Implement bidirectional sync** - Keep SaaS and Sim.ai in sync
4. **Add analytics** - Track workspace creation success rates

---

**Last updated**: 2026-01-08
**Author**: Claude Code
**Status**: ✅ Production ready
