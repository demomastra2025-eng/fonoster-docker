# Chatwoot Server Checklist

## Purpose

This file is now historical reference for the earlier Chatwoot-oriented design.

For the current Onelink-native rollout, use:

- [`18-onelink-server-checklist.md`](./18-onelink-server-checklist.md)
- [`16-onelink-native-telephony-integration-plan.md`](./16-onelink-native-telephony-integration-plan.md)
- [`17-remaining-work-summary.md`](./17-remaining-work-summary.md)

This is the concrete rollout checklist for the Chatwoot server team.

## Phase A: Networking

- confirm Chatwoot server can reach the bridge host
- decide whether the bridge will stay localhost-only or be exposed through a private reverse proxy
- if exposing the bridge, restrict access to the Chatwoot server or VPN/internal network

## Phase B: Configuration

- define `TELEPHONY_BRIDGE_BASE_URL` on the Chatwoot server
- define `TELEPHONY_BRIDGE_SHARED_SECRET` on the Chatwoot server if internal endpoints will be used
- define mapping storage for inboxes, users, conversations, and call refs

## Phase C: Backend Integration

- add a Rails bridge client
- add service objects for calls, routing, agents, and webphone
- add backend endpoints for the Chatwoot frontend
- normalize bridge responses into Chatwoot-friendly JSON

## Phase D: Frontend Integration

- add outbound call action
- add call history panel
- add AI on/off control
- add operator availability control

## Phase E: Validation

- test `GET /telephony/capabilities`
- test `GET /telephony/resources/summary`
- test `GET /telephony/calls`
- test `POST /telephony/calls/outbound`
- test `POST /telephony/ai/toggle`
- test `POST /telephony/agents/:agentRef/enabled`

## Phase F: Inbound Runtime Cutover

- connect the Node voice runtime to the bridge internal route endpoint
- point the production DID from the demo path to the real CRM runtime path
- test:
  - reject flow
  - operator flow
  - AI flow
  - fallback flow

## Phase G: Production Hardening

- replace default access-key workflows with dedicated API keys
- decide on secure `wss://` strategy for browser calling
- add logging and alerting around bridge errors
- define rollback path if Chatwoot integration is unavailable

## Quick Acceptance Criteria

The Chatwoot side is ready for the first MVP when:

- Chatwoot can trigger an outbound call through the bridge
- Chatwoot can read recent call history
- Chatwoot can toggle AI routing
- Chatwoot can enable and disable operator reachability
- inbound route decisions can be served by product logic instead of the default reject policy
