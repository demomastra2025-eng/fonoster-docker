# Telephony Bridge

This service is the local integration layer between Fonoster and the future Onelink-side implementation.

## Current Status

Implemented and running locally through Docker Compose.

Local bind:

- `http://127.0.0.1:38081`

## Current Endpoints

- `GET /healthz`
- `GET /telephony/capabilities`
- `GET /telephony/resources/summary`
- `GET /telephony/applications`
- `GET /telephony/numbers`
- `GET /telephony/numbers/:numberRef`
- `GET /telephony/trunks`
- `GET /telephony/agents`
- `GET /telephony/calls`
- `GET /telephony/calls/:callRef`
- `GET /telephony/calls/:callRef/events`
- `GET /telephony/calls/:callRef/events/:eventType`
- `GET /telephony/calls/:callRef/events/:eventType/stream`
- `GET /telephony/calls/:callRef/events/:eventType/poll`
- `GET /telephony/events/:eventType/stream`
- `GET /telephony/events/:eventType/poll`
- `GET /telephony/calls/:callRef/events/poll`
- `GET /telephony/calls/:callRef/events/stream`
- `GET /telephony/calls/:callRef/stream`
- `GET /telephony/calls/:callRef/poll`
- `POST /telephony/calls/outbound`
- `POST /telephony/calls/outbound/stream`
- `POST /api/telephony/calls/outbound` (alias ` /telephony/...` через API-префикс)
- `POST /api/telephony/calls/outbound/stream` (alias ` /telephony/...` через API-префикс)
- `POST /api/v1/accounts/:accountId/telephony/calls/outbound` (account-scoped alias)
- `POST /api/v1/accounts/:accountId/telephony/ai/toggle` (account-scoped alias)
- `POST /telephony/calls/outbound` accepts:
  - `x-request-id` / `request_id`
  - `x-account-id` / `account_id` / `accountId`
  - `x-idempotency-key` / `idempotency_key` / `idempotencyKey`
- `POST /telephony/numbers/:numberRef/route`
- `POST /telephony/ai/toggle`
- `POST /telephony/agents/:agentRef/enabled`
- `POST /telephony/webphone/token`
- `GET /telephony/events`
- `GET /telephony/events/poll`
- `GET /telephony/events/:callRef`
- `GET /telephony/events/stream`
- `GET /telephony/events/stream/:callRef`
- `GET /telephony/events/state`
- `POST /internal/voice/inbound/route`
- `POST /internal/voice/inbound/event`

### Безопасность и масштабируемость

- Включена строгая авторизация внутренних роутов (`TELEPHONY_BRIDGE_REQUIRE_INTERNAL_SECRET`).
- Для многотenant-режима поддерживается `accountId` через:
  - `/api/v1/accounts/:accountId/telephony/...` (path scope)
  - `x-account-id` (HTTP header)
  - `account_id` query на тех же endpoint'ах (fallback)
- Для трассировки звонков поддерживается `requestId` через:
  - `x-request-id` (HTTP header)
  - `request_id` в `metadata` или payload
- Для стриминга настроены:
  - постоянное хранилище событий в Postgres (через `TELEPHONY_BRIDGE_STREAM_DATABASE_URL`)
  - ограничение размера буфера событий (`TELEPHONY_BRIDGE_STREAM_MAX_HISTORY`)
  - таймаут SSE heartbeat (`TELEPHONY_BRIDGE_STREAM_HEARTBEAT_MS`)
  - лимит long-poll ожидания (`TELEPHONY_BRIDGE_STREAM_MAX_LONG_POLL_MS`)
  - TTL дедупликации idempotent-ивентов (`TELEPHONY_BRIDGE_STREAM_DEDUP_TTL_MS`)
  - TTL хранения событий в БД (`TELEPHONY_BRIDGE_STREAM_RETENTION_HOURS`)
  - канал Pub/Sub для межинстансного стрима (`TELEPHONY_BRIDGE_STREAM_LISTEN_CHANNEL`)
  - лимит пулла Postgres (`TELEPHONY_BRIDGE_STREAM_PG_MAX_CONNECTIONS`)

### Streaming API variants (voice agent)

События поддерживают три режима:

- Poll JSON (исторические/запросы):
  - `GET /telephony/events/poll`
  - `GET /telephony/events/:callRef/poll`
  - `GET /telephony/calls/:callRef/events/poll`
  - `GET /telephony/calls/:callRef/events/:eventType`
  - `GET /telephony/calls/:callRef/events/:eventType/poll`
