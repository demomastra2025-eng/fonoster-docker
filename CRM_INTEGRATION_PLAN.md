# CRM Integration Plan

## Goal

Use self-hosted Fonoster as the telephony/call-control core, while the CRM on another server owns:

- customer data
- operator state
- business routing rules
- AI on/off decisions
- reporting and workflow state

## Target Architecture

### 1. Fonoster Platform

Keep Fonoster responsible for:

- SIP ingress/egress
- media handling
- voice session lifecycle
- numbers, trunks, domains, credentials, agents
- AI application execution

Current platform/source locations:

- [`/root/fonoster`](/root/fonoster)
- [`/root/fonoster-docker`](/root/fonoster-docker)

### 2. CRM Telephony Bridge

Build a separate service, not inside Fonoster itself.

Recommended ownership:

- CRM talks to the bridge
- bridge talks to Fonoster via `@fonoster/sdk`
- Fonoster `EXTERNAL` app talks back to the bridge over HTTP/gRPC

Recommended placement:

- inside the CRM backend if telephony logic is tightly coupled to CRM models
- or as a separate service such as `crm-telephony-bridge`

Do not place this business logic under [`/root/fonoster`](/root/fonoster). That repo should stay close to upstream.

## Core Fonoster Objects To Create

### Applications

Create at least two applications:

1. `CRM Router App`
- type: `EXTERNAL`
- role: deterministic business routing
- endpoint: your bridge service

2. `AI Agent App`
- type: `AUTOPILOT`
- role: conversational AI agent
- config: STT/TTS/LLM/tools/eventsHook

Relevant source:

- [`/root/fonoster/mods/types/src/applications.types.ts`](/root/fonoster/mods/types/src/applications.types.ts)

### Numbers

Each DID should be controlled by CRM through the number mapping:

- `appRef` when the call should go to an application
- `agentAor` when the call should ring a live operator agent directly
- `trunkRef` for PSTN ingress association

Relevant source:

- [`/root/fonoster/mods/types/src/numbers.types.ts`](/root/fonoster/mods/types/src/numbers.types.ts)

### Agents

Create Fonoster agents for live operators when you need browser/SIP operator endpoints.

Useful fields:

- `enabled`
- `maxContacts`
- `domainRef`
- `credentialsRef`

Relevant source:

- [`/root/fonoster/mods/types/src/agents.types.ts`](/root/fonoster/mods/types/src/agents.types.ts)

### Domains and Credentials

Use these when operators register softphones or browser SIP clients.

Relevant source:

- [`/root/fonoster/mods/sdk/src/Domains.ts`](/root/fonoster/mods/sdk/src/Domains.ts)
- [`/root/fonoster/mods/sdk/src/Credentials.ts`](/root/fonoster/mods/sdk/src/Credentials.ts)

## What CRM Should Control Through The SDK

The CRM backend can already control these through the public SDK/API:

- outbound calling via `Calls.createCall`
- call history via `Calls.listCalls` and `Calls.getCall`
- AI/normal routing by updating `Number.appRef` or `Number.agentAor`
- operator availability by updating `Agent.enabled`
- telephony resources via `Applications`, `Numbers`, `Trunks`, `Domains`, `Agents`, `Credentials`, `Secrets`
- browser/webphone bootstrap via `Applications.createTestToken`

Useful SDK files:

- [`/root/fonoster/mods/sdk/src/Calls.ts`](/root/fonoster/mods/sdk/src/Calls.ts)
- [`/root/fonoster/mods/sdk/src/Applications.ts`](/root/fonoster/mods/sdk/src/Applications.ts)
- [`/root/fonoster/mods/sdk/src/Numbers.ts`](/root/fonoster/mods/sdk/src/Numbers.ts)
- [`/root/fonoster/mods/sdk/src/Agents.ts`](/root/fonoster/mods/sdk/src/Agents.ts)
- [`/root/fonoster/mods/sdk/src/Trunks.ts`](/root/fonoster/mods/sdk/src/Trunks.ts)

## Important Boundary: Inbound Call Acceptance

Fonoster does not expose a generic admin action like:

- `acceptIncomingCall(ref)`
- `rejectIncomingCall(ref)`
- `cancelInboundCall(ref)`

For inbound PSTN calls, those actions happen inside the voice application session itself:

- `answer()` accepts the call
- `hangup()` ends the call
- `dial()` transfers/bridges the call onward

