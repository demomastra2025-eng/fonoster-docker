# Node Voice Runtime

## Why It Exists

Even though the main CRM is not Node, a thin Node voice runtime still makes sense because Fonoster external voice apps are naturally built around `@fonoster/voice`.

## What It Does Today

The runtime now exists locally as:

- service: `fonoster-docker-voice-runtime-1`
- internal endpoint: `voice-runtime:50062`
- Fonoster application:
  - name: `Onelink Voice Runtime`
  - ref: `96fc259c-6bcd-4cbf-bb7d-d2c51f248934`

The Node runtime is intentionally thin.

It should:

- receive the incoming voice session from Fonoster
- send the session context to the bridge
- execute the returned decision
- report call-time events back to the bridge

## What It Should Not Do

It should not become a second business backend.

Avoid putting these there:

- Chatwoot domain logic
- contact ownership rules
- operator selection strategy
- policy configuration
- tenant-specific product logic

## Typical Runtime Actions

Based on bridge instructions, the runtime may:

- `answer()`
- `say()`
- `dial()`
- `hangup()`

Relevant source:

- [`/root/fonoster/mods/voice/src/VoiceResponse.ts`](/root/fonoster/mods/voice/src/VoiceResponse.ts)
- [`/root/fonoster-docker/voice-runtime/src/runtime.js`](/root/fonoster-docker/voice-runtime/src/runtime.js)

## Current Implemented Actions

- `reject`
- `operator`
- `app`
- `ai`

Current implementation detail:

- when the bridge returns a bare `appRef`, the runtime now dials an internal destination in the form `app:<appRef>`
- the local patched `apiserver` converts that into an internal Fonoster voice leg with the correct `APP_REF`, `CALL_REF`, `CALL_DIRECTION`, `INGRESS_NUMBER`, and `METADATA`
- this closes the earlier code gap where `app` and `ai` were only executable with a pre-resolved dialable destination

## Suggested Response Contract From The Bridge

Examples:

```json
{ "action": "reject", "message": "We are currently closed." }
```

```json
{ "action": "operator", "agentAor": "sip:1001@company.example" }
```

```json
{ "action": "ai", "appRef": "00000000-0000-0000-0000-000000000000" }
```

## Current Runtime Event Flow

The runtime sends these event types back to the bridge:

- `session_started`
- `decision_received`
- `dial_status`
- `answered`
- `session_completed`
- `session_failed`
- `unsupported_action`

## Why This Split Is Healthy

- Chatwoot stays the business system
- the bridge stays the orchestration layer
- Node stays the runtime executor
- Fonoster stays the telephony platform
