# Fonoster-Side Execution Plan

## Purpose

Capture the remaining work that must be completed in `fonoster-pack` after the current `onelink` backend telephony layer is considered ready.

This document is intentionally scoped to the Fonoster side only:

- `telephony-bridge`
- `voice-runtime`
- Fonoster deployment and networking
- production validation and cutover

## Scope

This document covers:

- bridge hardening
- remaining runtime execution work
- deployment and server-side rollout work
- live validation work

This document does not cover:

- `onelink` frontend work
- `onelink` dashboard UX
- Twilio provider paths

## Current Facts

- `onelink` already exposes the control-plane backend needed by Fonoster:
  - route update
  - AI toggle
  - agent enable
  - outbound call creation
  - inbound route decision
  - inbound event ingestion
- `telephony-bridge` already exposes the expected bridge surface
- `voice-runtime` already handles the base call lifecycle
- `cloud.vconsult.kz` currently exposes the Fonoster dashboard, not a public bridge JSON surface
- `telephony-bridge` is currently bound locally and not yet exposed through the final cross-server connectivity model
- browser/webphone support is still not production-ready
- the Fonoster-side fallback runtime path is already validated end-to-end on a real inbound PSTN call

## P0

### 1. Remove unsafe bridge defaults and rotate live secrets

Why:

- the bridge config still contains hardcoded fallback credentials for a live endpoint
- this is the most urgent operational risk

What to do:

- remove all hardcoded live URLs, tokens, usernames, and secrets from bridge config
- require all live values from environment only
- rotate the already-used credentials on the live server after cleanup
- confirm no secret remains in:
  - repository files
  - compose env files
  - server shell history
  - CI or deployment notes

Primary files:

- `fonoster-docker/telephony-bridge/src/config.js`
- `fonoster-docker/compose.yaml`

### 2. Expose the bridge through a proper server-to-server connectivity model

Why:

- `onelink` must reach the bridge reliably
- the current public domain resolves to the Fonoster dashboard flow, not the bridge API
- localhost-only bridge binding is fine for local safety, but it is not enough for cross-server integration

What to do:

- choose one final connectivity model:
  - private network / VPN
  - reverse proxy on a dedicated internal hostname
  - restricted IP allowlist endpoint
- keep the bridge off the generic public dashboard path
- expose:
  - `GET /healthz`
  - `GET /telephony/capabilities`
  - the existing `/telephony/*` command surface
- keep shared-secret verification enabled
- verify timeouts and TLS behavior from the real `onelink` host

Primary files:

- `fonoster-docker/compose.yaml`
- `fonoster-docker/telephony-bridge/src/server.js`

### 3. Finish production execution for `app` and `ai`

Why:

- `reject` and `operator` are already workable
- `app` and `ai` are now executable locally, but still need validation under real Onelink-provided business decisions

What to do:

- keep the confirmed local `app:${appRef}` handoff path in place
- if native `appRef` execution is not sufficient, resolve the route in bridge before runtime execution
- do not keep silent downgrade behavior unless it is explicit and observable
- ensure the runtime emits a clear event when a route is downgraded or unsupported

Primary files:

- `fonoster-docker/voice-runtime/src/runtime.js`
- `fonoster-docker/telephony-bridge/src/routeDecision.js`
- `fonoster/mods/apiserver/src/voice/handlers/dial/createDialHandler.ts`

### 4. Switch the production DID to the real voice runtime path

Why:

- the new architecture is not truly live until the production inbound DID is routed to `Onelink Voice Runtime`

What to do:

- keep the current DID bound to the runtime app
- replace the current demo fallback decision with real Onelink-controlled routing
- document the rollback step before enabling live Onelink decisions

Primary files:

- `fonoster-docker/telephony-bridge/scripts/sync-voice-runtime-application.js`
- `fonoster-docker/voice-runtime/README.md`

### 5. Run a real end-to-end validation against live `onelink`

Why:

- the code is present, but live proof matters more than code shape here

Required validation:

1. inbound `reject`
2. inbound `operator`
3. inbound `app`
4. inbound `ai`
5. operator disabled fallback
6. off-hours fallback
7. outbound call from `onelink`
8. event replay / idempotency
9. late event reconciliation into the same call session

Success condition:

- every scenario completes through the real bridge/runtime stack and lands correctly in `onelink`