Relevant source:

- [`/root/fonoster/mods/voice/src/VoiceResponse.ts`](/root/fonoster/mods/voice/src/VoiceResponse.ts)

That means the CRM should not try to directly "pick up" an arbitrary incoming PSTN call by ref. Instead:

1. Fonoster sends the inbound call to your `CRM Router App`
2. the app asks the CRM what to do
3. the app runs `answer`, `hangup`, `say`, `dial`, `gather`, or forwards to AI

## Recommended MVP Flows

### Flow A: Inbound -> CRM Router -> AI or Human

1. Twilio/PSTN delivers call to Fonoster number
2. Number routes to `CRM Router App`
3. Router app asks CRM for route decision
4. CRM returns one of:
- `ai`
- `operator`
- `voicemail`
- `reject`
5. Router app executes the call flow

### Flow B: CRM Creates Outbound Call

1. CRM user clicks "Call"
2. CRM backend calls `Calls.createCall`
3. Fonoster places the outbound call using the configured app and telephony resources
4. CRM tracks progress from streamed call status and later CDR history

### Flow C: Toggle AI Per Number

Implement AI on/off by changing routing, not by editing Fonoster core:

- AI on: point the number to `AI Agent App`
- AI off: point the number to `CRM Router App` or direct `agentAor`

### Flow D: Toggle Operator Availability

When an operator goes offline:

- update `Agent.enabled=false`

When they return:

- update `Agent.enabled=true`

## Recommended Bridge API Surface

Your bridge service should expose at least:

Detailed request/response contracts for the current Onelink handoff are in:

- [`ONELINK_BRIDGE_API_CONTRACT.md`](./ONELINK_BRIDGE_API_CONTRACT.md)

Current Onelink dev URL:

- `https://akilah-deuteranomalous-blythe.ngrok-free.dev`

Current remote Fonoster bridge URL for Onelink/Rails:

- `https://bridge.75.119.131.165.sslip.io`
- Set `TELEPHONY_BRIDGE_BASE_URL=https://bridge.75.119.131.165.sslip.io`
  in Onelink.
- Also set `TELEPHONY_BRIDGE_SHARED_SECRET` to the same value used by the
  Fonoster bridge. The remote proxy accepts `X-Bridge-Secret`,
  `X-Bridge-Shared-Secret`, or `Authorization: Bearer <secret>`.
- `GET /healthz` is open for uptime checks. Telephony command endpoints are
  protected by the reverse proxy.
- The remote proxy exposes only `GET /healthz` and `/telephony/*`; bridge
  internal `/internal/voice/inbound/*` endpoints are not exposed through it.

Status checked and rechecked on 2026-04-19: the Onelink inbound route/event
POST endpoints exist, but the current Fonoster number still returns
`number_not_bound`.
The URL was temporarily enabled in live bridge config for integration testing.
Inbound calls may be rejected by Onelink until the Onelink telephony channel is
bound to `+18623964686`.

Current live bridge scope:

- The five CRM command endpoints in `ONELINK_BRIDGE_API_CONTRACT.md` are active.
- The bridge also calls Onelink `POST /internal/voice/inbound/route` and
  `POST /internal/voice/inbound/event`.
- Extra event-stream endpoints exist in the current bridge image, but are not
  part of the current Onelink CRM handoff contract.

Current Onelink blocker:

- Onelink must bind `+18623964686` to the stored Fonoster channel data.
- After binding, route decisions for this number must not return
  `number_not_bound`.
- Onelink must return HTTP `200` with `action=reject` for business rejections,
  not HTTP `404` or `500`.

### Commands From CRM UI

- `POST /telephony/calls/outbound`
- `POST /telephony/numbers/:numberRef/route`
- `POST /telephony/agents/:agentRef/enabled`
- `POST /telephony/ai/toggle`
- `GET /telephony/calls`
- `GET /telephony/calls/:callRef`

### Call-Time Endpoints Used By Fonoster Apps

For the current Onelink integration, Onelink must implement:

- `POST /internal/voice/inbound/route`
- `POST /internal/voice/inbound/event`

Future AI tools can be added later under a separate tools namespace, but they
are not required for the current bridge handoff.

The first endpoint should return a routing decision such as:

```json
{
  "action": "operator",
  "agent_aor": "sip:1001@company.example"
}
```

or:

```json
{
  "action": "ai",
  "app_ref": "real-ai-app-ref"
}
```

