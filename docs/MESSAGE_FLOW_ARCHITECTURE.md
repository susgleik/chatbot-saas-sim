# WhatsApp Bot SaaS - Message Flow Architecture

## Overview

This document describes the complete message flow from when a WhatsApp user sends a message until they receive a response. It reflects the current architecture where **FastAPI is the central brain** that receives webhooks, processes messages, and orchestrates responses.

**Last Updated**: 2026-02-04
**Version**: 2.0 (Post-OpenAI removal)

---

## System Components

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SYSTEM ARCHITECTURE                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │   WhatsApp   │    │   FastAPI    │    │   Sim.ai     │                  │
│  │   Users      │◄──►│   Backend    │◄──►│   Engine     │                  │
│  │              │    │   (Brain)    │    │  (Workflows) │                  │
│  └──────────────┘    └──────────────┘    └──────────────┘                  │
│                             │                    │                          │
│                             ▼                    ▼                          │
│                      ┌─────────────────────────────────────┐               │
│                      │         Supabase PostgreSQL          │               │
│                      │  ┌─────────────┬─────────────────┐  │               │
│                      │  │   public    │   sim_engine    │  │               │
│                      │  │   schema    │     schema      │  │               │
│                      │  └─────────────┴─────────────────┘  │               │
│                      └─────────────────────────────────────┘               │
│                             │                                               │
│                      ┌──────┴──────┐                                       │
│                      │    Redis    │                                       │
│                      │  (Context)  │                                       │
│                      └─────────────┘                                       │
│                                                                              │
│  ┌──────────────┐                                                          │
│  │   Frontend   │  Admin UI for managing organizations, users,             │
│  │   SaaS       │  phone numbers, and embedded Sim.ai canvas               │
│  └──────────────┘                                                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Complete Message Flow

### Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        COMPLETE MESSAGE FLOW                                 │
└─────────────────────────────────────────────────────────────────────────────┘

     ┌─────────┐
     │ Usuario │
     │WhatsApp │
     └────┬────┘
          │
          │ 1. Envía mensaje "Hola, quiero saber los precios"
          ▼
┌─────────────────────┐
│   Meta Cloud API    │
│  (WhatsApp Business)│
└──────────┬──────────┘
           │
           │ 2. Webhook POST /api/v1/webhook
           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                         FASTAPI BACKEND                                   │
│                         (whatsapp-bot-saas)                              │
├──────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  3. VALIDACIÓN                                                           │
│  ┌────────────────────────────────────────────────────┐                  │
│  │ • Verificar firma del webhook (X-Hub-Signature)    │                  │
│  │ • Parsear payload de WhatsApp                      │                  │
│  │ • Extraer: from_number, message_text, phone_id     │                  │
│  └────────────────────────────────────────────────────┘                  │
│                          │                                                │
│                          ▼                                                │
│  4. IDENTIFICACIÓN DE TENANT                                             │
│  ┌────────────────────────────────────────────────────┐                  │
│  │ • Buscar organization por phone_number_id          │                  │
│  │ • Verificar: is_active, has_quota_remaining        │                  │
│  │ • Obtener: sim_workspace_id, settings              │                  │
│  └────────────────────────────────────────────────────┘                  │
│                          │                                                │
│                          ▼                                                │
│  5. CONTEXTO DE CONVERSACIÓN (Redis)                                     │
│  ┌────────────────────────────────────────────────────┐                  │
│  │ • Key: conversation:{org_id}:{user_wa_id}          │                  │
│  │ • Obtener: últimos 10 mensajes, variables, estado  │                  │
│  │ • TTL: 24 horas                                    │                  │
│  └────────────────────────────────────────────────────┘                  │
│                          │                                                │
│                          ▼                                                │
│  ═══════════════════════════════════════════════════════════════════════ │
│  ║                    PIPELINE DE RESPUESTAS                           ║ │
│  ═══════════════════════════════════════════════════════════════════════ │
│                          │                                                │
│           ┌──────────────┼──────────────┐                                │
│           ▼              ▼              ▼                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │  STEP 1    │  │  STEP 2    │  │  STEP 3    │  │  STEP 4    │     │
│  │  Keywords  │─►│  Sim.ai    │─►│  MVP       │─►│  Fallback  │     │
│  │  Matcher   │  │  Workflows │  │  Workflows │  │  Response  │     │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘     │
│        │                │                │                │              │
│        ▼                ▼                ▼                ▼              │
│   "precios" →      workflow_id →    db workflow →   "Lo siento,        │
│   "Nuestros        ejecutar en      config local     no entendí..."    │
│    precios..."     Sim.ai                                               │
│                                                                           │
│  ═══════════════════════════════════════════════════════════════════════ │
│                          │                                                │
│                          ▼                                                │
│  6. ENVIAR RESPUESTA                                                     │
│  ┌────────────────────────────────────────────────────┐                  │
│  │ • POST https://graph.facebook.com/v18.0/{id}/msgs │                  │
│  │ • Headers: Authorization Bearer {access_token}    │                  │
│  │ • Body: { to: from_number, text: response }       │                  │
│  └────────────────────────────────────────────────────┘                  │
│                          │                                                │
│                          ▼                                                │
│  7. ACTUALIZAR CONTEXTO                                                  │
│  ┌────────────────────────────────────────────────────┐                  │
│  │ • Guardar mensaje usuario en Redis                 │                  │
│  │ • Guardar respuesta bot en Redis                   │                  │
│  │ • Incrementar message_count en conversation        │                  │
│  │ • Incrementar messages_used_this_month en org      │                  │
│  └────────────────────────────────────────────────────┘                  │
│                                                                           │
└──────────────────────────────────────────────────────────────────────────┘
           │
           │ 8. Respuesta HTTP 200 OK
           ▼
