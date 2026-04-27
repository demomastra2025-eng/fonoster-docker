# Onelink to Fonoster Bridge API Contract

This document describes the Fonoster-side bridge endpoints that Onelink should
call for telephony management.

Current local bridge bind on the Fonoster server:

```text
http://127.0.0.1:38081
```

Production Onelink must not call `127.0.0.1`. `127.0.0.1` would mean the
Onelink/Rails server itself, not this Fonoster server.

Current remote bridge proxy for dev/staging:

```text
https://bridge.75.119.131.165.sslip.io
```

It is served by the Caddy reverse proxy on the Fonoster server:

```text
https://bridge.75.119.131.165.sslip.io -> http://fonoster-docker-telephony-bridge-1:3100
```

`GET /healthz` is intentionally open for basic uptime checks. The telephony
command endpoints are protected at the reverse proxy and require one of these
headers with the same value as Fonoster `TELEPHONY_BRIDGE_SHARED_SECRET`:

```http
X-Bridge-Secret: <shared secret>
X-Bridge-Shared-Secret: <shared secret>
Authorization: Bearer <shared secret>
```

The remote proxy intentionally exposes only:

- `GET /healthz`
- `/telephony/*`

It does not expose bridge-internal `/internal/voice/inbound/*` endpoints.
Those internal endpoints remain for Fonoster `voice-runtime -> telephony-bridge`
traffic inside the Fonoster server.

For Onelink/Rails, use:

```env
TELEPHONY_BRIDGE_BASE_URL=https://bridge.75.119.131.165.sslip.io
TELEPHONY_BRIDGE_SHARED_SECRET=<same value as Fonoster TELEPHONY_BRIDGE_SHARED_SECRET>
```

Do not expose this bridge broadly to the public Internet without an allowlist,
VPN, private network, reverse-proxy authentication, or equivalent protection.

## Current Onelink Dev URL

Current Onelink URL used for testing:

```text
https://work.one-link.kz
```

Latest probe result on 2026-04-27:

- Bridge `/healthz` is OK.
- Phone number `+18623964686` still reaches the runtime app.
- Internal route probe returns `action: "operator"` from Onelink.
- Onelink still returns stale placeholder AOR `sip:1001@company.example`; replace it with `sip:1001@operator.cloud.vconsult.kz`.
- `POST /internal/voice/inbound/event` still needs repair. It previously returned HTTP `500`, but this is not a blocker for choosing the `operator` route.

Expected current operator route response:

```json
{
  "action": "operator",
  "agent_aor": "sip:1001@operator.cloud.vconsult.kz",
  "reason": "operator_route",
  "timeout": 30
}
```

Production rule: do not enable broad real Fonoster traffic until the Onelink
route endpoint returns an executable route with current production values.

Temporary status: this URL is enabled in the Fonoster bridge `.env` on
2026-04-27 for controlled smoke testing while OneLink finishes the browser
operator registration and event callback fix.

Current bridge configuration:

```env
TELEPHONY_BRIDGE_ONELINK_BASE_URL=https://work.one-link.kz
TELEPHONY_BRIDGE_ONELINK_ACCOUNT_ID=1
TELEPHONY_BRIDGE_ONELINK_ROUTE_PATH=/internal/voice/inbound/route
TELEPHONY_BRIDGE_ONELINK_EVENT_PATH=/internal/voice/inbound/event
```

## Current Live Fonoster Values

Use these values for the current test channel.

```text
phone_number: +18623964686
number_ref: d451bbe2-53d8-4458-bd0e-d811d85f57e0
runtime_app_ref: 96fc259c-6bcd-4cbf-bb7d-d2c51f248934
demo_app_ref: 74fec1f6-48e8-436c-8147-9176a5da4fa4
trunk_ref: a299c0e0-150b-4fc9-9a58-f44bb3634324
operator_agent_aor: sip:1001@operator.cloud.vconsult.kz
operator_sip_wss_url: wss://sip.75.119.131.165.sslip.io
```

`demo_app_ref` points to the current `Twilio Test App`. It is useful as a
temporary test route target, but it is not a final production AI application.

The current operator SIP password is stored only in the Fonoster server
`.env` as `TELEPHONY_BRIDGE_DEFAULT_OPERATOR_SIP_PASSWORD`; do not commit or
send it to browsers directly. Onelink should issue it to the browser operator
through a backend-authenticated session.

The active number route in Routr is currently:

```json
{
  "ref": "d451bbe2-53d8-4458-bd0e-d811d85f57e0",
  "aor_link": "sip:voice@default",
  "extra_headers": [
    {
      "name": "x-app-ref",
      "value": "96fc259c-6bcd-4cbf-bb7d-d2c51f248934"
    }
  ]
}
```

Important distinction for Onelink:

- `runtime_app_ref` is the Fonoster application that receives the initial
  inbound call and asks Onelink what to do.
- Do not return `runtime_app_ref` as the target `app_ref` from an Onelink route
  decision for the same inbound call. That can create a recursive app handoff.
- Use a separate real AI application ref for AI routing. The current
  `demo_app_ref` may be used only for smoke tests.
- Operator routing is available for the current smoke-test operator identity
  `sip:1001@operator.cloud.vconsult.kz`.

## Integration Directions

There are two separate API directions:

1. `Onelink -> Fonoster bridge`: CRM UI/backend commands such as outbound call,
   call list, number route change, and AI toggle.
2. `Fonoster bridge -> Onelink`: runtime callbacks for inbound route decisions
   and call lifecycle events.

For the current live bridge, Onelink should rely only on the endpoints described
in this file. Some repository docs mention extra event-stream endpoints, but the
currently running bridge container does not expose them yet.

## Common Rules

### Content Type

All POST requests use JSON.

```http
Content-Type: application/json
Accept: application/json
```

### Recommended Headers

The current local bridge does not enforce authentication on these public
telephony command endpoints by itself. The current remote proxy
`https://bridge.75.119.131.165.sslip.io` protects those endpoints with the
shared-secret headers listed above. These headers are also recommended for
tracing and future auth compatibility.

```http
X-Request-Id: <uuid generated by Onelink>
X-Account-Id: <onelink account id>
X-Idempotency-Key: <uuid for POST commands that must not be duplicated>
X-Bridge-Secret: <Fonoster TELEPHONY_BRIDGE_SHARED_SECRET>
Authorization: Bearer <Fonoster TELEPHONY_BRIDGE_SHARED_SECRET, if using bearer auth>
```

### Error Format

Validation errors normally return HTTP `400`.

```json
{
  "error": "from or from_number_ref is required"
}
```

Unexpected Fonoster SDK, SIP provider, or internal bridge failures can return
HTTP `500`.

```json
{
  "error": "internal error details"
}
```

## 1. Resource Summary

Returns the minimal resource inventory Onelink needs to create or verify a
telephony channel.

```http
GET /telephony/resources/summary
```

### Request

No body.

Optional query parameters: none.

### Response 200

```json
{
  "counts": {
    "applications": 2,
    "numbers": 1,
    "trunks": 1,
    "agents": 0,
    "domains": 0
  },
  "firsts": {
    "application": {
      "ref": "74fec1f6-48e8-436c-8147-9176a5da4fa4",
      "name": "Twilio Test App",
      "type": "EXTERNAL",
      "endpoint": "welcome.demo.fonoster.local"
    },
    "number": {
      "ref": "d451bbe2-53d8-4458-bd0e-d811d85f57e0",
      "name": "Twilio Test Number",
      "telUrl": "tel:+18623964686",
      "appRef": "96fc259c-6bcd-4cbf-bb7d-d2c51f248934"
    },
    "trunk": {
      "ref": "a299c0e0-150b-4fc9-9a58-f44bb3634324",
      "name": "Twilio Trunk",
      "sendRegister": false,
      "inboundUri": "wo00000000000000000000000000000000.75.119.131.165.sslip.io",
      "uris": [
        {
          "host": "75.119.131.165",
          "port": 5060,
          "transport": "TCP",
          "user": "voice",
          "weight": 0,
          "priority": 0,
          "enabled": true
        }
      ]
    },
    "agent": null,
    "domain": null
  }
}
```

### Response Fields

- `counts.applications`: number of Fonoster applications visible to the bridge.
- `counts.numbers`: number of DID/phone number resources.
- `counts.trunks`: number of SIP/PSTN trunks.
- `counts.agents`: number of Fonoster agents. Current value is `0`.
- `counts.domains`: number of SIP domains. Current value is `0`.
- `firsts.application`: first application returned by Fonoster SDK, or `null`.
- `firsts.number`: first phone number returned by Fonoster SDK, or `null`.
- `firsts.trunk`: first trunk returned by Fonoster SDK, or `null`.
- `firsts.agent`: first agent returned by Fonoster SDK, or `null`.
- `firsts.domain`: first domain returned by Fonoster SDK, or `null`.

