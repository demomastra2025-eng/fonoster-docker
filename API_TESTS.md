# Fonoster API Tests

This instance is reachable for API/SDK integration at:

- `cloud.vconsult.kz:443` for the Node SDK client
- `https://cloud.vconsult.kz` for browser/UI traffic

## What The Public SDK/API Can Do

The current self-hosted stack exposes enough API for a CRM integration layer to:

- log in with workspace credentials or API keys
- create/list/get/update/delete `Applications`
- create/list/get/update/delete `Numbers`
- create/list/get/update/delete `Trunks`
- create/list/get/update/delete `Domains`
- create/list/get/update/delete `Agents`
- create/list/get/update/delete `Credentials`
- create/list/get/update/delete `Secrets`
- create outbound calls with `Calls.createCall`
- retrieve call history with `Calls.listCalls` and `Calls.getCall`
- create an ephemeral browser/webphone token with `Applications.createTestToken`

## What The Public SDK/API Does Not Expose As A Generic Admin Action

For an inbound PSTN call there is no regular admin endpoint like:

- `acceptCall(ref)`
- `rejectCall(ref)`
- `cancelInboundCall(ref)`

Those actions are handled inside the voice application that receives the call.

In practice:

- to accept an inbound call, the app runs `voice.answer()`
- to end/reject it, the app runs `voice.hangup()`
- to transfer or bridge it, the app uses `voice.dial(...)`

See the local source:

- [`/root/fonoster/mods/voice/src/VoiceResponse.ts`](/root/fonoster/mods/voice/src/VoiceResponse.ts)

## Current Working Smoke Test

A reusable smoke test script lives here:

- [`/root/fonoster-twilio-test/fonoster_api_smoke.js`](/root/fonoster-twilio-test/fonoster_api_smoke.js)

Run read-only checks:

```bash
cd /root/fonoster-twilio-test
node fonoster_api_smoke.js
```

Run an outbound API call test:

```bash
cd /root/fonoster-twilio-test
RUN_CREATE_CALL=1 \
CALL_FROM='tel:+18623964686' \
CALL_TO='tel:+18623964686' \
APP_REF='74fec1f6-48e8-436c-8147-9176a5da4fa4' \
node fonoster_api_smoke.js
```

Adjust `CALL_FROM` and `CALL_TO` to your real test numbers. The script prints streamed dial statuses from `Calls.createCall`.

## Recommended CRM Integration Pattern

Because the main CRM is on another server, the clean integration shape is:

1. CRM backend calls Fonoster via `@fonoster/sdk`
2. Fonoster routes inbound calls into an `EXTERNAL` app or `AUTOPILOT` app
3. That app calls back into the CRM over HTTP/gRPC
4. CRM stores business state, toggles AI, decides routing, and exposes tools/webhooks

## Practical Mapping For CRM Features

- Turn AI on/off:
  - update a `Number` so it points to an AI app via `appRef`, or route to a live agent via `agentAor`
- Turn calling on/off:
  - disable agents with `Agents.updateAgent({ enabled: false })`
  - detach/repoint numbers and trunks as needed
- Launch outbound calls:
  - use `Calls.createCall`
- Show history in CRM:
  - use `Calls.listCalls` and `Calls.getCall`
- Browser softphone in CRM:
  - use `Applications.createTestToken` as the starting point for SIP-over-WebSocket/browser calling

## Current Verified API State On This Server

The SDK was tested successfully against the live instance with:

- login
- `listApplications`
- `listNumbers`
- `listTrunks`
- `listCalls`
- `createTestToken`

At the time of writing the instance returned:

- `1` application
- `1` number
- `1` trunk
- valid ephemeral test token data including signaling server
