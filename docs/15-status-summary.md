# Status Summary

## Ready

- Fonoster platform is running on this server
- public domain is working:
  - `https://cloud.vconsult.kz`
- core services are up:
  - `apiserver`
  - `routr`
  - `asterisk`
  - `rtpengine`
  - `dashboard`
  - `autopilot`
  - `envoy`
  - `postgres`
  - `influxdb`
  - `nats`
  - `telephony-bridge`
  - `voice-runtime`
- bridge is running locally on:
  - `127.0.0.1:38081`
- production-style Node voice runtime is running internally on:
  - `voice-runtime:50062`
- a dedicated Fonoster EXTERNAL app already exists for that runtime:
  - `Onelink Voice Runtime`
  - `96fc259c-6bcd-4cbf-bb7d-d2c51f248934`
- native Fonoster SDK/API access has been tested
- bridge endpoints for Onelink-facing telephony actions have been implemented
- route switching and AI toggle now work through the bridge
- developer documentation for the integration side is in place
- native inbound test flow is now validated end-to-end on the Fonoster side:
  - PSTN/Twilio inbound reaches Fonoster
  - the runtime answers the call
  - the demo fallback audio is heard on the PSTN leg
  - the call ends with `NORMAL_CLEARING`

## Not Ready Yet

- Onelink server is not connected to the bridge yet
- browser calling is not production-ready yet because signaling is still returned as `ws://...`, not hardened `wss://`
- the public Fonoster `UpdateNumber` path is still buggy on this instance
- full end-to-end production validation with Onelink has not happened yet

## Current Technical Truth

- Fonoster-side infrastructure is ready
- bridge-side integration layer is ready for Onelink to consume
- the Fonoster-side voice runtime layer now also exists
- the bare-`appRef` execution path is now implemented on the local Fonoster side
- the test DID is already routed to `Onelink Voice Runtime`
- the remaining work is now mostly on Onelink integration, secure cross-server access, and live business-flow validation

## Next Step

1. Connect the Onelink server to the bridge
2. Implement Onelink backend calls to the bridge
3. Replace the current demo fallback with real inbound decision logic from Onelink
4. Test outbound calling from Onelink
5. Test AI toggle and operator enable/disable from Onelink
6. Run full real-call end-to-end validation against Onelink business flows

## Read This Next

- [`17-remaining-work-summary.md`](./17-remaining-work-summary.md)
- [`18-onelink-server-checklist.md`](./18-onelink-server-checklist.md)
- [`16-onelink-native-telephony-integration-plan.md`](./16-onelink-native-telephony-integration-plan.md)
- [`05-telephony-bridge.md`](./05-telephony-bridge.md)
- [`10-open-items.md`](./10-open-items.md)