┌─────────────────────┐
│   Meta Cloud API    │
└──────────┬──────────┘
           │
           │ 9. Entrega mensaje
           ▼
     ┌─────────┐
     │ Usuario │  ◄── Recibe: "Nuestros precios son..."
     │WhatsApp │
     └─────────┘
```

---

## Pipeline de Respuestas (Detalle)

El pipeline procesa el mensaje en orden de prioridad. **El primero que responda gana**.

### Step 1: Keywords Matcher

**Ubicación**: `whatsapp-bot-saas/backend/app/services/keyword_matcher.py`

```
┌─────────────────────────────────────────────────────────────────┐
│ KEYWORD MATCHER                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Input: "hola quiero saber los precios"                         │
│                                                                  │
│  Database Query:                                                 │
│  SELECT * FROM keyword_responses                                 │
│  WHERE organization_id = :org_id                                │
│    AND is_active = true                                         │
│    AND :message ILIKE '%' || keyword || '%'                     │
│  ORDER BY priority ASC                                          │
│  LIMIT 1                                                        │
│                                                                  │
│  Match Found?                                                    │
│  ├─ YES: Return response_text                                   │
│  │       response_method = "keyword"                            │
│  │       ══► STOP PIPELINE                                      │
│  │                                                               │
│  └─ NO: Continue to Step 2                                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

**Ejemplo de keywords en DB**:
| keyword | response | priority |
|---------|----------|----------|
| precios | Nuestros precios son... | 1 |
| horario | Atendemos de 9am a 6pm | 2 |
| hola | ¡Hola! ¿En qué puedo ayudarte? | 10 |

---

### Step 2: Sim.ai Workflows

**Ubicación**: `whatsapp-bot-saas/backend/app/services/sim_ai_service.py`

```
┌─────────────────────────────────────────────────────────────────┐
│ SIM.AI WORKFLOW EXECUTION                                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Verificar que organization tiene sim_workspace_id           │
│                                                                  │
│  2. Buscar workflow activo para trigger_type = 'whatsapp_msg'   │
│     SELECT * FROM workflow_configs                               │
│     WHERE organization_id = :org_id                             │
│       AND is_active = true                                      │
│       AND trigger_type = 'whatsapp_message'                     │
│                                                                  │
│  3. Construir payload para Sim.ai:                              │
│     {                                                            │
│       "workspaceId": "org.sim_workspace_id",                    │
│       "workflowId": "config.sim_workflow_id",                   │
│       "input": {                                                 │
│         "message": "hola quiero saber los precios",             │
│         "from": "+5491123456789",                               │
│         "context": { ... redis context ... },                   │
│         "metadata": { "org_id": "...", "conv_id": "..." }       │
│       }                                                          │
│     }                                                            │
│                                                                  │
│  4. POST to Sim.ai:                                             │
│     POST {SIM_API_URL}/api/workflows/execute                    │
│     Authorization: Bearer {SIM_API_KEY}                         │
│                                                                  │
│  5. Sim.ai ejecuta el workflow visual:                          │
│     ┌─────────────────────────────────────────────────┐         │
│     │  [Trigger: WhatsApp Message]                    │         │
│     │           │                                      │         │
│     │           ▼                                      │         │
│     │  [AI Block: Claude/GPT]                         │         │
│     │   "Analiza el mensaje y responde..."            │         │
│     │           │                                      │         │
│     │           ▼                                      │         │
│     │  [HTTP Block: Send Response]                    │         │
│     │   POST to callback_url                          │         │
│     └─────────────────────────────────────────────────┘         │
│                                                                  │
│  6. Response from Sim.ai:                                       │
│     {                                                            │
│       "success": true,                                          │
│       "output": {                                                │
│         "response": "Los precios de nuestros productos..."      │
│       }                                                          │
│     }                                                            │
│                                                                  │
│  Match Found?                                                    │
│  ├─ YES: Return output.response                                 │
│  │       response_method = "sim_ai_workflow"                    │
│  │       ══► STOP PIPELINE                                      │
│  │                                                               │
│  └─ NO: Continue to Step 3                                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### Step 3: MVP Workflows (Fallback Local)

**Ubicación**: `whatsapp-bot-saas/backend/app/services/workflow_engine.py`

```
┌─────────────────────────────────────────────────────────────────┐
│ MVP WORKFLOW ENGINE (Local)                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Workflows simples definidos en la DB local (sin Sim.ai)        │
│                                                                  │
│  Query:                                                          │
│  SELECT * FROM workflow_configs                                  │
│  WHERE organization_id = :org_id                                │
│    AND is_active = true                                         │
│    AND n8n_workflow_id IS NOT NULL  -- tiene webhook externo    │
│                                                                  │
│  Ejecutar:                                                       │
│  POST {workflow.n8n_webhook_url}                                │
│  Body: { message, context, metadata }                           │
│                                                                  │
│  Match Found?                                                    │
│  ├─ YES: Return response                                        │
│  │       response_method = "mvp_workflow"                       │
│  │       ══► STOP PIPELINE                                      │
│  │                                                               │
│  └─ NO: Continue to Step 4                                      │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

