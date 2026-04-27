# Onelink Native Telephony Integration Plan

## Goal

Make `onelink` the control plane and `fonoster-pack` the execution layer.

This means:

- all business-level telephony management lives in `onelink`
- `fonoster-pack` executes calls, route changes, AI toggles, and runtime actions fast and predictably
- the bridge/runtime must not invent independent product logic when `onelink` already owns it

## Target Architecture

### `onelink`

Owns:

- voice inbox setup
- number-to-inbox binding
- default route policy
- operator route, AI route, app route, reject route
- off-hours decision
- out-of-office message
- agent enable/disable state mirrored from product actions
- call session persistence
- conversation/contact linkage
- transcript/recording/summary storage
- dashboard/admin UI

### `fonoster-pack`

Owns:

- live SDK/API execution against Fonoster
- fast local route application
- inbound call runtime execution
- outbound call execution
- event emission back to `onelink`
- reliability, retry, timeout, and circuit-breaking behavior

## Onelink Contract To Consume

The bridge/runtime should treat these `onelink` endpoints as the source of truth:

- `POST /internal/voice/inbound/route`
- `POST /internal/voice/inbound/event`

`onelink` already also exposes product-facing bridge commands for management:

- `POST /api/v1/accounts/:account_id/telephony/numbers/:number_ref/route`
- `POST /api/v1/accounts/:account_id/telephony/ai/toggle`
- `POST /api/v1/accounts/:account_id/telephony/agents/:agent_ref/enabled`
- `POST /api/v1/accounts/:account_id/telephony/webphone/token`
- `POST /api/v1/accounts/:account_id/telephony/calls/outbound`

The bridge should keep its public telephony surface, but the inbound decision path must defer to `onelink`.

## Implementation Status On 2026-04-27

Already implemented on the Fonoster side:

- `src/chatwoot.js` now acts as an `onelink` client with:
  - timeout
  - bounded retries with backoff
  - circuit-breaker style degraded mode
  - short-lived inbound route cache
- `src/routeDecision.js` now:
  - prefers upstream `onelink` decisions
  - uses local defaults only as emergency fallback
  - now accepts executable `app` or `ai` routes when `appRef` or a dialable target is present
- `POST /internal/voice/inbound/event` now forwards events to `onelink` when configured
- `voice-runtime` now emits:
  - `session_started`
  - `decision_received`
  - `dial_status`
  - `answered`
  - `session_completed`
  - `session_failed`
  - `unsupported_action`
- `voice-runtime` can execute:
  - `reject`
  - `operator`
  - `app`
  - `ai`
- local `apiserver` is now built from source and patched to support internal
  `app:<appRef>` destinations
- the current test DID is already routed to `Onelink Voice Runtime`, with the
  runtime app used as the DID entrypoint for Onelink-controlled routing
- the current Gemini Live AI app target is
  `7b9f0bbd-eac4-46e4-80a8-7b3d5341c9f8`
- the current runtime app entrypoint is
  `96fc259c-6bcd-4cbf-bb7d-d2c51f248934`
- the current smoke-test operator target is
  `sip:1001@operator.cloud.vconsult.kz`

Still not complete:

- a production-grade browser telephony story
- late recording/transcript/summary reconciliation
- true end-to-end validation against a live Onelink server and a real external call

## Remaining Real Gaps In `fonoster-pack`

### `telephony-bridge`

Current issues:

- `POST /telephony/webphone/token` returns a test token, not a production browser-telephony contract

### `voice-runtime`

Current issues:

- late recording/transcript/summary reconciliation is not closed

## Current Technical Conclusion About `appRef`

On this local deployment, the earlier bare-`appRef` execution gap is now closed.

Current implementation:

- the runtime converts `appRef` into `app:<appRef>`
- the patched local `apiserver` recognizes that internal destination and originates a new internal Fonoster voice leg with the correct application context
- this allows `app` and `ai` decisions to execute without a separately pre-resolved PSTN or SIP destination

What is still not proven yet:

- a real external PSTN call has not yet been validated through this new path on the live stack
- the Onelink-side contract still needs live confirmation against the real server

## Required Work In `fonoster-pack`

## P0

### 1. Keep `onelink` as the authoritative inbound route source

Status:

- implemented on the Fonoster side

Keep validated during rollout:

- `lookupInboundContext` must continue calling `POST /internal/voice/inbound/route`
- local default route config must remain emergency fallback only

Expected request payload to `onelink`:

- `call_ref` or `callRef`
- `ingress_number` or `ingressNumber`
- `caller_number` or `callerNumber`
- `direction`
- `received_at` or `receivedAt`
- `metadata`

### 2. Forward runtime events to `onelink`

Status:

- implemented on the Fonoster side

Keep validated during rollout:

- `POST /internal/voice/inbound/event` must keep forwarding the body to `onelink`
- preserve idempotency keys when present
- preserve both snake_case and camelCase compatibility where practical

Minimum events to forward:

