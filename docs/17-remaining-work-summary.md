# Remaining Work Summary

## Purpose

This document replaces scattered “what is left” notes with one current summary.

It is based on the current repository state of:

- `onelink`
- `fonoster-pack`

It should be treated as the source of truth for remaining work until the next major milestone is completed.

## Current Status

### What is already in place

- `onelink` already acts as the control plane for telephony routing decisions
- `onelink` exposes internal bridge endpoints for:
  - `POST /internal/voice/inbound/route`
  - `POST /internal/voice/inbound/event`
- `onelink` persists telephony call sessions, telephony events, number bindings, routing policy, and voice conversation linkage
- `onelink` now accepts bridge authentication via shared-secret headers and bearer token compatibility
- `onelink` also accepts `X-Idempotency-Key` into the telephony event ingestion payload path
- voice provider separation exists in `onelink`:
  - `twilio`
  - `fonoster`
- `fonoster-pack` bridge now:
  - calls `onelink` for inbound route decisions
  - forwards runtime events back to `onelink`
  - uses retry, timeout, degraded mode, and route cache
- `fonoster-pack` runtime now:
  - emits the base event lifecycle
  - safely executes `reject`
  - safely executes `operator`
  - now executes `app` and `ai` through the local `app:<appRef>` handoff path

### What this means

The integration is no longer conceptual.

It is already a real split architecture:

- `onelink` = product and routing authority
- `fonoster-pack` = execution layer

But it is still not fully complete for a production “all base PBX + AI cases covered” rollout.

## Remaining Work

## P0

### 1. Validate executable `app` and `ai` routing on a real call

Current status:

- the Fonoster-side code path for bare `appRef` is implemented locally
- the runtime emits and executes `app:<appRef>` handoff through the patched local `apiserver`
- the native fallback test path is now proven on a real PSTN call:
  - answer
  - audible media on the PSTN leg
  - normal cleanup

Remaining work:

- validate this against real Onelink-driven `app` and `ai` decisions, not only the current local fallback

Recommended ownership:

- `fonoster-pack`

Reason:

- rollout validation still belongs in the execution layer

### 2. Run a full real end-to-end validation against live `onelink`

Current gap:

- bridge/runtime code is present
- `onelink` bridge endpoints are present
- but there is still no confirmed live end-to-end validation from real inbound DID to real conversation state and back

This validation must include:

- inbound reject flow
- inbound operator flow
- inbound app flow
- inbound AI flow
- operator disabled fallback
- out-of-office fallback
- event replay/idempotency behavior
- outbound call creation from `onelink`

### 3. Confirm the current public DID cutover and rollback path

Current status:

- the public test DID is now routed to `Onelink Voice Runtime`
- the current Fonoster-side fallback path has already been validated on a real external call

Remaining work:

- confirm the explicit rollback procedure once the live Onelink contract is enabled

### 4. Reconcile stale documentation in `16`

Current gap:

- `16-onelink-native-telephony-integration-plan.md` says several Fonoster-side items are already implemented
- but later in the same file it still contains the old “stub / log-only / not implemented” wording

This should be cleaned so operators do not read contradictory guidance.

Current status:

- this cleanup is now done in the repository docs

## P1

### 5. Decide the final Fonoster webphone strategy

Current gap:

- `onelink` already treats browser calling as Twilio-only by default
- Fonoster-side browser telephony is still not production-ready
- deployment notes still mention insecure signaling concerns

A final decision is required:

1. Implement production browser calling for Fonoster end-to-end
2. Keep Fonoster non-browser and make that product boundary explicit everywhere

### 6. Finish late media reconciliation

Current gap:

- recordings, transcripts, summaries, and late media metadata are not yet documented as fully closed end-to-end

This should cover:

- late-arriving recording references
- transcript references
- transcript text
- AI summary updates
- updating the existing `onelink` call session instead of creating fragmented state

### 7. Confirm operational rollout prerequisites on the Fonoster side

This is an operations checkpoint, not just code work.

Deployment notes still indicate items that must be re-validated during rollout:

- public DID cutover
- final operator and domain setup
- final private or restricted connectivity model between `onelink` and bridge
- final hardened signaling / browser policy

## P2

### 8. Extend telephony policy richness only after P0 is stable

`onelink` already has the first control-plane contract, but it is still intentionally minimal.

Possible later work:

- richer PBX-style rule chains
- explicit queue or ring-group policy
- telephony-specific business-hours behavior beyond current inbox-based out-of-office routing
- more explicit destination metadata in route decisions

This should not come before executable `app` / `ai` and real end-to-end validation.

## Repo-Specific Remaining Work

### `onelink`

Still needed:

- keep current bridge contract stable during live rollout
- validate bridge env wiring against the real server
- validate the current bare-`app_ref` contract against the real patched Fonoster-side runtime path
- complete live e2e validation from inbound call to persisted conversation state

Not a blocker right now:

- Twilio provider separation is already in place
- Twilio remains a separate voice provider/channel path
- Fonoster browser calling is already not over-promised in the current product behavior

### `fonoster-pack`

Still needed:

- real end-to-end validation with live `onelink`
- final browser-calling decision and hardening
- late recording/transcript/summary reconciliation validation

## Recommended Completion Order

1. Connect live `onelink` and bridge with final env values
2. Replace fallback routing with real Onelink business decisions
3. Run real inbound and outbound e2e tests
4. Validate rollback from the current runtime route
5. Freeze the integration contract
6. Only then move to richer PBX features

## Definition Of Done

The telephony integration should be considered functionally complete only when all of the following are true:

- inbound `reject`, `operator`, `app`, and `ai` work against the live stack under real Onelink decisions
- route fallback works when operator is unavailable
- out-of-office behavior works against the live stack
- events are forwarded back and persisted idempotently in `onelink`
- outbound calls from `onelink` work against the live bridge
- the public DID is cut over to the intended runtime
- the chosen webphone strategy is explicit and not misleading
- docs no longer contradict the actual implementation state

## Read After This

- [`15-status-summary.md`](./15-status-summary.md)
- [`16-onelink-native-telephony-integration-plan.md`](./16-onelink-native-telephony-integration-plan.md)
- [`10-open-items.md`](./10-open-items.md)
