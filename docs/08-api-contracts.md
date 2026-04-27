# API Contracts

## Goal

This file describes suggested contracts for the first version of the bridge API.

## Public API For Chatwoot Or CRM Integrations

### Create Outbound Call

`POST /telephony/calls/outbound`
`POST /api/telephony/calls/outbound`
`POST /api/v1/accounts/:account_id/telephony/calls/outbound`

```json
{
  "from_number_ref": "d451bbe2-53d8-4458-bd0e-d811d85f57e0",
  "to": "+15551234567",
  "app_ref": "7b9f0bbd-eac4-46e4-80a8-7b3d5341c9f8",
  "conversation_id": 123,
  "contact_id": 456
}
```

Outbound call supports two response modes:

- JSON response:
  - `POST /telephony/calls/outbound`
- Stream response:
  - `POST /telephony/calls/outbound` with `Accept: text/event-stream`
  - `POST /telephony/calls/outbound?mode=stream`
  - `POST /telephony/calls/outbound?stream=true`
  - `POST /telephony/calls/outbound/stream`

`GET /telephony/calls/:callRef/events/:eventType`

Event retrieval variants:

- `GET /telephony/events` (poll/JSON + history)
- `GET /telephony/events/poll` (long-poll)
- `GET /telephony/events/stream` (SSE)
- `GET /telephony/events/stream/:callRef` (call-scoped SSE)
- `GET /telephony/events/:callRef` (stream if `mode=stream`, otherwise redirects to event poll route)
- `GET /telephony/events/:callRef/poll` (call-scoped long-poll + filters)
- `GET /telephony/events/:callRef/stream` (call-scoped SSE)
- `GET /telephony/events/:eventType/stream` (account/global filter)
- `GET /telephony/events/:eventType/poll` (account/global + event-type polling)
- `GET /telephony/events/state` (operational stream health)
- `GET /telephony/calls/:callRef/events` (call-scoped poll history)
- `GET /telephony/calls/:callRef/events/poll` (call-scoped long-poll)
- `GET /telephony/calls/:callRef/events/stream` (call-scoped SSE)
- `GET /telephony/calls/:callRef/events/:eventType` (poll/JSON + optional `mode=stream`)
- `GET /telephony/calls/:callRef/events/:eventType/stream` (call + event type SSE)
- `GET /telephony/calls/:callRef/events/:eventType/poll` (call + event type long-poll)

Common query params for all event retrieval endpoints:

- `call_ref` (repeating or CSV)
- `event_type` (repeating or CSV)
- `number_ref` (repeating or CSV)
- `media_session_ref`
- `account_id`
- `eventId`
- `since`, `sinceMs`
- `since_id`, `since_seq`
- `block_ms`, `timeout_ms`, `wait`
- `limit`

Delivery guarantees:

- `mode=stream` or `Accept: text/event-stream` for SSE.
- SSE stream can include a history window and then emits live events.
- Long-poll returns immediately if matching events exist; otherwise waits up to `block_ms`.

### Set Number Route

`POST /telephony/numbers/:numberRef/route`

Current local refs used by the bridge:

- Runtime app: `96fc259c-6bcd-4cbf-bb7d-d2c51f248934`
- Gemini Live AI app: `7b9f0bbd-eac4-46e4-80a8-7b3d5341c9f8`
- Smoke-test operator: `sip:1001@operator.cloud.vconsult.kz`

Route the DID into the Onelink-controlled voice runtime:

```json
{
  "mode": "app",
  "app_ref": "96fc259c-6bcd-4cbf-bb7d-d2c51f248934"
}
```

Route the DID directly to the current Gemini Live AI app:

```json
{
  "mode": "ai",
  "app_ref": "7b9f0bbd-eac4-46e4-80a8-7b3d5341c9f8"
}
```

Route the DID directly to the current smoke-test operator:

```json
{
  "mode": "operator",
  "agent_aor": "sip:1001@operator.cloud.vconsult.kz"
}
```

Rules:

- `onelink` owns route intent. The bridge applies it to the local Routr/Fonoster execution layer.
- `mode=app` and `mode=ai` require `app_ref`.
- `mode=operator` requires `agent_aor`.
- Number route `mode=app` may point the DID at the runtime app so inbound calls enter the Onelink-controlled flow.
- Live inbound decisions for `action=app` or `action=ai` must point to an executable target app, not back to the runtime app. Returning the runtime app as a live target creates a recursive handoff.

### Enable Or Disable Agent

`POST /telephony/agents/:agentRef/enabled`

```json
{
  "enabled": true
}
```

### Get Webphone Token

`POST /telephony/webphone/token`

```json
{
  "chatwoot_user_id": 42
}
```

## Internal API Used By The Node Voice Runtime

### Inbound Route Decision

`POST /internal/voice/inbound/route`

```json
{
  "call_ref": "uuid",
  "ingress_number": "+18623964686",
  "caller_number": "+15557654321",
  "direction": "FROM_PSTN",
  "received_at": "2026-03-22T10:00:00Z",
  "metadata": {}
}
```

Response examples:

```json
{
  "action": "reject",
  "message": "We are currently closed."
}
```

```json
{
  "action": "operator",
  "agent_aor": "sip:1001@operator.cloud.vconsult.kz"
}
```

```json
{
  "action": "ai",
  "app_ref": "7b9f0bbd-eac4-46e4-80a8-7b3d5341c9f8"
}
```

```json
{
  "action": "app",
  "app_ref": "74fec1f6-48e8-436c-8147-9176a5da4fa4"
}
```

Decision rules:

- `reject` may include `message`.
- `operator` must include `agent_aor`; for the current smoke setup use `sip:1001@operator.cloud.vconsult.kz`.
- `ai` must include the current Gemini Live app ref `7b9f0bbd-eac4-46e4-80a8-7b3d5341c9f8`.
- `app` must include a non-runtime executable app ref. `74fec1f6-48e8-436c-8147-9176a5da4fa4` is only the older demo smoke-test app.
- Do not return runtime app ref `96fc259c-6bcd-4cbf-bb7d-d2c51f248934` for live `action=app` or `action=ai`.

### Call-Time Event

`POST /internal/voice/inbound/event`

```json
{
  "call_ref": "uuid",
  "event": "answered",
  "conversation_id": 123,
  "payload": {}
}
```

## Evolution Rules

- Keep the external API stable for Chatwoot-facing consumers.
- Allow internal runtime contracts to evolve independently.
- Version endpoints once real clients start depending on them.
