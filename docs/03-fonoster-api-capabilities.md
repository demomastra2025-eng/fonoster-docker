# Fonoster API Capabilities

## Meaning Of API vs SDK

- `API` means the server-side interface exposed by Fonoster
- `SDK` means the client library used to call that API conveniently

For this project the important SDK is:

- `@fonoster/sdk`

## Native Capabilities Already Available

The current public SDK/API already supports:

- `Applications`
- `Numbers`
- `Trunks`
- `Domains`
- `Agents`
- `Credentials`
- `Secrets`
- `Calls.createCall`
- `Calls.listCalls`
- `Calls.getCall`
- `Applications.createTestToken`

Useful local sources:

- [`/root/fonoster/mods/sdk/src/Calls.ts`](/root/fonoster/mods/sdk/src/Calls.ts)
- [`/root/fonoster/mods/sdk/src/Applications.ts`](/root/fonoster/mods/sdk/src/Applications.ts)
- [`/root/fonoster/mods/sdk/src/Numbers.ts`](/root/fonoster/mods/sdk/src/Numbers.ts)
- [`/root/fonoster/mods/sdk/src/Trunks.ts`](/root/fonoster/mods/sdk/src/Trunks.ts)
- [`/root/fonoster/mods/sdk/src/Agents.ts`](/root/fonoster/mods/sdk/src/Agents.ts)

## What Is Not Exposed As A Generic Admin API

Fonoster does not provide a generic administrative endpoint for:

- accepting an arbitrary inbound PSTN call by call reference
- rejecting an arbitrary inbound PSTN call by call reference
- runtime call-center queue control
- ACD/campaign/disposition management
- a first-class universal AI on/off toggle

## Important Runtime Boundary

Inbound call handling happens inside a voice session handled by an application.

That means the actual actions are:

- `answer()`
- `hangup()`
- `dial()`
- `say()`
- `gather()`

Relevant source:

- [`/root/fonoster/mods/voice/src/VoiceResponse.ts`](/root/fonoster/mods/voice/src/VoiceResponse.ts)

## Practical Consequence

Your product should use:

- native Fonoster API for resource management and outbound actions
- your own bridge and voice runtime for inbound business decisions

## Verified On The Live Instance

Read-only API smoke tests already succeed against the running instance.

Related files:

- [`/root/fonoster-docker/API_TESTS.md`](/root/fonoster-docker/API_TESTS.md)
- [`/root/fonoster-twilio-test/fonoster_api_smoke.js`](/root/fonoster-twilio-test/fonoster_api_smoke.js)
