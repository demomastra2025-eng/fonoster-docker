# Chatwoot Target Architecture

## Context

The main CRM is `Chatwoot`, running on another server.

That means:

- Chatwoot remains the system of record for customer-facing workflows
- Fonoster remains the telephony engine
- the integration should be explicit and service-based

## Recommended Service Layout

### 1. Chatwoot

Chatwoot should own:

- contacts
- conversations
- inboxes
- assignments
- UI for agents and supervisors
- business workflows

### 2. Telephony Bridge

A separate service should own:

- Chatwoot <-> Fonoster integration
- routing decisions
- resource synchronization
- AI mode switching
- operator availability logic
- event normalization

### 3. Node Voice Runtime

A thin Node service should own:

- receiving Fonoster external app sessions
- asking the bridge what to do
- executing `answer`, `dial`, `say`, `hangup`, `gather`

### 4. Fonoster

Fonoster should own:

- SIP
- RTP
- call setup
- application execution
- telephony resources

## End-To-End Inbound Flow

1. PSTN provider delivers the call to Fonoster
2. Fonoster maps the DID to an application
3. the application session lands in the Node voice runtime
4. Node calls the bridge for a decision
5. bridge looks up Chatwoot context
6. bridge returns an action
7. Node executes the action in the live call
8. bridge writes outcomes back into Chatwoot

## End-To-End Outbound Flow

1. user clicks call in Chatwoot
2. Chatwoot calls the bridge
3. bridge calls Fonoster `Calls.createCall`
4. Fonoster places the call
5. bridge tracks outcome and writes back to Chatwoot

## Why Not Talk From Chatwoot Directly To Fonoster For Everything

Direct integration is possible for some actions, but it becomes fragile because:

- inbound call handling still needs a voice runtime
- Chatwoot should not absorb low-level telephony concerns
- call-time routing logic becomes hard to evolve if spread across systems
- future AI tools and event hooks need a central integration point

## Architecture Principle

The bridge is the product API for telephony.

Chatwoot should call the bridge, not Fonoster directly, for most business-level telephony actions.