### Curl

```bash
curl -sS "$BRIDGE_BASE_URL/telephony/resources/summary" \
  -H "X-Bridge-Secret: $TELEPHONY_BRIDGE_SHARED_SECRET" | jq .
```

## 2. Create Outbound Call

Creates an outbound PSTN call through Fonoster.

```http
POST /telephony/calls/outbound
```

### Request Body

Use `from_number_ref` for normal Onelink usage. The bridge resolves it to the
current Fonoster number URL.

```json
{
  "from_number_ref": "d451bbe2-53d8-4458-bd0e-d811d85f57e0",
  "to": "tel:+77475318623",
  "app_ref": "74fec1f6-48e8-436c-8147-9176a5da4fa4",
  "timeout": 30,
  "metadata": {
    "onelink_account_id": "1",
    "onelink_conversation_id": "123",
    "onelink_contact_id": "456",
    "initiated_by": "agent"
  }
}
```

### Request Fields

- `from_number_ref` optional if `from` is present. Fonoster number reference.
- `from` optional if `from_number_ref` is present. Direct source number, preferably in `tel:+...` format.
- `to` required. Destination number, preferably in `tel:+...` format.
- `app_ref` required for predictable behavior. Fonoster application used for the call flow.
- `appRef` accepted alias for `app_ref`.
- `timeout` optional. Call setup timeout in seconds.
- `metadata` optional object. Stored/passed to Fonoster call creation.
- `ai_enabled` optional boolean. If `true` and `app_ref` is absent, bridge tries `ai_app_ref` or its default AI app ref.
- `ai_app_ref` optional. App ref used when `ai_enabled=true`.

Recommended current values:

```text
from_number_ref: d451bbe2-53d8-4458-bd0e-d811d85f57e0
app_ref: 74fec1f6-48e8-436c-8147-9176a5da4fa4 for demo tests
```

### Response 201

Current running bridge returns a minimal response:

```json
{
  "ref": "77d76948-658d-4f41-a951-cfbef74a54f4",
  "from": "tel:+18623964686",
  "to": "tel:+77475318623"
}
```

Treat `ref` as the Fonoster call reference. Onelink should store it as
`fonoster_call_ref`.

### Response Fields

- `ref`: Fonoster call reference.
- `from`: source number used for the call.
- `to`: destination number requested by Onelink.

### Validation Errors

Missing source number:

```json
{
  "error": "from or from_number_ref is required"
}
```

Missing destination:

```json
{
  "error": "to is required"
}
```

### Curl

```bash
curl -sS -X POST "$BRIDGE_BASE_URL/telephony/calls/outbound" \
  -H "Content-Type: application/json" \
  -H "X-Bridge-Secret: $TELEPHONY_BRIDGE_SHARED_SECRET" \
  -H "X-Request-Id: $(uuidgen)" \
  -H "X-Idempotency-Key: $(uuidgen)" \
  -d '{
    "from_number_ref": "d451bbe2-53d8-4458-bd0e-d811d85f57e0",
    "to": "tel:+77475318623",
    "app_ref": "74fec1f6-48e8-436c-8147-9176a5da4fa4",
    "timeout": 30,
    "metadata": {
      "source": "onelink"
    }
  }' | jq .
```

## 3. Set Number Route

Changes how an inbound call to a Fonoster number is routed.

```http
POST /telephony/numbers/:numberRef/route
```

For the current test number:

```http
POST /telephony/numbers/d451bbe2-53d8-4458-bd0e-d811d85f57e0/route
```

### Supported Modes

- `ai`: route to a Fonoster application using `app_ref`.
- `app`: route to a Fonoster application using `app_ref`.
- `operator`: route directly to an operator SIP AOR using `agent_aor`.

Current Onelink persisted routing policy should use only `ai`, `app`, or
`operator`. The bridge also accepts `clear` as an operational reset mode, but
`clear` is not a normal persisted Onelink routing mode.

### Request Body: AI/App Route

```json
{
  "mode": "app",
  "app_ref": "96fc259c-6bcd-4cbf-bb7d-d2c51f248934"
}
```

or:

```json
{
  "mode": "ai",
  "app_ref": "74fec1f6-48e8-436c-8147-9176a5da4fa4"
}
```

### Request Body: Operator Route

Use the current smoke-test operator AOR:

```json
{
  "mode": "operator",
  "agent_aor": "sip:1001@operator.cloud.vconsult.kz"
}
```

