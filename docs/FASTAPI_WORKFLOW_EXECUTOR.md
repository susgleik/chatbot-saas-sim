# FastAPI Workflow Executor - Plan de Implementación

## Resumen Ejecutivo

Este documento describe el plan para implementar un **Workflow Executor** en FastAPI que lea y ejecute los workflows diseñados en Sim.ai. Esto permite que Sim.ai sea solo una herramienta de diseño (UI) mientras FastAPI maneja toda la ejecución, reduciendo costos y complejidad.

**Fecha**: 2026-02-05
**Estado**: Planificación
**Autor**: Claude Code

---

## Arquitectura Objetivo

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        ARQUITECTURA FINAL                                    │
└─────────────────────────────────────────────────────────────────────────────┘

                 ┌──────────────────────────────────┐
                 │         SIM.AI (UI Only)          │
                 │      Vercel / Scale-to-Zero       │
                 │                                   │
                 │  - Visual Workflow Editor         │
                 │  - Drag & Drop Blocks             │
                 │  - NO ejecuta workflows           │
                 │  - Solo DISEÑA y GUARDA           │
                 └──────────────┬────────────────────┘
                                │
                                │ Guarda en PostgreSQL
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      SUPABASE (PostgreSQL)                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   sim_engine.workflow           sim_engine.workflow_blocks                  │
│   ┌─────────────────────┐       ┌─────────────────────────────────────┐    │
│   │ id                  │       │ id                                   │    │
│   │ workspace_id        │       │ workflow_id                         │    │
│   │ name                │       │ type (agent, api, condition, etc.)  │    │
│   │ is_deployed         │       │ name                                │    │
│   │ variables           │       │ sub_blocks (JSON config)            │    │
│   └─────────────────────┘       │ outputs                             │    │
│                                  │ data                                │    │
│   sim_engine.workflow_edges     └─────────────────────────────────────┘    │
│   ┌─────────────────────┐                                                   │
│   │ source_block_id     │                                                   │
│   │ target_block_id     │                                                   │
│   │ source_handle       │                                                   │
│   │ target_handle       │                                                   │
│   └─────────────────────┘                                                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                │
                                │ Lee workflows
                                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FASTAPI BACKEND                                      │
│                         (Fly.io ~$7/mes)                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │                    WORKFLOW EXECUTOR (Python)                        │  │
│   │                                                                       │  │
│   │   Blocks Soportados:                                                 │  │
│   │   ┌─────────────────────────────────────────────────────────────┐   │  │
│   │   │  - agent      → OpenAI/Claude API calls                     │   │  │
│   │   │  - api        → HTTP requests (httpx)                       │   │  │
│   │   │  - condition  → if/else logic                               │   │  │
│   │   │  - function   → JavaScript execution (limited)              │   │  │
│   │   │  - loop       → Iterate over arrays                         │   │  │
│   │   │  - postgresql → Database queries                            │   │  │
│   │   │  - gmail      → Send emails                                 │   │  │
│   │   │  - response   → Format WhatsApp response                    │   │  │
│   │   └─────────────────────────────────────────────────────────────┘   │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Tablas a Leer (sim_engine schema)

### 1. workflow
```sql
-- Definición del workflow
SELECT id, workspace_id, name, description, is_deployed, variables
FROM sim_engine.workflow
WHERE workspace_id = :workspace_id AND is_deployed = true;
```

### 2. workflow_blocks
```sql
-- Bloques del workflow
SELECT id, workflow_id, type, name, sub_blocks, outputs, data, enabled
FROM sim_engine.workflow_blocks
WHERE workflow_id = :workflow_id AND enabled = true;
```

### 3. workflow_edges
```sql
-- Conexiones entre bloques
SELECT source_block_id, target_block_id, source_handle, target_handle
FROM sim_engine.workflow_edges
WHERE workflow_id = :workflow_id;
```

---

## Blocks a Implementar (MVP)

### 1. Agent Block (AI)
**Tipo**: `agent`
**Prioridad**: Alta
**Descripción**: Llamadas a LLMs (OpenAI, Claude, etc.)

