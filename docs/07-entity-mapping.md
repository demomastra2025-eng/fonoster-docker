# Entity Mapping

## Purpose

This file describes how Chatwoot concepts should map to Fonoster concepts.

## Core Mapping

### Chatwoot Inbox -> Fonoster Number

A Chatwoot inbox that represents a phone entry point should map to:

- one Fonoster `Number`
- possibly one primary routing policy

Useful Fonoster fields:

- `telUrl`
- `appRef`
- `agentAor`
- `trunkRef`

Source:

- [`/root/fonoster/mods/types/src/numbers.types.ts`](/root/fonoster/mods/types/src/numbers.types.ts)

### Chatwoot User -> Fonoster Agent

An agent user in Chatwoot should map to:

- one Fonoster `Agent`
- one optional SIP/webphone identity

Useful Fonoster fields:

- `enabled`
- `domainRef`
- `credentialsRef`
- `maxContacts`

Source:

- [`/root/fonoster/mods/types/src/agents.types.ts`](/root/fonoster/mods/types/src/agents.types.ts)

### Chatwoot Conversation -> Fonoster Call

A phone conversation should reference:

- Fonoster `Call.ref`
- provider call SID if available
- recording ref if available
- transcript/summary references

### Chatwoot AI Policy -> Fonoster Application Routing

AI mode should generally map to routing:

- AI on: `Number.appRef = AI Agent App`
- AI off: `Number.appRef = CRM Router App` or `Number.agentAor = live agent`

## Recommended Mapping Tables

- `chatwoot_inbox_fonoster_numbers`
- `chatwoot_user_fonoster_agents`
- `chatwoot_conversation_fonoster_calls`
- `number_routing_policies`
- `ai_mode_policies`

## Why Routing Is Better Than A Magic AI Flag

Fonoster's model is centered on resources and applications, not on a universal AI toggle.

Routing through:

- `appRef`
- `agentAor`

is a more stable model than inventing hidden state inside the platform.