or:

```json
{
  "action": "reject",
  "message": "We are currently closed."
}
```

Do not return the current runtime app ref
`96fc259c-6bcd-4cbf-bb7d-d2c51f248934` as the target `app_ref` for the same
inbound call. It is the app already handling the call and can cause recursive
routing. Use a separate AI app ref when it exists, or the demo app ref only for
smoke tests.

Current Onelink response shape is snake_case: `app_ref` and `agent_aor`.
Bridge/runtime compatibility aliases such as `appRef`, `agentAor`,
`destination`, and `phoneNumber` are not current Onelink output unless Onelink
code is explicitly changed.

Onelink should persist these minimum call cases:

- inbound bound number creates or updates one conversation by `call_ref`
- inbound unknown number returns `action=reject`, `reason=number_not_bound`
- AI enabled returns `action=ai` with a real non-runtime `app_ref`
- operator route returns `action=operator` with `agent_aor`
- business closed or blocked caller returns `action=reject` with a caller-safe message
- events `session_started`, `decision_received`, `answered`, `dial_status`, `session_completed`, and `session_failed` are stored idempotently
- dial statuses are normalized to current Onelink lowercase values such as `answered`; raw provider values like `ANSWER` must not break ingestion

## Browser Phone / Operator UI Future

Current Onelink behavior treats Fonoster as outside-browser. Browser/webphone
integration is therefore future/exploration, not a current production path.

Fonoster can expose `Applications.createTestToken`, which returns:

- signaling server
- target AOR
- username
- JWT token

Relevant source:

- [`/root/fonoster/mods/sdk/src/Applications.ts`](/root/fonoster/mods/sdk/src/Applications.ts)
- [`/root/fonoster/mods/apiserver/src/applications/createCreateTestToken.ts`](/root/fonoster/mods/apiserver/src/applications/createCreateTestToken.ts)

This is enough only to explore embedded operator calling in the CRM. The current
Fonoster instance still returns:

- `ws://75.119.131.165:5062`

For a production HTTPS CRM you will likely want `wss://` instead of `ws://`.

## AI App Integration

Use an `AUTOPILOT` app when you want:

- natural conversation
- tool calling into CRM APIs
- transfer to human operators
- outbound AI callbacks
- conversation completion webhooks

Useful references:

- [`/root/fonoster/mods/autopilot/README.md`](/root/fonoster/mods/autopilot/README.md)
- [`/root/fonoster-library/awesome/appConfig.yaml`](/root/fonoster-library/awesome/appConfig.yaml)

Important Autopilot capabilities:

- `tools`
- `transferOptions`
- `eventsHook`

Events hook schema:

- [`/root/fonoster/mods/common/src/assistants/eventsHookSchema.ts`](/root/fonoster/mods/common/src/assistants/eventsHookSchema.ts)

## Recommended Build Order

### Phase 1

Deliver basic telephony control:

- create `CRM Router App`
- route current Twilio number to that app
- build `POST /telephony/calls/outbound`
- build `GET /telephony/calls`
- build `POST /telephony/agents/:agentRef/enabled`

### Phase 2

Deliver operator connectivity:

- create `Domain`
- create `Credentials`
- create `Agents`
- decide browser phone vs SIP hard/softphone

### Phase 3

Deliver AI:

- create `AI Agent App`
- add CRM tools
- add `eventsHook`
- support AI/human toggle per number or per business rule

### Phase 4

Deliver production hardening:

- replace default access key usage with dedicated API keys
- switch browser signaling to secure `wss://`
- add observability for SIP/RTP and app events
- add automated end-to-end telephony tests

## Useful Local References

For examples and patterns:
# CRM Integration Plan

## Goal

Use self-hosted Fonoster as the telephony/call-control core, while the CRM on another server owns:

- customer data
- operator state
- business routing rules
- AI on/off decisions
- reporting and workflow state

## Target Architecture

### 1. Fonoster Platform

Keep Fonoster responsible for:

- SIP ingress/egress
- media handling
- voice session lifecycle
- numbers, trunks, domains, credentials, agents
- AI application execution

Current platform/source locations:

- [`/root/fonoster`](/root/fonoster)
- [`/root/fonoster-docker`](/root/fonoster-docker)

### 2. CRM Telephony Bridge

Build a separate service, not inside Fonoster itself.

Recommended ownership:

