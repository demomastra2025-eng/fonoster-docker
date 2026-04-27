# Onelink Server Checklist

## Purpose

This is the current rollout checklist for the real `onelink` server.

Use this instead of the older Chatwoot-oriented checklist when wiring the live
Onelink deployment to the Fonoster-side bridge/runtime.

## Phase A: Networking

- confirm the Onelink server can reach the bridge host
- decide whether the bridge stays localhost-only behind a private proxy, VPN, or other restricted path
- ensure the bridge is not opened broadly to the public Internet

## Phase B: Bridge Configuration On The Fonoster Side

- set `TELEPHONY_BRIDGE_ONELINK_BASE_URL`
- set `TELEPHONY_BRIDGE_ONELINK_ACCESS_TOKEN` if bearer auth is used
- set `TELEPHONY_BRIDGE_ONELINK_ACCOUNT_ID` if account scoping is required
- confirm `TELEPHONY_BRIDGE_SHARED_SECRET` matches the value expected by Onelink for internal calls
- verify `POST /internal/voice/inbound/route` and `POST /internal/voice/inbound/event` are reachable from the bridge to Onelink

## Phase C: Onelink Contract Validation

### Inbound Route Endpoint

Validate that Onelink accepts:

- `call_ref` and `callRef`
- `ingress_number` and `ingressNumber`
- `caller_number` and `callerNumber`
- `received_at` and `receivedAt`
- `metadata`

Validate that Onelink returns one of:

- `reject`
- `operator`
- `app`
- `ai`

For `operator`, `app`, and `ai`, validate whether the returned decision includes:

- `destination`
- `phone_number`
- `agent_aor` / `agentAor`
- or only bare `app_ref`

If only bare `app_ref` is returned, validate it against the current local
Fonoster-side `app:<appRef>` handoff path instead of treating it as an automatic blocker.

### Inbound Event Endpoint

Validate that Onelink accepts:

- bridge-authenticated event requests
- `X-Idempotency-Key`
- repeated event delivery without duplicating business state

## Phase D: Product Command Validation

Validate Onelink-side calls into the bridge for:

- `POST /telephony/calls/outbound`
- `POST /telephony/numbers/:numberRef/route`
- `POST /telephony/ai/toggle`
- `POST /telephony/agents/:agentRef/enabled`
- `GET /telephony/calls`

Treat `/telephony/webphone/token` as test-grade only unless the browser strategy is explicitly finalized.

## Phase E: End-To-End Call Validation

Minimum live validation:

- inbound reject flow
- inbound operator flow
- inbound app flow
- inbound AI flow
- operator disabled fallback
- out-of-office fallback
- event idempotency / replay behavior
- outbound call creation from Onelink

Current note:

- the Fonoster-side fallback demo path is already validated
- this phase is now specifically about validating real Onelink-driven business decisions

## Phase F: Public DID Cutover

- confirm the public DID is still pointing to `Onelink Voice Runtime`
- confirm the current bridge fallback route is only a temporary safety behavior before Onelink is connected
- confirm rollback path before live cutover

## Phase G: Rollback Readiness

- confirm the old demo path can still be restored quickly
- confirm bridge fallback reject behavior is safe if Onelink is unavailable
- confirm operators know whether the system is in demo, degraded, or real runtime mode

## Current Known Warning

The main unresolved gap is now live Onelink integration, not local Fonoster execution.

Bare `app_ref` execution and native audio playback are already proven on the
current Fonoster-side deployment. The remaining work is validating real
Onelink business decisions and product flows over the same runtime path.