### Step 4: Fallback Response

**Ubicación**: `whatsapp-bot-saas/backend/app/services/keyword_matcher.py`

```
┌─────────────────────────────────────────────────────────────────┐
│ FALLBACK RESPONSE                                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Si ningún step anterior generó respuesta:                      │
│                                                                  │
│  1. Buscar keyword con is_fallback = true                       │
│     SELECT response_text FROM keyword_responses                  │
│     WHERE organization_id = :org_id                             │
│       AND is_fallback = true                                    │
│                                                                  │
│  2. Si no hay fallback configurado, usar default:               │
│     "Lo siento, no entendí tu mensaje.                          │
│      Por favor, intenta de otra manera."                        │
│                                                                  │
│  response_method = "fallback"                                   │
│  ══► ALWAYS RETURNS A RESPONSE                                  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Sequence Diagram

```
┌────────┐      ┌─────────┐      ┌─────────┐      ┌───────┐      ┌────────┐
│WhatsApp│      │  Meta   │      │ FastAPI │      │ Redis │      │ Sim.ai │
│  User  │      │  API    │      │ Backend │      │       │      │        │
└───┬────┘      └────┬────┘      └────┬────┘      └───┬───┘      └───┬────┘
    │                │                │               │              │
    │ 1. Send msg    │                │               │              │
    │───────────────►│                │               │              │
    │                │                │               │              │
    │                │ 2. POST /webhook               │              │
    │                │───────────────►│               │              │
    │                │                │               │              │
    │                │                │ 3. Get context│              │
    │                │                │──────────────►│              │
    │                │                │◄──────────────│              │
    │                │                │               │              │
    │                │                │ 4. Check keywords            │
    │                │                │──────────────►│ (DB query)   │
    │                │                │◄──────────────│              │
    │                │                │               │              │
    │                │                │ 5. If no match, call Sim.ai │
    │                │                │──────────────────────────────►
    │                │                │               │              │
    │                │                │               │  6. Execute  │
    │                │                │               │    workflow  │
    │                │                │               │              │
    │                │                │◄──────────────────────────────
    │                │                │ 7. Response   │              │
    │                │                │               │              │
    │                │ 8. POST /messages              │              │
    │                │◄───────────────│               │              │
    │                │                │               │              │
    │ 9. Deliver msg │                │               │              │
    │◄───────────────│                │               │              │
    │                │                │               │              │
    │                │                │ 10. Save to Redis            │
    │                │                │──────────────►│              │
    │                │                │               │              │