- CRM talks to the bridge
- bridge talks to Fonoster via `@fonoster/sdk`
- Fonoster `EXTERNAL` app talks back to the bridge over HTTP/gRPC

Recommended placement:

- inside the CRM backend if telephony logic is tightly coupled to CRM models
- or as a separate service such as `crm-telephony-bridge`

Do not place this business logic under [`/root/fonoster`](/root/fonoster). That repo should stay close to upstream.

## Core Fonoster Objects To Create

### Applications

Create at least two applications:

1. `CRM Router App`
- type: `EXTERNAL`
- role: deterministic business routing
- endpoint: your bridge service

2. `AI Agent App`
- type: `AUTOPILOT`
- role: conversational AI agent
- config: STT/TTS/LLM/tools/eventsHook

Relevant source:

- [`/root/fonoster/mods/types/src/applications.types.ts`](/root/fonoster/mods/types/src/applications.types.ts)

### Numbers

Each DID should be controlled by CRM through the number mapping:

- `appRef` when the call should go to an application
- `agentAor` when the call should ring a live operator agent directly
- `trunkRef` for PSTN ingress association

Relevant source:

- [`/root/fonoster/mods/types/src/numbers.types.ts`](/root/fonoster/mods/types/src/numbers.types.ts)

### Agents

Create Fonoster agents for live operators when you need browser/SIP operator endpoints.

Useful fields:

- `enabled`
- `maxContacts`
- `domainRef`
- `credentialsRef`

Relevant source:

- [`/root/fonoster/mods/types/src/agents.types.ts`](/root/fonoster/mods/types/src/agents.types.ts)

### Domains and Credentials

Use these when operators register softphones or browser SIP clients.

Relevant source:

- [`/root/fonoster/mods/sdk/src/Domains.ts`](/root/fonoster/mods/sdk/src/Domains.ts)
- [`/root/fonoster/mods/sdk/src/Credentials.ts`](/root/fonoster/mods/sdk/src/Credentials.ts)

## What CRM Should Control Through The SDK

The CRM backend can already control these through the public SDK/API:

- outbound calling via `Calls.createCall`
- call history via `Calls.listCalls` and `Calls.getCall`
- AI/normal routing by updating `Number.appRef` or `Number.agentAor`
- operator availability by updating `Agent.enabled`
- telephony resources via `Applications`, `Numbers`, `Trunks`, `Domains`, `Agents`, `Credentials`, `Secrets`
- browser/webphone bootstrap via `Applications.createTestToken`

Useful SDK files:

- [`/root/fonoster/mods/sdk/src/Calls.ts`](/root/fonoster/mods/sdk/src/Calls.ts)
- [`/root/fonoster/mods/sdk/src/Applications.ts`](/root/fonoster/mods/sdk/src/Applications.ts)
- [`/root/fonoster/mods/sdk/src/Numbers.ts`](/root/fonoster/mods/sdk/src/Numbers.ts)
- [`/root/fonoster/mods/sdk/src/Agents.ts`](/root/fonoster/mods/sdk/src/Agents.ts)
- [`/root/fonoster/mods/sdk/src/Trunks.ts`](/root/fonoster/mods/sdk/src/Trunks.ts)

## Important Boundary: Inbound Call Acceptance

Fonoster does not expose a generic admin action like:

- `acceptIncomingCall(ref)`
- `rejectIncomingCall(ref)`
- `cancelInboundCall(ref)`

For inbound PSTN calls, those actions happen inside the voice application session itself:

- `answer()` accepts the call
- `hangup()` ends the call
- `dial()` transfers/bridges the call onward

Relevant source:

- [`/root/fonoster/mods/voice/src/VoiceResponse.ts`](/root/fonoster/mods/voice/src/VoiceResponse.ts)

That means the CRM should not try to directly "pick up" an arbitrary incoming PSTN call by ref. Instead:

1. Fonoster sends the inbound call to your `CRM Router App`
2. the app asks the CRM what to do
3. the app runs `answer`, `hangup`, `say`, `dial`, `gather`, or forwards to AI

## Recommended MVP Flows

### Flow A: Inbound -> CRM Router -> AI or Human

1. Twilio/PSTN delivers call to Fonoster number
2. Number routes to `CRM Router App`
3. Router app asks CRM for route decision
4. CRM returns one of:
- `ai`
- `operator`
- `voicemail`
- `reject`
5. Router app executes the call flow

