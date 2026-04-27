# Native API Reference

## Purpose

This document is the practical native Fonoster API and SDK reference for the integration team.

It is intentionally written from the point of view of the Chatwoot integration, not as a full upstream SDK manual.

## Connection Facts

Current live connection values:

- public domain: `https://cloud.vconsult.kz`
- Node SDK endpoint: `cloud.vconsult.kz:443`
- current access key id used in this environment: `WO00000000000000000000000000000000`

Do not hardcode credentials in application code. Use environment variables and dedicated API keys in production.

## Main Native SDK Classes

### Applications

Use for:

- creating external apps
- creating Autopilot apps
- reading application config
- issuing test/webphone tokens

Primary methods:

- `createApplication`
- `getApplication`
- `updateApplication`
- `listApplications`
- `deleteApplication`
- `createTestToken`

Source:

- [`/root/fonoster/mods/sdk/src/Applications.ts`](/root/fonoster/mods/sdk/src/Applications.ts)

### Calls

Use for:

- creating outbound calls
- reading call history
- getting one call detail

Primary methods:

- `createCall`
- `listCalls`
- `getCall`

Source:

- [`/root/fonoster/mods/sdk/src/Calls.ts`](/root/fonoster/mods/sdk/src/Calls.ts)

### Numbers

Use for:

- listing DIDs
- reading DID configuration
- creating numbers
- updating numbers

Primary methods:

- `createNumber`
- `getNumber`
- `updateNumber`
- `listNumbers`
- `deleteNumber`

Source:

- [`/root/fonoster/mods/sdk/src/Numbers.ts`](/root/fonoster/mods/sdk/src/Numbers.ts)

Important note for this instance:

- `updateNumber` is currently unreliable for route switching on this server
- the bridge already works around this with a direct `routr.numbers` fallback

### Agents

Use for:

- live operator telephony identities
- enabling and disabling operator reachability

Primary methods:

- `createAgent`
- `getAgent`
- `updateAgent`
- `listAgents`
- `deleteAgent`

Source:

- [`/root/fonoster/mods/sdk/src/Agents.ts`](/root/fonoster/mods/sdk/src/Agents.ts)

### Trunks

Use for:

- PSTN ingress and egress
- SIP carrier configuration

Primary methods:

- `createTrunk`
- `getTrunk`
- `updateTrunk`
- `listTrunks`
- `deleteTrunk`

Source:

- [`/root/fonoster/mods/sdk/src/Trunks.ts`](/root/fonoster/mods/sdk/src/Trunks.ts)

### Domains

Use for:

- SIP/webphone domains
- egress policy association

Primary methods:

- `createDomain`
- `getDomain`
- `updateDomain`
- `listDomains`
- `deleteDomain`

Source:

- [`/root/fonoster/mods/sdk/src/Domains.ts`](/root/fonoster/mods/sdk/src/Domains.ts)

### Credentials

Use for:

- SIP username/password resources
- mapping agents to auth credentials

Primary methods:

- `createCredentials`
- `getCredentials`
- `updateCredentials`
- `listCredentials`
- `deleteCredentials`

Source:

- [`/root/fonoster/mods/sdk/src/Credentials.ts`](/root/fonoster/mods/sdk/src/Credentials.ts)

### Secrets

Use for:

- storing integration secrets inside Fonoster-managed resources

Primary methods:

- `createSecret`
- `getSecret`
- `updateSecret`
- `listSecrets`
- `deleteSecret`

Source:

- [`/root/fonoster/mods/sdk/src/Secrets.ts`](/root/fonoster/mods/sdk/src/Secrets.ts)

## Native Runtime Boundary

For inbound live PSTN calls, native administrative CRUD is not enough.

There is no general method like:

- `acceptIncomingCall(callRef)`
- `rejectIncomingCall(callRef)`
- `transferIncomingCall(callRef)`

That logic lives inside the voice application session:

- `answer()`
- `hangup()`
- `dial()`
- `say()`
- `gather()`

Source:

- [`/root/fonoster/mods/voice/src/VoiceResponse.ts`](/root/fonoster/mods/voice/src/VoiceResponse.ts)

## Native Data Model Notes

### Number Routing

For practical routing, the important fields are:

- `Number.appRef`
- `Number.agentAor`
- `Number.trunkRef`

Source:

- [`/root/fonoster/mods/types/src/numbers.types.ts`](/root/fonoster/mods/types/src/numbers.types.ts)

### Applications

Application types:

- `EXTERNAL`
- `AUTOPILOT`

Source:

- [`/root/fonoster/mods/types/src/applications.types.ts`](/root/fonoster/mods/types/src/applications.types.ts)

### Calls

Important fields for Chatwoot mapping:

- `ref`
- `from`
- `to`
- `status`
- `direction`
- `startedAt`
- `endedAt`
- `duration`

Source:

- [`/root/fonoster/mods/types/src/calls.types.ts`](/root/fonoster/mods/types/src/calls.types.ts)

## Recommended Native Usage For Chatwoot

Use native Fonoster SDK/API directly for:

- full admin screens
- operational debugging
- low-level resource CRUD
- ad hoc scripts and maintenance
- reading applications, numbers, trunks, calls, domains, agents

Use the bridge instead for:

- Chatwoot-facing telephony actions
- AI on/off
- product routing decisions
- inbound business logic

See:

- [`12-bridge-vs-native-matrix.md`](./12-bridge-vs-native-matrix.md)