**Configuración esperada (sub_blocks)**:
```json
{
  "messages": [
    {"role": "system", "content": "You are a helpful assistant"},
    {"role": "user", "content": "<input.message>"}
  ],
  "model": "gpt-4o-mini",
  "temperature": 0.7,
  "apiKey": "{{OPENAI_API_KEY}}"
}
```

**Implementación Python**:
```python
async def execute_agent(block: WorkflowBlock, context: ExecutionContext) -> BlockResult:
    config = block.sub_blocks
    messages = interpolate_variables(config.get("messages", []), context)
    model = config.get("model", "gpt-4o-mini")

    # Determinar provider por modelo
    if model.startswith("gpt") or model.startswith("o1"):
        response = await openai_client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=config.get("temperature", 0.7)
        )
        return BlockResult(
            content=response.choices[0].message.content,
            tokens={
                "prompt": response.usage.prompt_tokens,
                "completion": response.usage.completion_tokens
            }
        )
    elif model.startswith("claude"):
        # Anthropic API
        ...
```

---

### 2. API Block (HTTP Request)
**Tipo**: `api`
**Prioridad**: Alta
**Descripción**: Llamadas HTTP a cualquier endpoint

**Configuración esperada**:
```json
{
  "url": "https://api.example.com/users",
  "method": "POST",
  "headers": [
    {"key": "Authorization", "value": "Bearer {{API_KEY}}"},
    {"key": "Content-Type", "value": "application/json"}
  ],
  "body": "{\"name\": \"<input.name>\", \"email\": \"<input.email>\"}"
}
```

**Implementación Python**:
```python
async def execute_api(block: WorkflowBlock, context: ExecutionContext) -> BlockResult:
    config = block.sub_blocks
    url = interpolate_variables(config.get("url"), context)
    method = config.get("method", "GET")
    headers = parse_headers(config.get("headers", []), context)
    body = interpolate_variables(config.get("body"), context)

    async with httpx.AsyncClient() as client:
        response = await client.request(
            method=method,
            url=url,
            headers=headers,
            json=json.loads(body) if body else None,
            timeout=30.0
        )

        return BlockResult(
            data=response.json() if response.headers.get("content-type", "").startswith("application/json") else response.text,
            status=response.status_code,
            headers=dict(response.headers)
        )
```

---

### 3. Condition Block
**Tipo**: `condition`
**Prioridad**: Alta
**Descripción**: Lógica if/else para branching

**Configuración esperada**:
```json
{
  "conditions": [
    {
      "id": "cond_1",
      "expression": "<agent.content>.includes('comprar')",
      "targetBlockId": "block_purchase"
    },
    {
      "id": "cond_2",
      "expression": "<agent.content>.includes('precio')",
      "targetBlockId": "block_pricing"
    }
  ],
  "defaultTargetBlockId": "block_fallback"
}
```

**Implementación Python**:
```python
async def execute_condition(block: WorkflowBlock, context: ExecutionContext) -> BlockResult:
    config = block.sub_blocks
    conditions = config.get("conditions", [])

    for condition in conditions:
        expression = interpolate_variables(condition.get("expression"), context)
        # Evaluar expresión JavaScript-like de forma segura
        result = safe_eval(expression, context)

        if result:
            return BlockResult(
                conditionResult=True,
                selectedPath=condition.get("targetBlockId"),
                selectedOption=condition.get("id")
            )

    # Default path
    return BlockResult(
        conditionResult=False,
        selectedPath=config.get("defaultTargetBlockId"),
        selectedOption="default"
    )
```

---

### 4. Function Block (Code Execution)
**Tipo**: `function`
**Prioridad**: Media
**Descripción**: Ejecutar código JavaScript/Python personalizado

**Configuración esperada**:
```json
{
  "language": "javascript",
  "code": "const items = <api.data.items>;\nreturn items.filter(i => i.active).map(i => i.name);"
}
```