The browser operator must register over WSS `wss://sip.75.119.131.165.sslip.io`
with username `1001` and the password issued by the backend-authenticated
session.

### Request Body: Bridge-Only Clear Route

```json
{
  "mode": "clear"
}
```

Use `clear` only for bridge reset/fallback operations. Do not expose it as a
normal Onelink routing policy mode.

### Request Fields

- `mode` required. One of `ai`, `app`, `operator`. Bridge-only reset also accepts `clear`.
- `app_ref` required when `mode=ai` or `mode=app`.
- `appRef` accepted alias for `app_ref`.
- `agent_aor` required when `mode=operator`.
- `agentAor` accepted alias for `agent_aor`.

### Response 200: AI/App Route

```json
{
  "ref": "d451bbe2-53d8-4458-bd0e-d811d85f57e0",
  "mode": "app",
  "routeState": {
    "ref": "d451bbe2-53d8-4458-bd0e-d811d85f57e0",
    "aor_link": "sip:voice@default",
    "extra_headers": [
      {
        "name": "x-app-ref",
        "value": "96fc259c-6bcd-4cbf-bb7d-d2c51f248934"
      }
    ],
    "updated_at": "2026-04-19T12:00:00.000Z"
  }
}
```

### Response 200: Operator Route

```json
{
  "ref": "d451bbe2-53d8-4458-bd0e-d811d85f57e0",
  "mode": "operator",
  "routeState": {
    "ref": "d451bbe2-53d8-4458-bd0e-d811d85f57e0",
    "aor_link": "sip:1001@operator.cloud.vconsult.kz",
    "extra_headers": null,
    "updated_at": "2026-04-19T12:00:00.000Z"
  }
}
```

### Validation Errors

Missing mode:

```json
{
  "error": "mode is required"
}
```

Missing app ref:

```json
{
  "error": "app_ref is required"
}
```

Missing operator AOR:

```json
{
  "error": "agent_aor is required"
}
```

Unsupported mode:

```json
{
  "error": "unsupported mode"
}
```

### Curl

```bash
curl -sS -X POST "$BRIDGE_BASE_URL/telephony/numbers/d451bbe2-53d8-4458-bd0e-d811d85f57e0/route" \
  -H "Content-Type: application/json" \
  -H "X-Bridge-Secret: $TELEPHONY_BRIDGE_SHARED_SECRET" \
  -d '{
    "mode": "app",
    "app_ref": "96fc259c-6bcd-4cbf-bb7d-d2c51f248934"
  }' | jq .
```

## 4. Toggle AI For Number

Convenience endpoint for switching a number into AI route mode and restoring a
fallback route when AI is disabled.

```http
POST /telephony/ai/toggle
```

### Request Body: Enable AI

The `ai_app_ref` below uses the current demo app for smoke testing. Replace it
with the real AI app ref when the production AI application exists.

```json
{
  "number_ref": "d451bbe2-53d8-4458-bd0e-d811d85f57e0",
  "enabled": true,
  "ai_app_ref": "74fec1f6-48e8-436c-8147-9176a5da4fa4"
}
```

### Request Body: Disable AI And Restore App Route

```json
{
  "number_ref": "d451bbe2-53d8-4458-bd0e-d811d85f57e0",
  "enabled": false,
  "fallback_mode": "app",
  "fallback_app_ref": "96fc259c-6bcd-4cbf-bb7d-d2c51f248934"
}
```

### Request Body: Disable AI And Clear Route

```json
{
  "number_ref": "d451bbe2-53d8-4458-bd0e-d811d85f57e0",
  "enabled": false,
  "fallback_mode": "clear"
}
```

### Request Body: Disable AI And Restore Operator Route

Only use after a real Fonoster agent/domain exists.

```json
{
  "number_ref": "d451bbe2-53d8-4458-bd0e-d811d85f57e0",
  "enabled": false,
  "fallback_mode": "operator",
  "fallback_agent_aor": "sip:1001@company.example"
}
```

### Request Fields

- `number_ref` required. Fonoster number reference.
- `numberRef` accepted alias for `number_ref`.
- `enabled` required boolean.
- `ai_app_ref` required when `enabled=true`.
- `aiAppRef` accepted alias for `ai_app_ref`.
- `fallback_mode` optional when `enabled=false`. Default is `clear`.
- `fallbackMode` accepted alias for `fallback_mode`.
- `fallback_app_ref` required when `enabled=false` and `fallback_mode=app`.
- `fallbackAppRef` accepted alias for `fallback_app_ref`.
- `fallback_agent_aor` required when `enabled=false` and `fallback_mode=operator`.
- `fallbackAgentAor` accepted alias for `fallback_agent_aor`.

