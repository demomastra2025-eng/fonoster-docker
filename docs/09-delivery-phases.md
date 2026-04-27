# Delivery Phases

## Phase 1: Platform Baseline

Goal:

- keep Fonoster stable and documented

Deliverables:

- working public domain
- verified SDK/API smoke tests
- test DID routed into Fonoster

## Phase 2: Integration Skeleton

Goal:

- introduce the bridge and the thin Node voice runtime

Deliverables:

- bridge repository
- Fonoster SDK client wrapper
- Node runtime that calls the bridge for routing
- first inbound route decision endpoint

## Phase 3: Chatwoot MVP

Goal:

- make telephony usable from Chatwoot

Deliverables:

- outbound click-to-call
- inbound route to operator
- inbound route to AI
- call history sync
- conversation note updates

## Phase 4: Operator Connectivity

Goal:

- give live agents real telephony endpoints

Deliverables:

- domains
- credentials
- agents
- initial browser-phone or SIP client strategy

## Phase 5: AI Maturity

Goal:

- make AI useful in production

Deliverables:

- Autopilot app
- tools calling the bridge
- eventsHook processing
- human handoff
- summaries and transcripts

## Phase 6: Hardening

Goal:

- production readiness

Deliverables:

- proper API keys instead of defaults
- secure webphone signaling
- telemetry and SIP tracing
- automated end-to-end tests
