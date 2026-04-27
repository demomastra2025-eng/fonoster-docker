# CHANGELOG

## 2026-03-24

### Scope

This entry tracks the final Fonoster-side cleanup after reviewing the current
Onelink rollout documents and the live bridge/runtime behavior.

### Final Cleanup

- Updated [`/root/fonoster/mods/apiserver/src/voice/handlers/dial/createDialHandler.ts`](/root/fonoster/mods/apiserver/src/voice/handlers/dial/createDialHandler.ts)
  - added internal `app:<appRef>` destination support
  - internal handoff now preserves `APP_REF`, `CALL_REF`, `CALL_DIRECTION`, `INGRESS_NUMBER`, and `METADATA`

- Updated [`/root/fonoster-docker/voice-runtime/src/runtime.js`](/root/fonoster-docker/voice-runtime/src/runtime.js)
  - `app` and `ai` decisions now execute through the internal `app:<appRef>` handoff path

- Updated [`/root/fonoster-docker/telephony-bridge/src/routeDecision.js`](/root/fonoster-docker/telephony-bridge/src/routeDecision.js)
  - bare `appRef` is now treated as executable on this deployment
  - corrected fallback reason selection when local default action is `ai`

- Updated [`compose.yaml`](./compose.yaml)
  - `apiserver` now builds locally from [`/root/fonoster`](/root/fonoster) as `fonoster/apiserver-local:0.17.1`

- Updated [`.env`](./.env)
  - current local no-Onelink fallback now routes to `Twilio Test App`
  - test DID is currently prepared for runtime-path validation instead of direct demo-only routing

- Updated [`telephony-bridge/src/server.js`](./telephony-bridge/src/server.js)
  - internal auth now accepts both `x-bridge-secret` and `x-bridge-shared-secret`
  - this reduces false `401 invalid shared secret` failures during cross-service rollout

- Updated [`telephony-bridge/src/config.js`](./telephony-bridge/src/config.js)
  - aligned the code-level fallback reject message with Onelink wording

- Updated documentation to remove stale pre-implementation steps:
  - [`docs/16-onelink-native-telephony-integration-plan.md`](./docs/16-onelink-native-telephony-integration-plan.md)
  - [`docs/17-remaining-work-summary.md`](./docs/17-remaining-work-summary.md)
  - [`telephony-bridge/README.md`](./telephony-bridge/README.md)

### Verification

- verified live bridge health on `127.0.0.1:38081/healthz`
- re-confirmed that core Fonoster services plus local bridge/runtime containers are running
- verified that local fallback route resolution now returns `ai + appRef(Twilio Test App)`
- verified that the test DID route can be switched to `Onelink Voice Runtime`
- re-confirmed the current remaining blocker:
  - live external validation is still needed before the new `appRef` handoff path can be called fully proven

## 2026-03-23

### Scope

This entry tracks the work done after adopting the Onelink-native integration plan from:

- [`docs/16-onelink-native-telephony-integration-plan.md`](./docs/16-onelink-native-telephony-integration-plan.md)

### Bridge Runtime Hardening

- Updated [`telephony-bridge/src/chatwoot.js`](./telephony-bridge/src/chatwoot.js)
  - repurposed it into an `onelink` client while keeping backward-compatible file placement
  - added outbound calls to Onelink internal route/event endpoints
  - added timeout, bounded retries, degraded mode, and circuit-open tracking
  - added short-lived route decision caching

- Added [`telephony-bridge/src/routeCache.js`](./telephony-bridge/src/routeCache.js)
  - in-memory route snapshot cache keyed by ingress number and optional number ref

- Updated [`telephony-bridge/src/routeDecision.js`](./telephony-bridge/src/routeDecision.js)
  - now prefers authoritative decisions from Onelink
  - now uses local defaults only as emergency fallback
  - now clearly downgrades unsupported `app` and `ai` actions to a safe `reject` path unless a dialable target is provided
  - added outbound `appRef` selection helper for future Onelink-driven outbound policy

- Updated [`telephony-bridge/src/server.js`](./telephony-bridge/src/server.js)
  - health now reports Onelink degraded-mode and cache state
  - `/internal/voice/inbound/route` now logs route source, reason, and action
  - `/internal/voice/inbound/event` now forwards business events to Onelink when configured
  - route-changing management endpoints now invalidate cached route snapshots

- Updated [`voice-runtime/src/bridgeClient.js`](./voice-runtime/src/bridgeClient.js)
  - added timeout, retry, backoff, and error classification for bridge calls
  - preserved idempotency-key forwarding

- Updated [`voice-runtime/src/runtime.js`](./voice-runtime/src/runtime.js)
  - added `answered` and richer `session_completed` event emission
  - added safe event emission helper so bridge delivery is not debug-only
  - now supports `app` and `ai` when upstream provides a dialable destination
  - still rejects unsupported bare-`appRef` paths clearly instead of silently pretending success