**Implementación Python**:
```python
async def execute_function(block: WorkflowBlock, context: ExecutionContext) -> BlockResult:
    config = block.sub_blocks
    language = config.get("language", "javascript")
    code = interpolate_variables(config.get("code"), context)

    if language == "javascript":
        # Usar py_mini_racer para ejecutar JS en Python
        from py_mini_racer import MiniRacer
        ctx = MiniRacer()

        # Inyectar variables del contexto
        wrapper_code = f"""
        (function() {{
            {code}
        }})()
        """
        result = ctx.eval(wrapper_code)
        return BlockResult(result=result, stdout="")

    elif language == "python":
        # Ejecutar Python en sandbox restringido
        # Usar RestrictedPython o similar
        ...
```

---

### 5. Loop Block
**Tipo**: `loop` (dentro de `workflow_subflows`)
**Prioridad**: Media
**Descripción**: Iterar sobre arrays

**Configuración esperada**:
```json
{
  "type": "loop",
  "config": {
    "iterateOver": "<api.data.items>",
    "itemVariable": "item",
    "indexVariable": "index"
  }
}
```

**Implementación Python**:
```python
async def execute_loop(subflow: WorkflowSubflow, context: ExecutionContext, executor) -> list[BlockResult]:
    config = subflow.config
    items = resolve_variable(config.get("iterateOver"), context)
    item_var = config.get("itemVariable", "item")

    results = []
    for index, item in enumerate(items):
        # Crear contexto para esta iteración
        loop_context = context.copy()
        loop_context.variables[item_var] = item
        loop_context.variables["index"] = index

        # Ejecutar bloques dentro del loop
        loop_result = await executor.execute_subflow_blocks(subflow, loop_context)
        results.append(loop_result)

    return results
```

---

### 6. PostgreSQL Block
**Tipo**: `postgresql`
**Prioridad**: Media
**Descripción**: Ejecutar queries en PostgreSQL

**Configuración esperada**:
```json
{
  "operation": "query",
  "connectionString": "{{DATABASE_URL}}",
  "query": "SELECT * FROM users WHERE email = $1",
  "params": ["<input.email>"]
}
```

**Implementación Python**:
```python
async def execute_postgresql(block: WorkflowBlock, context: ExecutionContext) -> BlockResult:
    config = block.sub_blocks
    operation = config.get("operation", "query")
    connection_string = resolve_env_var(config.get("connectionString"))
    query = interpolate_variables(config.get("query"), context)
    params = [interpolate_variables(p, context) for p in config.get("params", [])]

    async with asyncpg.create_pool(connection_string) as pool:
        async with pool.acquire() as conn:
            if operation == "query":
                rows = await conn.fetch(query, *params)
                return BlockResult(data=[dict(row) for row in rows])
            elif operation == "execute":
                result = await conn.execute(query, *params)
                return BlockResult(data={"affected_rows": result})
```

---

### 7. Gmail Block
**Tipo**: `gmail`
**Prioridad**: Baja
**Descripción**: Enviar emails via Gmail API

**Configuración esperada**:
```json
{
  "operation": "send",
  "to": "<input.email>",
  "subject": "Confirmación de pedido #<order.id>",
  "body": "Gracias por tu compra...",
  "credentials": "{{GMAIL_CREDENTIALS}}"
}
```

**Implementación Python**:
```python
async def execute_gmail(block: WorkflowBlock, context: ExecutionContext) -> BlockResult:
    config = block.sub_blocks
    operation = config.get("operation", "send")

    if operation == "send":
        to = interpolate_variables(config.get("to"), context)
        subject = interpolate_variables(config.get("subject"), context)
        body = interpolate_variables(config.get("body"), context)

        # Usar Gmail API o SMTP
        # Para MVP, usar SMTP directo
        import aiosmtplib

        message = EmailMessage()
        message["From"] = settings.GMAIL_FROM
        message["To"] = to
        message["Subject"] = subject
        message.set_content(body)

        await aiosmtplib.send(
            message,
            hostname="smtp.gmail.com",
            port=587,
            username=settings.GMAIL_USER,
            password=settings.GMAIL_APP_PASSWORD,
            start_tls=True
        )

        return BlockResult(success=True, messageId=message["Message-ID"])
```