### Response 200

```json
{
  "numberRef": "d451bbe2-53d8-4458-bd0e-d811d85f57e0",
  "enabled": true,
  "appliedMode": "ai",
  "routeState": {
    "ref": "d451bbe2-53d8-4458-bd0e-d811d85f57e0",
    "aor_link": "sip:voice@default",
    "extra_headers": [
      {
        "name": "x-app-ref",
        "value": "74fec1f6-48e8-436c-8147-9176a5da4fa4"
      }
    ],
    "updated_at": "2026-04-19T12:00:00.000Z"
  }
}
```

### Validation Errors

Missing number ref:

```json
{
  "error": "number_ref is required"
}
```

Invalid enabled value:

```json
{
  "error": "enabled must be boolean"
}
```

Missing AI app ref:

```json
{
  "error": "app_ref is required"
}
```

### Curl

```bash
curl -sS -X POST "$BRIDGE_BASE_URL/telephony/ai/toggle" \
  -H "Content-Type: application/json" \
  -H "X-Bridge-Secret: $TELEPHONY_BRIDGE_SHARED_SECRET" \
  -d '{
    "number_ref": "d451bbe2-53d8-4458-bd0e-d811d85f57e0",
    "enabled": true,
    "ai_app_ref": "74fec1f6-48e8-436c-8147-9176a5da4fa4"
  }' | jq .
```

## 5. List Calls

Returns recent calls from Fonoster.

```http
GET /telephony/calls
```

### Query Parameters

- `page_size` optional. Number of records to return.
- `page_token` optional. Pagination token returned by previous response.
- `from` optional. Filter by caller/source number.
- `to` optional. Filter by destination number.
- `status` optional. Pass-through Fonoster status filter.
- `type` optional. Pass-through Fonoster call type filter.
- `after` optional. ISO timestamp lower bound.
- `before` optional. ISO timestamp upper bound.

### Response 200

```json
{
  "items": [
    {
      "ref": "77d76948-658d-4f41-a951-cfbef74a54f4",
      "callId": "gxZ34k04sRJH.zqmpKmWawfBefVsv-2t",
      "type": "API_ORIGINATED",
      "status": "UNKNOWN",
      "startedAt": "2026-04-16T19:33:51.000Z",
      "endedAt": "2026-04-16T19:33:51.000Z",
      "from": "+18623964686",
      "to": "+77475318623",
      "duration": 0,
      "direction": "TO_PSTN"
    }
  ],
  "nextPageToken": "1776368047"
}
```

### Response Fields

- `items[].ref`: Fonoster call reference.
- `items[].callId`: lower-level provider/SIP call id, if available.
- `items[].type`: Fonoster call type, for example `API_ORIGINATED`.
- `items[].status`: Fonoster status, for example `UNKNOWN`.
- `items[].startedAt`: call start timestamp.
- `items[].endedAt`: call end timestamp.
- `items[].from`: source number.
- `items[].to`: destination number.
- `items[].duration`: duration in seconds.
- `items[].direction`: call direction, for example `TO_PSTN`.
- `nextPageToken`: token for the next page. Empty string means no next page.

### Curl

```bash
curl -sS "$BRIDGE_BASE_URL/telephony/calls?page_size=20" \
  -H "X-Bridge-Secret: $TELEPHONY_BRIDGE_SHARED_SECRET" | jq .
```

## 6. Endpoints Onelink Must Implement

These endpoints are called by the Fonoster bridge during a live inbound call.
They are separate from the `Onelink -> Fonoster bridge` command endpoints above.

Current Fonoster bridge config:

```env
TELEPHONY_BRIDGE_ONELINK_BASE_URL=https://akilah-deuteranomalous-blythe.ngrok-free.dev
TELEPHONY_BRIDGE_ONELINK_ACCOUNT_ID=1
TELEPHONY_BRIDGE_ONELINK_ROUTE_PATH=/internal/voice/inbound/route
TELEPHONY_BRIDGE_ONELINK_EVENT_PATH=/internal/voice/inbound/event
```

### 6.1 Inbound Route Decision

Onelink must return the call routing decision for the inbound call.

```http
POST /internal/voice/inbound/route
```

#### Headers Sent By Fonoster Bridge