- Updated configuration and deployment wiring:
  - [`telephony-bridge/src/config.js`](./telephony-bridge/src/config.js)
  - [`voice-runtime/src/config.js`](./voice-runtime/src/config.js)
  - [`compose.yaml`](./compose.yaml)
  - [`.env`](./.env)

### Verification

- local syntax checks passed for:
  - `telephony-bridge/src/server.js`
  - `telephony-bridge/src/chatwoot.js`
  - `telephony-bridge/src/routeDecision.js`
  - `voice-runtime/src/bridgeClient.js`
  - `voice-runtime/src/runtime.js`

- live bridge verification passed with Onelink not configured:
  - `GET /healthz` returns Onelink status, circuit state, and cache state
  - `POST /internal/voice/inbound/route` returns the emergency fallback reject decision
  - `POST /internal/voice/inbound/event` returns `{ accepted: true, forwarded: false, skipped: true }`

- local runtime smoke tests passed for:
  - fallback reject path
  - operator route path
  - `app` route path when a dialable destination is provided

### Documentation

- Updated:
  - [`docs/README.md`](./docs/README.md)
  - [`docs/05-telephony-bridge.md`](./docs/05-telephony-bridge.md)
  - [`docs/15-status-summary.md`](./docs/15-status-summary.md)
  - [`docs/16-onelink-native-telephony-integration-plan.md`](./docs/16-onelink-native-telephony-integration-plan.md)
  - [`telephony-bridge/README.md`](./telephony-bridge/README.md)

## 2026-03-22

### Scope

This file tracks the changes made while bringing the self-hosted Fonoster stack online on this server.

Work was performed primarily in `/root/fonoster-docker`, with additional changes in:

- `/root/fonoster`
- `/root/caddy`
- `/root/fonoster-twilio-test`
- Docker runtime and container data
- Twilio account configuration

### File Changes In `/root/fonoster-docker`

- Updated [`.env`](./.env)
  - Added `SERVER_DASHBOARD_SESSION_SECRET`
  - Switched Dashboard/API URLs to `https://cloud.vconsult.kz`
  - Added `DASHBOARD_SERVER_API_URL=envoy:8449`
  - Set self-hosted network values for Fonoster services
  - Set public host IP `75.119.131.165` where required
  - Set `AUTOPILOT_RECORDING_BASE_URL`
  - Rotated owner/admin credentials
  - Rotated Postgres, InfluxDB, ARI, SIP proxy, and session secrets
  - Added `TELEPHONY_BRIDGE_*` configuration for the local bridge service

- Updated [`compose.yaml`](./compose.yaml)
  - Switched `dashboard` from public image-only usage to a local build from `/root/fonoster/mods/dashboard`
  - Added build args for self-hosted Dashboard URLs
  - Added `test-voiceapp` service for Twilio inbound testing
  - Added `telephony-bridge` service bound locally on `127.0.0.1:38081`
  - Added `host.docker.internal:host-gateway` to `routr`
  - Replaced the original `routr` healthcheck with a process/port-based healthcheck
  - Switched `rtpengine` to `network_mode: host`

- Added test voice application:
  - [`test-voiceapp/Dockerfile`](./test-voiceapp/Dockerfile)
  - [`test-voiceapp/index.js`](./test-voiceapp/index.js)
  - [`test-voiceapp/package.json`](./test-voiceapp/package.json)

- Added bridge service implementation:
  - [`telephony-bridge/Dockerfile`](./telephony-bridge/Dockerfile)
  - [`telephony-bridge/package.json`](./telephony-bridge/package.json)
  - [`telephony-bridge/package-lock.json`](./telephony-bridge/package-lock.json)
  - [`telephony-bridge/scripts/sync-voice-runtime-application.js`](./telephony-bridge/scripts/sync-voice-runtime-application.js)
  - [`telephony-bridge/src/server.js`](./telephony-bridge/src/server.js)
  - [`telephony-bridge/src/fonoster.js`](./telephony-bridge/src/fonoster.js)
  - [`telephony-bridge/src/chatwoot.js`](./telephony-bridge/src/chatwoot.js)
  - [`telephony-bridge/src/routeDecision.js`](./telephony-bridge/src/routeDecision.js)
  - [`telephony-bridge/src/routrDb.js`](./telephony-bridge/src/routrDb.js)
  - [`telephony-bridge/src/config.js`](./telephony-bridge/src/config.js)
  - [`telephony-bridge/src/logger.js`](./telephony-bridge/src/logger.js)