---

### 8. Response Block (WhatsApp)
**Tipo**: `response`
**Prioridad**: Alta
**Descripción**: Formatear respuesta final para WhatsApp

**Configuración esperada**:
```json
{
  "message": "<agent.content>",
  "buttons": [
    {"id": "buy", "title": "Comprar"},
    {"id": "info", "title": "Más info"}
  ]
}
```

**Implementación Python**:
```python
async def execute_response(block: WorkflowBlock, context: ExecutionContext) -> BlockResult:
    config = block.sub_blocks
    message = interpolate_variables(config.get("message"), context)
    buttons = config.get("buttons", [])

    # Formatear para WhatsApp
    whatsapp_response = {
        "type": "text" if not buttons else "interactive",
        "text": message,
    }

    if buttons:
        whatsapp_response["buttons"] = [
            {"type": "reply", "reply": {"id": b["id"], "title": b["title"]}}
            for b in buttons
        ]

    return BlockResult(
        response=whatsapp_response,
        message=message
    )
```

---

## Archivos a Crear/Modificar

### Nuevos Archivos

```
whatsapp-bot-saas/backend/
├── app/
│   ├── services/
│   │   ├── workflow_executor/
│   │   │   ├── __init__.py
│   │   │   ├── executor.py           # Main executor class
│   │   │   ├── context.py            # ExecutionContext
│   │   │   ├── interpolator.py       # Variable interpolation
│   │   │   ├── graph.py              # Build execution graph from edges
│   │   │   └── blocks/
│   │   │       ├── __init__.py
│   │   │       ├── base.py           # BaseBlockExecutor
│   │   │       ├── agent.py          # AI/LLM block
│   │   │       ├── api.py            # HTTP request block
│   │   │       ├── condition.py      # Conditional logic
│   │   │       ├── function.py       # Code execution
│   │   │       ├── loop.py           # Loop/iteration
│   │   │       ├── postgresql.py     # Database queries
│   │   │       ├── gmail.py          # Email sending
│   │   │       └── response.py       # WhatsApp response
│   │   │
│   │   └── sim_ai_service.py         # Modificar para usar executor
│   │
│   └── models/
│       └── workflow_models.py        # SQLAlchemy models para sim_engine
```

### Archivos a Modificar

1. **`app/services/sim_ai_service.py`**
   - Cambiar de llamar API de Sim.ai a usar WorkflowExecutor local

2. **`app/api/v1/webhook.py`**
   - Actualizar pipeline para usar nuevo executor

3. **`app/config.py`**
   - Agregar configuraciones de AI providers (OpenAI, etc.)

4. **`requirements.txt`**
   - Agregar: `openai`, `anthropic`, `py-mini-racer`, `aiosmtplib`

---

## Dependencias Nuevas

```txt
# AI Providers
openai>=1.12.0
anthropic>=0.18.0

# JavaScript execution (for function block)
py-mini-racer>=0.6.0

# Email
aiosmtplib>=3.0.0

# Database (ya existe asyncpg)
# asyncpg>=0.29.0
```

---

## Orden de Implementación

### Fase 1: Core (1-2 días)
1. [ ] Crear modelos SQLAlchemy para leer sim_engine tables
2. [ ] Implementar `ExecutionContext` y `interpolator.py`
3. [ ] Implementar `graph.py` (construir grafo de ejecución)
4. [ ] Implementar `executor.py` (orquestador principal)

### Fase 2: Blocks Básicos (2-3 días)
5. [ ] Implementar `agent.py` (OpenAI)
6. [ ] Implementar `api.py` (HTTP)
7. [ ] Implementar `condition.py`
8. [ ] Implementar `response.py`

### Fase 3: Blocks Avanzados (2-3 días)
9. [ ] Implementar `function.py` (JS execution)
10. [ ] Implementar `loop.py`
11. [ ] Implementar `postgresql.py`
12. [ ] Implementar `gmail.py`

### Fase 4: Integración (1 día)
13. [ ] Modificar `sim_ai_service.py`
14. [ ] Testing end-to-end
15. [ ] Documentación