```

---

## Data Flow

### Webhook Payload (from Meta)

```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "BUSINESS_ACCOUNT_ID",
    "changes": [{
      "value": {
        "messaging_product": "whatsapp",
        "metadata": {
          "display_phone_number": "15551234567",
          "phone_number_id": "PHONE_NUMBER_ID"
        },
        "contacts": [{
          "profile": { "name": "John Doe" },
          "wa_id": "5491123456789"
        }],
        "messages": [{
          "from": "5491123456789",
          "id": "wamid.xxx",
          "timestamp": "1234567890",
          "type": "text",
          "text": { "body": "Hola, quiero saber los precios" }
        }]
      },
      "field": "messages"
    }]
  }]
}
```

### Sim.ai Execute Request

```json
{
  "workspaceId": "ws_abc123",
  "workflowId": "wf_xyz789",
  "input": {
    "message": "Hola, quiero saber los precios",
    "from": "5491123456789",
    "phone_number_id": "PHONE_NUMBER_ID",
    "context": {
      "messages": [
        {"role": "user", "content": "mensaje anterior..."},
        {"role": "assistant", "content": "respuesta anterior..."}
      ],
      "variables": {
        "user_name": "John Doe",
        "last_intent": "greeting"
      }
    },
    "metadata": {
      "organization_id": "org_123",
      "conversation_id": "conv_456",
      "message_id": "wamid.xxx"
    }
  }
}
```

### Redis Context Structure

```json
{
  "conversation_id": "conv_456",
  "organization_id": "org_123",
  "user_wa_id": "5491123456789",
  "messages": [
    {
      "role": "user",
      "content": "Hola",
      "timestamp": "2026-02-04T10:00:00Z"
    },
    {
      "role": "assistant",
      "content": "¡Hola! ¿En qué puedo ayudarte?",
      "timestamp": "2026-02-04T10:00:01Z"
    }
  ],
  "variables": {
    "user_name": "John Doe",
    "current_intent": null,
    "workflow_state": null
  },
  "created_at": "2026-02-04T10:00:00Z",
  "updated_at": "2026-02-04T10:05:00Z"
}
```

---

## Environment Variables

### FastAPI Backend

```env
# Database
DATABASE_URL=postgresql+asyncpg://user:pass@host:5432/db

# Redis
REDIS_URL=redis://localhost:6379

# WhatsApp Business API
WHATSAPP_VERIFY_TOKEN=my-verify-token
WHATSAPP_ACCESS_TOKEN=EAAxxxxxxx
WHATSAPP_PHONE_NUMBER_ID=123456789

# Sim.ai Integration
SIM_API_URL=http://localhost:3001
SIM_API_KEY=sim_key_xxx
SIM_WORKSPACE_ID=default_workspace
SIM_WEBHOOK_URL=http://localhost:8000/api/v1/sim-webhook
```

### Sim.ai

```env
# Database (same Supabase, different schema)
DATABASE_URL=postgresql://user:pass@host:5432/db

# WhatsApp (for sending messages from workflows)
WHATSAPP_API_URL=https://graph.facebook.com  # or emulator URL for testing
```

---

## Key Points

1. **FastAPI is the brain**: Receives ALL webhooks, orchestrates ALL responses
2. **Sim.ai is the workflow engine**: Only executes visual workflows when called
3. **OpenAI is NOT used**: All AI processing happens inside Sim.ai workflows
4. **Redis stores context**: Messages live in Redis (24h TTL), not in PostgreSQL
5. **Pipeline is prioritized**: Keywords → Sim.ai → MVP → Fallback
6. **Multi-tenant**: Each organization has isolated data via `organization_id`

---

## Error Handling

```
┌─────────────────────────────────────────────────────────────────┐
│ ERROR SCENARIOS                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ 1. Organization not found:                                      │
│    └─► Return 200 OK (avoid webhook retry), log error           │
│                                                                  │
│ 2. Organization inactive/no quota:                              │
│    └─► Return 200 OK, don't process, log warning                │
│                                                                  │
│ 3. Sim.ai unreachable:                                          │
│    └─► Continue to MVP workflows, log error                     │
│                                                                  │
│ 4. Sim.ai workflow fails:                                       │
│    └─► Continue to MVP workflows, log error                     │
│                                                                  │
│ 5. WhatsApp API fails:                                          │
│    └─► Retry with exponential backoff (3 attempts)              │
│    └─► If all fail, log error, don't retry webhook              │
│                                                                  │
│ 6. Redis unavailable:                                           │
│    └─► Process without context, log warning                     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## Related Documents

- [PURPOSE_AND_ARCHITECTURE.md](./PURPOSE_AND_ARCHITECTURE.md) - System overview
- [SCHEMA_SEPARATION_CHANGES.md](./SCHEMA_SEPARATION_CHANGES.md) - Database schema details
- [API_INTEGRATION.md](./API_INTEGRATION.md) - API endpoints documentation
- [WORKSPACE_CREATION.md](./WORKSPACE_CREATION.md) - Workspace provisioning flow

---

**Last Updated**: 2026-02-04
**Author**: Claude Code
**Status**: Current Architecture