- Added production-style voice runtime:
  - [`voice-runtime/Dockerfile`](./voice-runtime/Dockerfile)
  - [`voice-runtime/README.md`](./voice-runtime/README.md)
  - [`voice-runtime/package.json`](./voice-runtime/package.json)
  - [`voice-runtime/package-lock.json`](./voice-runtime/package-lock.json)
  - [`voice-runtime/src/index.js`](./voice-runtime/src/index.js)
  - [`voice-runtime/src/runtime.js`](./voice-runtime/src/runtime.js)
  - [`voice-runtime/src/bridgeClient.js`](./voice-runtime/src/bridgeClient.js)
  - [`voice-runtime/src/config.js`](./voice-runtime/src/config.js)
  - [`voice-runtime/src/logger.js`](./voice-runtime/src/logger.js)

### File Changes Outside `/root/fonoster-docker`

- Updated [`/root/fonoster/mods/dashboard/Dockerfile`](/root/fonoster/mods/dashboard/Dockerfile)
  - Added support for `DASHBOARD_SERVER_API_URL`

- Updated [`/root/fonoster/mods/dashboard/src/core/sdk/stores/fonoster.config.ts`](/root/fonoster/mods/dashboard/src/core/sdk/stores/fonoster.config.ts)
  - Split browser-facing API URL from the server-side Dashboard SDK endpoint
  - Fixed SSR/login behavior for self-hosted deployment behind a public domain

- Updated [`/root/caddy/Caddyfile`](/root/caddy/Caddyfile)
  - Added reverse proxy for `cloud.vconsult.kz` to the Fonoster Envoy entrypoint
  - Kept `minio.cloud.vconsult.kz` pointing to Firecrawl

- Updated [`/root/caddy/docker-compose.yaml`](/root/caddy/docker-compose.yaml)
  - Fixed Caddy network attachment so it can reach the remaining Firecrawl stack

- Added temporary Twilio/Fonoster integration workspace in `/root/fonoster-twilio-test`
  - [`package.json`](/root/fonoster-twilio-test/package.json)
  - [`package-lock.json`](/root/fonoster-twilio-test/package-lock.json)
  - [`configure_fonoster_twilio_number.js`](/root/fonoster-twilio-test/configure_fonoster_twilio_number.js)
  - [`fonoster_api_smoke.js`](/root/fonoster-twilio-test/fonoster_api_smoke.js)

- Added API capability notes in:
  - [`API_TESTS.md`](./API_TESTS.md)
  - [`CRM_INTEGRATION_PLAN.md`](./CRM_INTEGRATION_PLAN.md)
  - [`docs/README.md`](./docs/README.md)
  - [`docs/11-native-api-reference.md`](./docs/11-native-api-reference.md)
  - [`docs/12-bridge-vs-native-matrix.md`](./docs/12-bridge-vs-native-matrix.md)
  - [`docs/13-chatwoot-developer-guide.md`](./docs/13-chatwoot-developer-guide.md)
  - [`docs/14-chatwoot-server-checklist.md`](./docs/14-chatwoot-server-checklist.md)
  - [`docs/15-status-summary.md`](./docs/15-status-summary.md)

### Runtime And Data Changes

- Removed the older Crafty-related Docker stack and left only:
  - Fonoster
  - Firecrawl
  - Caddy

- Restarted and rebuilt Fonoster services from `/root/fonoster-docker`
- Added and started a new internal service:
  - `fonoster-docker-voice-runtime-1`

- Verified working HTTPS entrypoint:
  - `https://cloud.vconsult.kz`

- Changed Fonoster owner/admin login from the default credentials to:
  - Email: `admin@vconsult.kz`
  - Password: rotated from the default `changeme`

- Updated live service secrets and backing services:
  - Postgres password changed and applied to the running DB
  - InfluxDB token/password rotated
  - ARI secret rotated
  - SIP proxy secret rotated
  - Dashboard session secret rotated

- Verified:
  - Dashboard login on the public domain
  - `apiserver`, `routr`, `asterisk`, `dashboard`, `postgres`, `influxdb`, `nats`, `envoy` are running
  - `routr` and `asterisk` healthchecks pass
  - SDK login and read-only smoke checks succeed against `cloud.vconsult.kz:443`
  - `listApplications`, `listNumbers`, `listTrunks`, `listCalls`, and `createTestToken` succeed from the Node SDK
  - `telephony-bridge` starts successfully and its local HTTP endpoints return valid data
  - expanded bridge endpoints `capabilities`, `resources/summary`, `applications`, `numbers`, `trunks`, and `agents` return valid data
  - bridge endpoints `POST /telephony/numbers/:numberRef/route` and `POST /telephony/ai/toggle` now work through a Routr DB fallback
  - the new `voice-runtime` starts successfully and passes local smoke tests for `reject` and `operator` decisions

### Additional Platform Gap Observed

- `Numbers/UpdateNumber` currently fails on this instance when used through the public API/SDK for route switching
- Bridge routing is now insulated from this bug by writing the route state directly to `routr.numbers`

### Twilio Work