---

## Testing

### Unit Tests
```python
# tests/services/workflow_executor/test_executor.py

async def test_simple_workflow_execution():
    """Test ejecutar workflow con agent -> response"""

async def test_conditional_branching():
    """Test que condition block elige el path correcto"""

async def test_variable_interpolation():
    """Test que las variables se interpolan correctamente"""

async def test_api_block_makes_request():
    """Test que api block hace HTTP request"""
```

### Integration Tests
```python
# tests/integration/test_whatsapp_workflow.py

async def test_full_message_flow():
    """
    1. Simular webhook de WhatsApp
    2. Verificar que se ejecuta workflow
    3. Verificar respuesta correcta
    """
```

---

## Variables de Entorno Nuevas

```env
# AI Providers
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...

# Email (para Gmail block)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-email@gmail.com
SMTP_PASSWORD=app-password
SMTP_FROM=tu-email@gmail.com

# Feature Flags
ENABLE_WORKFLOW_EXECUTOR=true
WORKFLOW_EXECUTOR_TIMEOUT=30  # segundos
```

---

## Diagrama de Secuencia

```
┌─────────┐     ┌─────────┐     ┌──────────────┐     ┌─────────────┐
│WhatsApp │     │ FastAPI │     │  Workflow    │     │  PostgreSQL │
│  User   │     │  Webhook│     │  Executor    │     │  (Supabase) │
└────┬────┘     └────┬────┘     └──────┬───────┘     └──────┬──────┘
     │               │                 │                    │
     │ 1. Mensaje    │                 │                    │
     │──────────────►│                 │                    │
     │               │                 │                    │
     │               │ 2. Get workflow │                    │
     │               │─────────────────┼───────────────────►│
     │               │                 │◄───────────────────│
     │               │                 │  workflow + blocks │
     │               │                 │                    │
     │               │ 3. Execute      │                    │
     │               │────────────────►│                    │
     │               │                 │                    │
     │               │                 │ 4. Build graph     │
     │               │                 │────────┐           │
     │               │                 │        │           │
     │               │                 │◄───────┘           │
     │               │                 │                    │
     │               │                 │ 5. Execute blocks  │
     │               │                 │    (agent, api,    │
     │               │                 │     condition...)  │
     │               │                 │────────┐           │
     │               │                 │        │           │
     │               │                 │◄───────┘           │
     │               │                 │                    │
     │               │◄────────────────│                    │
     │               │  6. Response    │                    │
     │               │                 │                    │
     │ 7. Reply      │                 │                    │
     │◄──────────────│                 │                    │
     │               │                 │                    │
```

---

## Consideraciones de Seguridad

1. **Ejecución de código (function block)**
   - Usar sandbox (py_mini_racer, RestrictedPython)
   - Timeout estricto (5s)
   - Sin acceso a filesystem
   - Sin imports peligrosos

2. **Interpolación de variables**
   - Sanitizar inputs para evitar injection
   - Validar tipos de datos

3. **API Keys**
   - Nunca loggear keys
   - Usar variables de entorno
   - Encriptar en DB si se guardan

4. **Rate limiting**
   - Limitar ejecuciones por organización
   - Limitar llamadas a APIs externas

---

## Métricas a Trackear

1. `workflow_executions_total` - Total de ejecuciones
2. `workflow_execution_duration_seconds` - Duración de ejecución
3. `block_executions_by_type` - Ejecuciones por tipo de bloque
4. `workflow_errors_total` - Errores por tipo
5. `ai_tokens_used` - Tokens consumidos (OpenAI, etc.)

---

## Siguiente Paso

**Ejecutar**: Implementar Fase 1 (Core) comenzando con:

1. `app/models/workflow_models.py` - Modelos SQLAlchemy
2. `app/services/workflow_executor/context.py` - ExecutionContext
3. `app/services/workflow_executor/interpolator.py` - Variable interpolation
4. `app/services/workflow_executor/executor.py` - Main executor

¿Procedo con la implementación?

---

**Última actualización**: 2026-02-05
**Estado**: Listo para implementar
