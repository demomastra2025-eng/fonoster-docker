# Current State

## Deployment Roots

- platform source: [`/root/fonoster`](/root/fonoster)
- deployment bundle: [`/root/fonoster-docker`](/root/fonoster-docker)
- reverse proxy: [`/root/caddy`](/root/caddy)
- temporary SDK/Twilio workspace: [`/root/fonoster-twilio-test`](/root/fonoster-twilio-test)

## Live Entry Points

- dashboard and API public domain: `https://cloud.vconsult.kz`
- current Node SDK endpoint: `cloud.vconsult.kz:443`

## Running Stack

Main running services at the time of documentation:

- `fonoster-docker-apiserver-1`
- `fonoster-docker-routr-1`
- `fonoster-docker-asterisk-1`
- `fonoster-docker-rtpengine-1`
- `fonoster-docker-dashboard-1`
- `fonoster-docker-autopilot-1`
- `fonoster-docker-telephony-bridge-1`
- `fonoster-docker-voice-runtime-1`
- `fonoster-docker-envoy-1`
- `fonoster-docker-postgres-1`
- `fonoster-docker-influxdb-1`
- `fonoster-docker-nats-1`
- `caddy`

## Current Test PSTN Wiring

- Twilio test number: `+18623964686`
- Twilio trunk name: `craftyvoice`
- Fonoster AI application:
  - name: `OneLink AI Voice`
  - ref: `f2498e07-2bb5-45a1-8c8c-6fecdb4c791a`
  - current endpoint: `app.one-link.kz:50061`
- Fonoster runtime application:
  - name: `Onelink Voice Runtime`
  - ref: `96fc259c-6bcd-4cbf-bb7d-d2c51f248934`
  - current endpoint: `voice-runtime:50062`
- Fonoster test number:
  - ref: `d451bbe2-53d8-4458-bd0e-d811d85f57e0`
  - telUrl: `tel:+18623964686`
- Fonoster test trunk:
  - ref: `a299c0e0-150b-4fc9-9a58-f44bb3634324`
  - name: `Twilio Trunk`

## Confirmed Working Today

- Fonoster stack is running
- Dashboard is reachable on the public domain
- SDK login works against the live instance
- Telephony bridge is running on `127.0.0.1:38081`
- Voice runtime is running on internal service `voice-runtime:50062`
- Twilio inbound calls reach Fonoster ingress
- the test DID is currently routed to `Onelink Voice Runtime`
- bridge fallback currently returns `ai -> appRef(OneLink AI Voice)` when fallback routing is needed
- the local Fonoster-side runtime path now supports bare `appRef` execution through the patched local `apiserver`
- read-only SDK smoke tests pass
- telephony-bridge endpoints `healthz`, `telephony/calls`, `telephony/webphone/token`, and `internal/voice/inbound/route` pass locally

## Confirmed By Live SDK Smoke Test

Current instance state returned by the smoke test:

- applications: `2`
- numbers: `1`
- trunks: `1`
- agents: `0`
- domains: `0`
- calls in recent history: `10`

Related files:

- [`/root/fonoster-docker/API_TESTS.md`](/root/fonoster-docker/API_TESTS.md)
- [`/root/fonoster-twilio-test/fonoster_api_smoke.js`](/root/fonoster-twilio-test/fonoster_api_smoke.js)

## Important Notes

- The public test DID is now routed to the runtime app `96fc259c-6bcd-4cbf-bb7d-d2c51f248934`.
- Bridge fallback is configured to use `ai` with `appRef=f2498e07-2bb5-45a1-8c8c-6fecdb4c791a`, which points to the Onelink-hosted AI voice app.
- A dedicated runtime app already exists and points to `voice-runtime:50062`.
- `apiserver` is now built locally from [`/root/fonoster`](/root/fonoster), not only pulled from the public registry, because the local deployment now includes the `app:<appRef>` internal handoff patch.
- The local Gemini test app is not part of the production compose path.
- Secrets are intentionally not copied into this document.