- Twilio test number used:
  - `+18623964686`

- Confirmed via Twilio API:
  - Number is attached to trunk `craftyvoice`
  - Trunk SID: `TKc3a7bdc6dfd49a7ab0c2114c1b266f28`
  - Origination URI points to:
    - `sip:wo00000000000000000000000000000000.75.119.131.165.sslip.io:5060`

- Added a test Fonoster external application for inbound call testing:
  - Name: `Twilio Test App`
  - Ref: `74fec1f6-48e8-436c-8147-9176a5da4fa4`
  - Initial endpoint: `test-voiceapp:3000`

- Added Fonoster SIP resources for the test DID:
  - Trunk: `Twilio Trunk`
  - Trunk ref: `a299c0e0-150b-4fc9-9a58-f44bb3634324`
  - Inbound URI: `wo00000000000000000000000000000000.75.119.131.165.sslip.io`
  - Number: `tel:+18623964686`
  - Number ref: `d451bbe2-53d8-4458-bd0e-d811d85f57e0`
  - Linked app ref: `74fec1f6-48e8-436c-8147-9176a5da4fa4`

- Confirmed from logs:
  - Before the Fonoster SIP number existed, Twilio INVITEs reached `routr`
  - Calls did not reach `test-voiceapp` at that time because inbound mapping inside Fonoster was incomplete
- Updated the Twilio test application to include valid STT/TTS configuration
- Updated the Twilio test application endpoint to the built-in welcome demo endpoint:
  - `welcome.demo.fonoster.local`
- Left [`test-voiceapp`](./test-voiceapp) in place only as an experimental external-app sandbox
- Added a dedicated production-style runtime application:
  - Name: `Onelink Voice Runtime`
  - Ref: `96fc259c-6bcd-4cbf-bb7d-d2c51f248934`
  - Endpoint: `voice-runtime:50062`

### Current Known Gap

Twilio inbound connectivity to Fonoster edge is working, and the missing Fonoster SIP resources have now been created. The new runtime layer also exists now.

Remaining item:

- Switch the public DID from the built-in demo app to `Onelink Voice Runtime` only when the final Chatwoot-driven inbound policy is ready for live validation

Known platform limitation observed during setup:

- Fonoster trunk creation through the public API/SDK failed for inbound-only trunk setup with:
  - `Required at "sendRegister"`
- Because of that, the working trunk was inserted directly into the Routr/Postgres database and then linked to the created number

### Notes

- This changelog intentionally records the existence of rotated secrets and credential changes, but does not copy the secret values here.
- Some state lives outside the filesystem and cannot be restored from files alone:
  - Docker volumes and live containers
  - Postgres and InfluxDB data
  - Twilio console/API configuration

### 2026-03-24 Native Audio Path Hardening

- Narrowed the remaining inbound test issue from SIP routing to native playback/media behavior on the answered PSTN leg.
- Confirmed the previous `Local/voice@...` handoff had already been removed and the call now stays on the native `PJSIP/routr` channel via `continueInDialplan`.
- Added a short playback timeout in the apiserver play handler so a missing `PlaybackFinished` event no longer leaves the demo flow hanging indefinitely:
  - `/root/fonoster/mods/apiserver/src/voice/handlers/utils/awaitForPlaybackFinished.ts`
  - `/root/fonoster/mods/apiserver/src/voice/handlers/createPlayHandler.ts`
- Switched the built-in welcome demo from the bundled `unavailable` prompt to a dedicated local test sound:
  - `/root/fonoster/mods/apiserver/src/core/buildWelcomeDemoService.ts`
- Added a mounted custom Asterisk sound path:
  - `/root/fonoster-docker/compose.yaml`
  - `/root/fonoster-docker/asterisk-sounds/en/custom/fonoster-test.wav`
- Rebuilt the local `fonoster/apiserver-local:0.17.1` image and force-recreated `fonoster-docker-apiserver-1`.
- Recreated `fonoster-docker-asterisk-1` so the container sees `/var/lib/asterisk/sounds/en/custom/fonoster-test.wav`.
- Fixed a race in the local apiserver voice dispatcher so voice verb handlers are registered before `vc.connect()`:
  - `/root/fonoster/mods/apiserver/src/voice/VoiceDispatcher.ts`
- Verified after restart:
  - the running apiserver container uses image `sha256:4e721768db9bb6c3a673546fdf312db048fa417fe3d69bf4848501a65bdf0e10`
  - deployed code contains `custom/fonoster-test`
  - deployed code contains the playback timeout warning path
  - Asterisk sees the mounted sound file
  - no stale active channels or lingering bridges remained after restart
- Verified with a real PSTN call after the dispatcher fix:
  - inbound call is answered
  - audible fallback media is heard on the PSTN leg
  - the demo session reaches hangup normally
  - call ends with `NORMAL_CLEARING`