## P1

### 6. Validate late media and metadata delivery

Why:

- recordings, transcript data, summaries, and other late metadata usually arrive after the live call path

What to do:

- confirm the runtime or bridge sends late updates back to `onelink`
- verify updates do not create duplicate sessions
- verify final call state includes:
  - recording reference
  - transcript reference or transcript text
  - AI summary when available

Primary files:

- `fonoster-docker/voice-runtime/src/runtime.js`
- `fonoster-docker/voice-runtime/src/bridgeClient.js`
- `fonoster-docker/telephony-bridge/src/server.js`

### 7. Decide the final browser calling position

Why:

- browser telephony is currently test-grade
- the product should not imply support that is not hardened

Decision:

1. make browser calling production-ready end-to-end
2. explicitly keep Fonoster as non-browser for now

Recommended current choice:

- keep it explicitly non-browser until signaling, token, and deployment hardening are complete

Primary files:

- `fonoster-docker/telephony-bridge/src/server.js`
- `fonoster-docker/telephony-bridge/src/config.js`

### 8. Reduce operational risk around direct Routr DB route updates

Why:

- direct DB route writes are effective, but they are more operationally sensitive than a clean public API path

What to do:

- confirm the fallback DB path is still required on this deployment
- add explicit logging around route writes
- validate rollback behavior for route changes
- document ownership and failure modes

Primary files:

- `fonoster-docker/telephony-bridge/src/routrDb.js`

## P2

### 9. Clean stale or contradictory Fonoster docs

Why:

- some docs still describe older “stub” or “not implemented” behavior
- operators should not read conflicting implementation notes

What to update:

- `16-onelink-native-telephony-integration-plan.md`
- `17-remaining-work-summary.md`
- `voice-runtime/README.md` if runtime capabilities have moved ahead of the README

## Recommended Execution Order

1. remove hardcoded secrets and rotate credentials
2. finalize cross-server bridge connectivity
3. validate full end-to-end with the real `onelink`
4. validate rollback from the current runtime path
5. freeze the contract and update docs
6. only then move to later browser and media follow-up work

## Definition Of Done

Fonoster-side work should be considered complete only when all of the following are true:

- bridge secrets are environment-only and rotated
- `onelink` can reach the bridge through the intended production connectivity path
- inbound `reject`, `operator`, `app`, and `ai` all execute correctly under live Onelink decisions
- the production DID remains routed through `Onelink Voice Runtime`
- outbound calls from `onelink` work through the live bridge
- late media updates reconcile into the same `onelink` call session
- browser support is either production-ready or explicitly disabled as a product boundary
- docs no longer contradict the deployed behavior

## References

- [`16-onelink-native-telephony-integration-plan.md`](./16-onelink-native-telephony-integration-plan.md)
- [`17-remaining-work-summary.md`](./17-remaining-work-summary.md)
- [`19-final-handoff.md`](./19-final-handoff.md)
- [`/root/fonoster-docker/compose.yaml`](/root/fonoster-docker/compose.yaml)
- [`/root/fonoster-docker/telephony-bridge/src/config.js`](/root/fonoster-docker/telephony-bridge/src/config.js)
- [`/Users/akhanbakhitov/Documents/zeroprompt/fonoster-pack/fonoster-docker/telephony-bridge/src/server.js`](/Users/akhanbakhitov/Documents/zeroprompt/fonoster-pack/fonoster-docker/telephony-bridge/src/server.js)
- [`/Users/akhanbakhitov/Documents/zeroprompt/fonoster-pack/fonoster-docker/telephony-bridge/src/routrDb.js`](/Users/akhanbakhitov/Documents/zeroprompt/fonoster-pack/fonoster-docker/telephony-bridge/src/routrDb.js)
- [`/Users/akhanbakhitov/Documents/zeroprompt/fonoster-pack/fonoster-docker/voice-runtime/src/runtime.js`](/Users/akhanbakhitov/Documents/zeroprompt/fonoster-pack/fonoster-docker/voice-runtime/src/runtime.js)
- [`/Users/akhanbakhitov/Documents/zeroprompt/fonoster-pack/fonoster-docker/voice-runtime/src/bridgeClient.js`](/Users/akhanbakhitov/Documents/zeroprompt/fonoster-pack/fonoster-docker/voice-runtime/src/bridgeClient.js)