```http
Content-Type: application/json
X-Account-Id: 1
X-Request-Id: <optional request id if available>
Authorization: Bearer <token, only if configured on Fonoster bridge>
```

#### Request Body

The bridge sends both snake_case and camelCase aliases for compatibility.
Onelink may read either style, but should store canonical snake_case or its own
internal canonical format.

```json
{
  "appRef": "96fc259c-6bcd-4cbf-bb7d-d2c51f248934",
  "callRef": "8411db93-f9fb-4e29-9209-6a2fddf8df95",
  "call_ref": "8411db93-f9fb-4e29-9209-6a2fddf8df95",
  "mediaSessionRef": "optional-media-session-ref",
  "ingressNumber": "+18623964686",
  "ingress_number": "+18623964686",
  "callerNumber": "+77066318623",
  "caller_number": "+77066318623",
  "callerName": null,
  "direction": "FROM_PSTN",
  "selfEndpoint": "optional-runtime-endpoint",
  "receivedAt": "2026-04-19T21:40:00.000Z",
  "received_at": "2026-04-19T21:40:00.000Z",
  "metadata": {}
}
```

#### Request Fields Onelink Should Use

- `call_ref` / `callRef`: unique call/session reference. Store it and use it to
  correlate all later events.
- `ingress_number` / `ingressNumber`: DID that was called. Use it to find the
  Onelink telephony channel.
- `caller_number` / `callerNumber`: customer phone number. Use it to find or
  create the contact/conversation.
- `direction`: expected value for inbound PSTN is `FROM_PSTN`.
- `appRef`: the Fonoster app currently handling the call. For the current
  channel this is the runtime app, not the target AI app.
- `metadata`: optional pass-through data.

#### Response 200: Reject

Use HTTP `200` for business-level rejection. Do not return HTTP `404` or `500`
for normal business states such as closed hours, blocked caller, or unbound
test number.

```json
{
  "action": "reject",
  "message": "We are currently closed.",
  "reason": "business_hours_closed"
}
```

Current temporary unbound response is accepted by the bridge but must be fixed
before production:

```json
{
  "action": "reject",
  "message": "We are unable to connect your call right now.",
  "reason": "number_not_bound"
}
```

For the configured test number `+18623964686`, `number_not_bound` means the
Onelink telephony channel is not correctly bound yet.

#### Response 200: Route To Application Or AI

Use this when Onelink wants the runtime to hand off the call to another
Fonoster application. Current Onelink returns snake_case `app_ref`; that is the
canonical response shape for the current integration.

```json
{
  "action": "ai",
  "app_ref": "74fec1f6-48e8-436c-8147-9176a5da4fa4",
  "reason": "ai_enabled",
  "timeout": 60,
  "transfer_message": "Please hold while I connect you."
}
```

Rules:

- `action=ai` or `action=app` must include `app_ref`.
- The target `app_ref` must be a real Fonoster application ref.
- Do not return `96fc259c-6bcd-4cbf-bb7d-d2c51f248934` as the target `app_ref`
  for the current inbound channel; that is the runtime app already handling the
  call.
- `74fec1f6-48e8-436c-8147-9176a5da4fa4` is only a demo smoke-test app.
  Replace it with the real AI app ref when production AI exists.
- The bridge/runtime can accept `appRef` as a compatibility alias, but current
  Onelink should emit snake_case `app_ref`.

#### Response 200: Route To Operator

Use this when Onelink wants a human/operator route.

```json
{
  "action": "operator",
  "agent_aor": "sip:1001@operator.cloud.vconsult.kz",
  "reason": "operator_route",
  "timeout": 30
}
```

Rules:

- Current Onelink returns snake_case `agent_aor`; that is the canonical current
  response shape.
- `operator` requires `agent_aor` in current Onelink behavior.
- The current smoke-test Fonoster SIP agent is
  `sip:1001@operator.cloud.vconsult.kz`.
- Current Onelink must not return stale placeholder AOR
  `sip:1001@company.example`.
- Browser operator registration must use WSS
  `wss://sip.75.119.131.165.sslip.io`, username `1001`, and the password from
  the backend-authenticated session.
- The current runtime extracts and dials the user part of `sip:user@domain`.

Bridge-accepted but not current Onelink output:

- `destination`
- `phoneNumber`
- `agentAor`

Treat these as future/compatibility aliases unless Onelink code is updated to
generate them.

#### Bad Responses To Avoid

These responses are syntactically valid JSON but are not executable:

```json
{
  "action": "ai"
}
```

```json
{
  "action": "operator"
}
```

```json
{
  "action": "operator",
  "agent_aor": "sip:1001@company.example"
}
```

```json
{
  "action": "app",
  "app_ref": "96fc259c-6bcd-4cbf-bb7d-d2c51f248934"
}
```

The first two have no target. The placeholder `company.example` AOR is not the
current operator domain. The last one points back to the same runtime app that
is already processing the inbound call.

#### Non-2xx Responses

The bridge treats non-2xx responses as upstream failures. It may retry, open a
circuit breaker, and use local fallback/cached decision. Therefore Onelink
should return HTTP `200` with `action=reject` for normal business rejections.

### 6.2 Inbound Event Sink

Onelink must accept call lifecycle events from the voice runtime.

```http
POST /internal/voice/inbound/event
```

#### Headers Sent By Fonoster Bridge

```http
Content-Type: application/json
X-Account-Id: 1
X-Idempotency-Key: <optional event idempotency key>
Authorization: Bearer <token, only if configured on Fonoster bridge>
```

#### Expected Response

Return a fast 2xx response. The bridge does not require a specific response
body, but this shape is recommended:

```json
{
  "status": "ok",
  "call_ref": "8411db93-f9fb-4e29-9209-6a2fddf8df95",
  "conversation_id": "12345"
}
```

#### Event Payload Examples

Session started:

```json
{
  "eventType": "session_started",
  "callRef": "8411db93-f9fb-4e29-9209-6a2fddf8df95",
  "call_ref": "8411db93-f9fb-4e29-9209-6a2fddf8df95",
  "mediaSessionRef": "optional-media-session-ref",
  "ingressNumber": "+18623964686",
  "ingress_number": "+18623964686",
  "callerNumber": "+77066318623",
  "caller_number": "+77066318623",
  "appRef": "96fc259c-6bcd-4cbf-bb7d-d2c51f248934",
  "direction": "FROM_PSTN",
  "metadata": {}
}
```

Decision received:

```json
{
  "eventType": "decision_received",
  "callRef": "8411db93-f9fb-4e29-9209-6a2fddf8df95",
  "call_ref": "8411db93-f9fb-4e29-9209-6a2fddf8df95",
  "decision": {
    "action": "reject",
    "reason": "number_not_bound"
  }
}
```

Answered:

```json
{
  "eventType": "answered",
  "callRef": "8411db93-f9fb-4e29-9209-6a2fddf8df95",
  "call_ref": "8411db93-f9fb-4e29-9209-6a2fddf8df95",
  "action": "operator",
  "agent_aor": "sip:1001@operator.cloud.vconsult.kz"
}
```

Dial status:

```json
{
  "eventType": "dial_status",
  "callRef": "8411db93-f9fb-4e29-9209-6a2fddf8df95",
  "call_ref": "8411db93-f9fb-4e29-9209-6a2fddf8df95",
  "action": "operator",
  "agent_aor": "sip:1001@operator.cloud.vconsult.kz",
  "status": "answered"
}
```

Current Onelink event ingestion expects normalized statuses from this set:
`answered`, `no-answer`, `busy`, `failed`. The Fonoster side normalizes raw
provider statuses before forwarding events to Onelink:

```text
ANSWER   -> answered
NOANSWER -> no-answer
BUSY     -> busy
FAILED   -> failed
CANCEL   -> failed
```

Do not send raw uppercase provider statuses such as `ANSWER`, `NOANSWER`,
`BUSY`, `FAILED`, or `CANCEL` to Onelink.

Session completed:

```json
{
  "eventType": "session_completed",
  "callRef": "8411db93-f9fb-4e29-9209-6a2fddf8df95",
  "call_ref": "8411db93-f9fb-4e29-9209-6a2fddf8df95",
  "outcome": "rejected"
}
```

Session failed:

```json
{
  "eventType": "session_failed",
  "callRef": "8411db93-f9fb-4e29-9209-6a2fddf8df95",
  "call_ref": "8411db93-f9fb-4e29-9209-6a2fddf8df95",
  "error": "runtime error message"
}
```

#### Event Handling Rules For Onelink

- Treat events as at-least-once delivery. Deduplicate by
  `X-Idempotency-Key` when present, otherwise by `call_ref`, `eventType`, and
  timestamp/sequence if available.
- Treat `call_ref` / `callRef` as the call-session idempotency key. Onelink
  must create-or-find exactly one call session per `account_id + call_ref` and
  must update the existing session when another event for the same call arrives.