### Flow B: CRM Creates Outbound Call

1. CRM user clicks "Call"
2. CRM backend calls `Calls.createCall`
3. Fonoster places the outbound call using the configured app and telephony resources
4. CRM tracks progress from streamed call status and later CDR history

### Flow C: Toggle AI Per Number

Implement AI on/off by changing routing, not by editing Fonoster core:

- AI on: point the number to `AI Agent App`
- AI off: point the number to `CRM Router App` or direct `agentAor`

### Flow D: Toggle Operator Availability

When an operator goes offline:

- update `Agent.enabled=false`

When they return:

- update `Agent.enabled=true`

## Recommended Bridge API Surface

Your bridge service should expose at least:

Detailed request/response contracts for the current Onelink handoff are in:

- [`ONELINK_BRIDGE_API_CONTRACT.md`](./ONELINK_BRIDGE_API_CONTRACT.md)

Current Onelink dev URL:

- `https://akilah-deuteranomalous-blythe.ngrok-free.dev`

Current remote Fonoster bridge URL for Onelink/Rails:

- `https://bridge.75.119.131.165.sslip.io`
- Set `TELEPHONY_BRIDGE_BASE_URL=https://bridge.75.119.131.165.sslip.io`
  in Onelink.
- Also set `TELEPHONY_BRIDGE_SHARED_SECRET` to the same value used by the
  Fonoster bridge. The remote proxy accepts `X-Bridge-Secret`,
  `X-Bridge-Shared-Secret`, or `Authorization: Bearer <secret>`.
- `GET /healthz` is open for uptime checks. Telephony command endpoints are
  protected by the reverse proxy.
- The remote proxy exposes only `GET /healthz` and `/telephony/*`; bridge
  internal `/internal/voice/inbound/*` endpoints are not exposed through it.

Status checked and rechecked on 2026-04-19: the Onelink inbound route/event
POST endpoints exist, but the current Fonoster number still returns
`number_not_bound`.
The URL was temporarily enabled in live bridge config for integration testing.
Inbound calls may be rejected by Onelink until the Onelink telephony channel is
bound to `+18623964686`.

Current live bridge scope:

- The five CRM command endpoints in `ONELINK_BRIDGE_API_CONTRACT.md` are active.
- The bridge also calls Onelink `POST /internal/voice/inbound/route` and
  `POST /internal/voice/inbound/event`.
- Extra event-stream endpoints exist in the current bridge image, but are not
  part of the current Onelink CRM handoff contract.

Current Onelink blocker:

- Onelink must bind `+18623964686` to the stored Fonoster channel data.
- After binding, route decisions for this number must not return
  `number_not_bound`.
- Onelink must return HTTP `200` with `action=reject` for business rejections,
  not HTTP `404` or `500`.

### Commands From CRM UI

- `POST /telephony/calls/outbound`
- `POST /telephony/numbers/:numberRef/route`
- `POST /telephony/agents/:agentRef/enabled`
- `POST /telephony/ai/toggle`
- `GET /telephony/calls`
- `GET /telephony/calls/:callRef`

### Call-Time Endpoints Used By Fonoster Apps

For the current Onelink integration, Onelink must implement:

- `POST /internal/voice/inbound/route`
- `POST /internal/voice/inbound/event`

Future AI tools can be added later under a separate tools namespace, but they
are not required for the current bridge handoff.

The first endpoint should return a routing decision such as:

```json
{
  "action": "operator",
  "agent_aor": "sip:1001@company.example"
}
```

or:

```json
{
  "action": "ai",
  "app_ref": "real-ai-app-ref"
}
```

or:

```json
{
  "action": "reject",
  "message": "We are currently closed."
}
```

Do not return the current runtime app ref
`96fc259c-6bcd-4cbf-bb7d-d2c51f248934` as the target `app_ref` for the same
inbound call. It is the app already handling the call and can cause recursive
routing. Use a separate AI app ref when it exists, or the demo app ref only for
smoke tests.

Current Onelink response shape is snake_case: `app_ref` and `agent_aor`.
Bridge/runtime compatibility aliases such as `appRef`, `agentAor`,
`destination`, and `phoneNumber` are not current Onelink output unless Onelink
code is explicitly changed.

Onelink should persist these minimum call cases:

- inbound bound number creates or updates one conversation by `call_ref`
- inbound unknown number returns `action=reject`, `reason=number_not_bound`
- AI enabled returns `action=ai` with a real non-runtime `app_ref`
- operator route returns `action=operator` with `agent_aor`
- business closed or blocked caller returns `action=reject` with a caller-safe message
- events `session_started`, `decision_received`, `answered`, `dial_status`, `session_completed`, and `session_failed` are stored idempotently
- dial statuses are normalized to current Onelink lowercase values such as `answered`; raw provider values like `ANSWER` must not break ingestion

## Browser Phone / Operator UI Future

Current Onelink behavior treats Fonoster as outside-browser. Browser/webphone
integration is therefore future/exploration, not a current production path.

Fonoster can expose `Applications.createTestToken`, which returns:

- signaling server
- target AOR
- username
- JWT token

Relevant source:

- [`/root/fonoster/mods/sdk/src/Applications.ts`](/root/fonoster/mods/sdk/src/Applications.ts)
- [`/root/fonoster/mods/apiserver/src/applications/createCreateTestToken.ts`](/root/fonoster/mods/apiserver/src/applications/createCreateTestToken.ts)

This is enough only to explore embedded operator calling in the CRM. The current
Fonoster instance still returns:

- `ws://75.119.131.165:5062`

For a production HTTPS CRM you will likely want `wss://` instead of `ws://`.

## AI App Integration

Use an `AUTOPILOT` app when you want:

- natural conversation
- tool calling into CRM APIs
- transfer to human operators
- outbound AI callbacks
- conversation completion webhooks

Useful references:

- [`/root/fonoster/mods/autopilot/README.md`](/root/fonoster/mods/autopilot/README.md)
- [`/root/fonoster-library/awesome/appConfig.yaml`](/root/fonoster-library/awesome/appConfig.yaml)

Important Autopilot capabilities:

- `tools`
- `transferOptions`
- `eventsHook`

Events hook schema:

- [`/root/fonoster/mods/common/src/assistants/eventsHookSchema.ts`](/root/fonoster/mods/common/src/assistants/eventsHookSchema.ts)

## Recommended Build Order

### Phase 1

Deliver basic telephony control:

- create `CRM Router App`
- route current Twilio number to that app
- build `POST /telephony/calls/outbound`
- build `GET /telephony/calls`
- build `POST /telephony/agents/:agentRef/enabled`

### Phase 2

Deliver operator connectivity:

- create `Domain`
- create `Credentials`
- create `Agents`
- decide browser phone vs SIP hard/softphone

### Phase 3

Deliver AI:

- create `AI Agent App`
- add CRM tools
- add `eventsHook`
- support AI/human toggle per number or per business rule

### Phase 4

Deliver production hardening:

- replace default access key usage with dedicated API keys
- switch browser signaling to secure `wss://`
- add observability for SIP/RTP and app events
- add automated end-to-end telephony tests

## Useful Local References

For examples and patterns:

- [`/root/fonoster-library/nodejs-voiceapp/src/index.ts`](/root/fonoster-library/nodejs-voiceapp/src/index.ts)
- [`/root/fonoster-library/awesome/README.md`](/root/fonoster-library/awesome/README.md)
- [`/root/fonoster-library/seet/README.md`](/root/fonoster-library/seet/README.md)
- [`/root/fonoster-library/homer10/README.md`](/root/fonoster-library/homer10/README.md)

For current live-instance smoke tests:

- [`/root/fonoster-docker/API_TESTS.md`](/root/fonoster-docker/API_TESTS.md)
- [`/root/fonoster-twilio-test/fonoster_api_smoke.js`](/root/fonoster-twilio-test/fonoster_api_smoke.js)

- [`/root/fonoster-library/nodejs-voiceapp/src/index.ts`](/root/fonoster-library/nodejs-voiceapp/src/index.ts)
- [`/root/fonoster-library/awesome/README.md`](/root/fonoster-library/awesome/README.md)
- [`/root/fonoster-library/seet/README.md`](/root/fonoster-library/seet/README.md)
- [`/root/fonoster-library/homer10/README.md`](/root/fonoster-library/homer10/README.md)

For current live-instance smoke tests:

- [`/root/fonoster-docker/API_TESTS.md`](/root/fonoster-docker/API_TESTS.md)
- [`/root/fonoster-twilio-test/fonoster_api_smoke.js`](/root/fonoster-twilio-test/fonoster_api_smoke.js)