- `session_started`
- `decision_received`
- `dial_status`
- `answered`
- `session_completed`
- `session_failed`
- `unsupported_action`

### 3. Support all base route actions expected from `onelink`

Files:

- `fonoster-docker/voice-runtime/src/runtime.js`

Status:

- implemented on the Fonoster side

Keep validated during rollout:

- `reject`: answer/say/hangup when needed
- `operator`: dial live operator target such as
  `sip:1001@operator.cloud.vconsult.kz`
- `app`: execute through local `app:<appRef>` handoff or a provided dialable
  target
- `ai`: execute through the same local app handoff path, currently using
  Gemini Live app ref `7b9f0bbd-eac4-46e4-80a8-7b3d5341c9f8`
- runtime should still fail loudly if neither `appRef` nor an executable target is present
- live `app` and `ai` decisions must not return runtime app ref
  `96fc259c-6bcd-4cbf-bb7d-d2c51f248934`; that app is the DID entrypoint, not
  a target for recursive call handoff

### 4. Add reliability around `onelink` connectivity

Status:

- implemented on the Fonoster side

Keep validated during rollout:

- timeout to `onelink`
- bounded retries with backoff
- clear error classification:
  - timeout
  - auth failure
  - bad payload
  - upstream unavailable
- circuit-breaker or temporary degraded mode when `onelink` is down
- structured logs with `callRef`, `numberRef`, `action`, `decision reason`, and latency

### 5. Add route snapshot caching in the bridge

Goal:

- keep inbound routing fast even if `onelink` has a temporary spike

Status:

- implemented as a short-lived in-memory cache on the Fonoster side

Keep validated during rollout:

- cache the last successful route decision or number policy snapshot per `numberRef`
- cache invalidation should happen when:
  - route changes
  - AI toggle changes
  - operator enabled state changes

This cache is an optimization only.
`onelink` remains the source of truth.

## P1

### 6. Close the webphone/browser story honestly

Current state:

- `onelink` now does not claim browser calling for Fonoster by default
- bridge still exposes `/telephony/webphone/token`, but current implementation is test-grade

Required decision:

- either implement a real browser telephony contract end-to-end
- or keep Fonoster webphone explicitly non-browser and do not expose misleading capability flags

### 7. Recording, transcript, and summary completion

Required behavior:

- if Fonoster side can produce recording refs, transcript refs, summaries, or transcript text, send them back via `POST /internal/voice/inbound/event`
- late-arriving media metadata must update the existing call session in `onelink`

### 8. Operator presence quality

Current `onelink` product state:

- `enabled/disabled` for telephony agents is tracked

Desired bridge/runtime improvement:

- optionally combine local SIP registration / live presence / last heartbeat with product-level `enabled`
- do not route to an operator who is both disabled in `onelink` and unavailable in runtime

## Native PBX + AI Cases That Must Work

The integration should be considered functionally complete only when these cases are reliable:

### Base PBX cases

1. Inbound call to a live operator route
2. Inbound call to app route
3. Inbound call to AI route
4. Inbound call reject route with message
5. Out-of-office route fallback
6. Operator disabled -> fallback route
7. Unknown number -> safe reject
8. Bridge retry after transient `onelink` failure
9. Event replay/idempotent processing

### Outbound cases

1. Outbound from `onelink` to PSTN through bound number
2. Correct `app_ref` selection when AI mode is active
3. Call session created in `onelink`
4. Late status updates reconcile into the same call session

### AI cases

1. AI enabled -> route becomes AI immediately
2. AI disabled -> previous route restored correctly
3. AI disable on operator route restores operator
4. AI disable on app route restores app
5. AI route failure degrades predictably

## Performance Expectations

Target expectations for a good operator experience:

- inbound route decision should usually complete in low hundreds of milliseconds
- bridge should not do heavy SDK reads on every inbound call when the data is already known
- route changes should propagate fast, but execution should prefer a local snapshot over repeated deep reads

Avoid:

- calling multiple heavy Fonoster list/get endpoints during every inbound call
- recomputing policy from scratch in the runtime
- keeping separate business rules in `.env` and `onelink`

## Security Expectations

Required:

- shared secret validation on all internal bridge endpoints
- explicit outbound auth from bridge to `onelink`
- request body size limits
- log redaction for secrets/tokens
- no transcript or media URL leakage in plain debug logs

## Recommended Implementation Order

1. Keep the real `onelink` client contract stable during rollout
2. Finish fully executable `app` and `ai` routing
3. Run live end-to-end validation against the real `onelink` server
4. Add media/transcript completion flow
5. Revisit browser/webphone support only after the above is stable

## Done Criteria

The integration is “native and reliable” only when:

- `onelink` is the only place where route intent is managed
- bridge/runtime do not invent separate product logic
- runtime executes all supported actions without ambiguity
- all call events return to `onelink`
- off-hours and fallback behavior are consistent with `onelink`
- disabling an operator or toggling AI in `onelink` quickly affects live routing
- unknown/error states degrade to a safe reject path instead of hanging or misrouting the call