- A new `event_key` for an existing `call_ref` is valid. `event_key` deduplicates
  one delivery attempt; `call_ref` groups all events that belong to the same
  call.
- Create or find the Onelink conversation on `session_started`.
- Append all later events to the same conversation using `call_ref`.
- Duplicate or concurrent events for the same `call_ref` must return 2xx and
  must not fail the call flow because of database uniqueness conflicts.
- Terminal call states (`completed`, `no-answer`, `failed`) must not be
  downgraded by late non-terminal events such as `session_started`,
  `decision_received`, or `answered`. If event timestamp/sequence data is
  available, older events must not overwrite newer call state.
- Do not fail the call flow because CRM side effects are slow. Return 2xx
  quickly and process heavy work asynchronously.
- Store unknown event fields instead of rejecting the event. The runtime may add
  fields later.

## Required Onelink Business Cases

Onelink should implement these cases before the channel is considered ready.

1. Bound inbound number: for `+18623964686`, route lookup must no longer return
   `number_not_bound`.
2. Unknown number: return HTTP `200` with `action=reject` and
   `reason=number_not_bound`.
3. Known caller/contact: create or attach the call to the existing contact and
   conversation.
4. Unknown caller/contact: create a contact or temporary lead and attach the
   call conversation.
5. Business-hours closed: return `action=reject` with a user-friendly message.
6. AI enabled: return `action=ai` with a real non-runtime `app_ref`.
7. AI disabled/operator available: return `action=operator` with a valid
   `agent_aor`.
8. Operator unavailable: return `action=reject`, voicemail action if later
   supported, or AI fallback with a valid AI `app_ref`.
9. Inbound events: store `session_started`, `decision_received`, `answered`,
   `dial_status`, `session_completed`, and `session_failed`.
10. Outbound calls: call `POST /telephony/calls/outbound`, store the returned
   `ref`, and reconcile status with `GET /telephony/calls`.

The route cache in the current bridge may keep a route decision for about 30
seconds per ingress number. During tests, wait for cache expiry or restart the
bridge after changing Onelink routing logic.

## Recommended Onelink Channel Mapping

For the current test channel, store these values in Onelink:

```json
{
  "provider": "fonoster",
  "phone_number": "+18623964686",
  "number_ref": "d451bbe2-53d8-4458-bd0e-d811d85f57e0",
  "app_ref": "96fc259c-6bcd-4cbf-bb7d-d2c51f248934",
  "trunk_ref": "a299c0e0-150b-4fc9-9a58-f44bb3634324",
  "ai_app_ref": null,
  "operator_agent_aor": null,
  "routing_policy": {
    "mode": "app"
  }
}
```

Use `operator_agent_aor` only after Fonoster agents/domains are created.
Use `ai_app_ref` only after a real Fonoster AI or AI-compatible application is
created or intentionally selected.
Use `app_ref` to bind the number to the current Fonoster runtime application.
Do not use that same `app_ref` as the AI target in route decisions for the same
inbound call.

The current demo smoke-test app ref is:

```text
74fec1f6-48e8-436c-8147-9176a5da4fa4
```

Store it only if Onelink needs an explicit non-production demo target. It is not
a replacement for `ai_app_ref`.

## Minimum Acceptance Tests

1. `GET /telephony/resources/summary` returns `counts.numbers >= 1`.
2. Onelink can store `number_ref`, `app_ref`, `trunk_ref`, `ai_app_ref`, `operator_agent_aor`, and routing policy.
3. `POST /telephony/numbers/:numberRef/route` with `mode=app` returns HTTP `200`.
4. `POST /telephony/ai/toggle` with `enabled=true` returns HTTP `200`.
5. `POST /telephony/ai/toggle` with `enabled=false` and `fallback_mode=app` returns HTTP `200`.
6. `GET /telephony/calls` returns a JSON object with `items`.
7. `POST /telephony/calls/outbound` returns HTTP `201` and a `ref`.
8. `POST /internal/voice/inbound/route` on Onelink returns HTTP `200` with a valid executable decision.
9. For `+18623964686`, Onelink route decision does not return `number_not_bound` after the channel is bound.
10. `POST /internal/voice/inbound/event` on Onelink returns HTTP `200` or `202` and stores the event.
11. A real inbound call creates or updates one Onelink conversation linked by `call_ref`.

Outbound acceptance still depends on SIP carrier behavior after the bridge
successfully creates the call.
