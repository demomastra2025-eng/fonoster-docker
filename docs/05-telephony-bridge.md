# Telephony Bridge

## Purpose

The bridge is the business-aware layer between Onelink and Fonoster.

Current implementation path:

- [`/root/fonoster-docker/telephony-bridge`](/root/fonoster-docker/telephony-bridge)

It should:

- expose a simple telephony API to Onelink
- call Fonoster SDK/API
- keep product-specific routing rules out of Fonoster
- persist telephony-related mapping state
- normalize call events for Onelink

## Recommended Responsibilities

### Command Layer

Handle actions such as:

- create outbound call
- list the resources Onelink needs for telephony UX
- expose a concise capabilities view
- set number route
- enable or disable AI mode
- enable or disable operator availability
- fetch call history
- request browser-phone token

### Routing Layer

For inbound calls decide:

- reject
- send to AI
- send to operator
- send to voicemail
- ask caller for input and route again

### Synchronization Layer

Maintain mapping between:

- Onelink users and Fonoster agents
- Onelink inboxes and Fonoster numbers
- Onelink channels and Fonoster trunks or apps

### Event Layer

Process:

- call started / ended events
- AI conversation events
- tool execution side effects
- transcript and summary persistence

## Recommended Internal Modules

- `fonoster_client`
- `onelink_client`
- `calls_service`
- `routing_service`
- `agents_service`
- `numbers_service`
- `ai_mode_service`
- `events_service`
- `webphone_service`

## Recommended Public API Surface

- `POST /telephony/calls/outbound`
- `GET /telephony/capabilities`
- `GET /telephony/resources/summary`
- `GET /telephony/applications`
- `GET /telephony/numbers`
- `GET /telephony/numbers/:numberRef`
- `GET /telephony/trunks`
- `GET /telephony/agents`
- `GET /telephony/calls`
- `GET /telephony/calls/:callRef`
- `POST /telephony/numbers/:numberRef/route`
- `POST /telephony/agents/:agentRef/enabled`
- `POST /telephony/ai/toggle`
- `POST /telephony/webphone/token`
- `GET /telephony/events`
- `GET /telephony/events/poll`
- `GET /telephony/events/stream`
- `GET /telephony/events/:callRef`
- `GET /telephony/events/:callRef/stream`
- `GET /telephony/events/:callRef/poll`
- `GET /telephony/events/:eventType/stream`
- `GET /telephony/events/:eventType/poll`
- `GET /telephony/calls/:callRef/events`
- `GET /telephony/calls/:callRef/events/poll`
- `GET /telephony/calls/:callRef/events/stream`
- `GET /telephony/calls/:callRef/events/:eventType`
- `GET /telephony/calls/:callRef/events/:eventType/stream`
- `GET /telephony/calls/:callRef/events/:eventType/poll`
- `POST /telephony/calls/outbound/stream`

### Streaming and Event Contract

Event endpoints have three modes:

- Poll JSON:
  - `GET /telephony/events/poll`
  - `GET /telephony/events/:callRef/poll`
  - `GET /telephony/calls/:callRef/events/poll`
  - `GET /telephony/events/:eventType/poll`
  - `GET /telephony/calls/:callRef/events/:eventType/poll`
- Long-poll:
  - same endpoints with `block_ms` / `timeout_ms` / `wait`.
- SSE stream:
  - `GET /telephony/events?stream=1`
  - `GET /telephony/events/stream`
  - `GET /telephony/events/stream/:callRef`
  - `GET /telephony/calls/:callRef/events/stream`
  - `GET /telephony/events/:callRef/stream`
  - `GET /telephony/events/:eventType/stream`
  - `GET /telephony/calls/:callRef/events/:eventType/stream`
  - `POST /telephony/calls/outbound` (Accept: `text/event-stream` / `?mode=stream`)
  - `POST /telephony/calls/outbound/stream`

Filter parameters:

- `call_ref`, `event_type`, `number_ref`, `media_session_ref`, `account_id`, `eventId`
- `since`, `sinceMs`, `since_id`, `since_seq`, `limit`, `block_ms`, `timeout_ms`, `wait`

Implementation note:

- Events are persisted to Postgres (if `TELEPHONY_BRIDGE_STREAM_PERSIST_EVENTS=true`)
  and synchronized across bridge instances through `NOTIFY/LISTEN`.
- If DB is unavailable, the bridge gracefully falls back to in-memory mode and exposes
  `GET /telephony/events/state`.

## Recommended Internal Endpoints For Voice Runtime

- `POST /internal/voice/inbound/route`
- `POST /internal/voice/inbound/event`
- `POST /internal/voice/ai/tool/:toolName`

Current live local bind:

- `127.0.0.1:38081 -> telephony-bridge:3100`

Current implementation status:

- `capabilities`, `resources/summary`, `applications`, `numbers`, `trunks`, `agents`, `calls`, `webphone/token`, and internal route/event endpoints are working
- `numbers/:numberRef/route` and `ai/toggle` are working through a direct `routr.numbers` DB fallback
- the bridge uses this fallback specifically because the public Fonoster `UpdateNumber` path is buggy on this instance
- `voice-runtime` already consumes the bridge through `/internal/voice/inbound/route` and `/internal/voice/inbound/event`
- Full call-event stream API is active: poll/long-poll/SSE, including `/telephony/events/state` observability

## Data The Bridge Should Store

- mapping table between Onelink inboxes and Fonoster numbers
- mapping table between Onelink users and Fonoster agents
- active routing policy per number
- AI mode policy per inbox or number
- external call reference mapping
- recordings/transcripts metadata

## What The Bridge Should Not Do

The bridge should not replace Fonoster.

It should not implement:

- SIP signaling
- RTP/media handling
- low-level PBX behavior
- direct Asterisk/Routr logic

It also should not blindly duplicate every native Fonoster CRUD route unless Onelink has a real product need for that wrapper.