- Long-poll (`block_ms`/`timeout_ms`/`wait`):
  - те же poll-эндпоинты с `block_ms`, ожидают событие до указанного таймаута
- SSE:
  - `GET /telephony/events?mode=stream`
  - `GET /telephony/events/stream`
  - `GET /telephony/events/stream/:callRef`
  - `GET /telephony/events/:callRef/stream`
  - `GET /telephony/events/:eventType/stream`
  - `GET /telephony/calls/:callRef/events/stream`
  - `GET /telephony/calls/:callRef/events/:eventType/stream`
  - `POST /telephony/calls/outbound` with `Accept: text/event-stream` или `?mode=stream`
  - `POST /telephony/calls/outbound/stream`
- API aliases:
  - `/api/telephony/*`
  - `/api/v1/telephony/*` (без влияния на бизнес-логику)
  - `/api/v1/accounts/:accountId/telephony/*` (через проксирование к `/telephony/*`)

Параметры фильтрации событий:

- `call_ref` / `callRef`
- `event_type` / `eventType`
- `number_ref`
- `media_session_ref`
- `account_id`
- `eventId`
- `since` или `sinceMs`
- `since_id` / `since_seq`
- `limit`
- `block_ms` / `timeout_ms` / `wait`

Структура события:

- `id` — стабильный постгрес ид/последовательность (если БД включена)
- `seq` — локальный/глобальный счетчик внутри инстанса
- `eventType`, `callRef`, `numberRef`, `mediaSessionRef`, `accountId`, `requestId`
- `source`, `sourceEventId`, `idempotencyKey`, `dedupeKey`
- `data` — исходный payload для AI-агента и downstream систем

Переменные постгрес-стриминга:

- `TELEPHONY_BRIDGE_STREAM_DATABASE_URL`
- `TELEPHONY_BRIDGE_STREAM_TABLE_NAME`
- `TELEPHONY_BRIDGE_STREAM_LISTEN_CHANNEL`
- `TELEPHONY_BRIDGE_STREAM_RETENTION_HOURS`
- `TELEPHONY_BRIDGE_STREAM_PG_MAX_CONNECTIONS`
- `TELEPHONY_BRIDGE_STREAM_PERSIST_EVENTS`

## Poll/JSON examples

- `GET /telephony/events/poll`
- `GET /telephony/events/:callRef/poll`
- `GET /telephony/events/:eventType/poll`
- `GET /telephony/calls/:callRef/events/poll`
- `GET /telephony/calls/:callRef/poll`

## Query parameters

- `since_id` / `since_seq`, `since` (timestamp)
- `block_ms` / `timeout_ms` / `wait`
- `limit`
- `call_ref`, `event_type`, `number_ref`, `media_session_ref`

## Example Commands

Health:

```bash
curl -sS http://127.0.0.1:38081/healthz | jq .
```

Recent calls:

```bash
curl -sS http://127.0.0.1:38081/telephony/calls | jq .
```

Bridge surface vs native surface:

```bash
curl -sS http://127.0.0.1:38081/telephony/capabilities | jq .
```

Resource summary:

```bash
curl -sS http://127.0.0.1:38081/telephony/resources/summary | jq .
```

Webphone token:

```bash
curl -sS -X POST http://127.0.0.1:38081/telephony/webphone/token | jq .
```

Inbound route decision:

```bash
curl -sS -X POST http://127.0.0.1:38081/internal/voice/inbound/route \
  -H 'Content-Type: application/json' \
  -H 'x-bridge-secret: YOUR_SECRET' \
  -d '{
    "call_ref": "test-call-1",
    "ingress_number": "+18623964686",
    "caller_number": "+15551234567",
    "direction": "FROM_PSTN",
    "received_at": "2026-03-22T11:05:00Z",
    "metadata": {}
  }' | jq .
```

The bridge also accepts `x-bridge-shared-secret` for compatibility with other internal clients.

## Notes

- Onelink is now the intended source of truth for inbound decisioning.
- Until Onelink is connected, the bridge returns the local emergency fallback policy from `.env`.
- The bridge now includes retry, timeout, degraded-mode, and short-lived route-cache behavior for inbound route lookups.
- The bridge is intentionally not a full 1:1 mirror of the entire Fonoster SDK surface.
- Product-level commands should go through the bridge; low-level full resource administration can still go natively through Fonoster SDK/API.
- Number route switching and AI toggle are implemented with a Routr DB fallback because the public Fonoster `UpdateNumber` path is currently unreliable on this instance.
