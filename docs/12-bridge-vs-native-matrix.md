# Bridge vs Native Matrix

## Purpose

This file answers one question for developers:

"Should this feature go through the bridge, directly through the native Fonoster SDK/API, or inside the live voice runtime?"

## Decision Matrix

### Outbound click-to-call from Chatwoot

- best location: `bridge`
- native implementation behind bridge: `Calls.createCall`
- reason: Chatwoot should call one stable product endpoint

### List recent calls in Chatwoot

- best location: `bridge`
- native implementation behind bridge: `Calls.listCalls`
- reason: bridge can normalize results and later enrich with Chatwoot mappings

### Get one call detail in Chatwoot

- best location: `bridge`
- native implementation behind bridge: `Calls.getCall`
- reason: same as above

### Switch number between AI and live operator flow

- best location: `bridge`
- native implementation behind bridge: number route update
- reason: this is product behavior, not low-level administration

### Enable or disable an operator

- best location: `bridge`
- native implementation behind bridge: `Agents.updateAgent({ enabled })`
- reason: Chatwoot should not care about raw Fonoster payloads

### Create or edit trunks, domains, credentials, secrets

- best location: `native Fonoster SDK/API`
- reason: these are low-level telephony admin tasks

### Create or edit AI application definitions

- best location: mixed
- bridge if tied to product workflows
- native if done by platform admins
- reason: depends on who owns AI configuration operationally

### Accept, reject, say, gather, transfer during a live inbound call

- best location: `voice runtime`
- reason: these are call-session verbs, not admin CRUD

### Decide whether an inbound caller goes to AI or a human

- best location: `bridge`
- executed by: `voice runtime`
- reason: decision belongs to business logic, execution belongs to call runtime

### Full telephony admin console

- best location: `native Fonoster dashboard/API`
- reason: do not recreate a second admin console inside Chatwoot unless there is real product value

## Simple Rule

Use the bridge when the caller is Chatwoot or product logic.

Use native Fonoster when the caller is an operator/admin managing telephony infrastructure.

Use the voice runtime when the action must happen inside the live call.
