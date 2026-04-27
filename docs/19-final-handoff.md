# Final Handoff

## Purpose

This is the final short handoff document for the current Fonoster-side work.

Use it as the primary answer to:

- what is already done
- what is still missing
- what Onelink must do next
- how the system behaves with Twilio or another SIP/PSTN operator

## Final Status On The Fonoster Side

The Fonoster-side execution layer is ready.

What is already confirmed live:

- the public stack is up
- the runtime path is active
- the current DID is routed to `Onelink Voice Runtime`
- inbound PSTN reaches Fonoster
- the runtime answers the call
- fallback media is audible on the PSTN leg
- the call ends with `NORMAL_CLEARING`

Current live building blocks:

- `Fonoster`
- `telephony-bridge`
- `voice-runtime`
- `Twilio test DID`
- `Onelink Voice Runtime`

Current public entrypoint:

- `https://cloud.vconsult.kz`

Current test number:

- `+18623964686`

Current runtime application:

- `Onelink Voice Runtime`
- `96fc259c-6bcd-4cbf-bb7d-d2c51f248934`

## What Is Not Needed Right Now On The Fonoster Side

No more mandatory platform fixes are blocking the integration at this moment.

That means:

- no more required Fonoster-side SIP routing changes
- no more required native runtime/audio fixes for the base inbound path
- no more required demo-path debugging

Possible later Fonoster-side work still exists, but it is not the current blocker:

- production browser-phone strategy
- hardened `wss` signaling path
- late recording/transcript/summary reconciliation
- cleanup of older temporary test assets

## What Must Happen Next On The Onelink Side

The next mandatory tasks are now on the Onelink side.

### 1. Connect Onelink To The Bridge

Onelink must be able to call:

- `POST /internal/voice/inbound/route`
- `POST /internal/voice/inbound/event`
- `POST /telephony/calls/outbound`
- `POST /telephony/numbers/:numberRef/route`
- `POST /telephony/ai/toggle`
- `POST /telephony/agents/:agentRef/enabled`
- `GET /telephony/calls`

### 2. Replace The Current Fallback Decision

Right now, if Onelink is not configured, the bridge uses a local emergency fallback.

That fallback is only temporary.

Onelink must become the real decision source for:

- `reject`
- `operator`
- `app`
- `ai`
- off-hours routing
- operator unavailable fallback

### 3. Run Real Product Validation

The next real milestone is not “Fonoster answers a test call”.

The next milestone is:

- Onelink returns a real decision
- bridge executes it
- runtime handles it
- call state and events are persisted correctly in Onelink

Minimum live validation after wiring Onelink:

- inbound reject flow
- inbound operator flow
- inbound app flow
- inbound AI flow
- operator disabled fallback
- out-of-office fallback
- outbound call from Onelink
- event replay/idempotency validation

## How The Provider Layer Works

## Current Reality

Right now the live test provider is `Twilio`.

That does **not** mean the architecture is Twilio-only.

Twilio is only the current PSTN/SIP edge provider used for the live test number.

## Generic Model

The real architecture is:

- provider delivers the call to Fonoster
- Fonoster normalizes the call into its own telephony/runtime layer
- bridge and runtime execute product logic
- Onelink decides business behavior

So the control flow is provider-agnostic after the call reaches Fonoster.

## If Another SIP Operator Is Used

If you replace Twilio with another SIP operator, the high-level behavior stays the same.

What changes:

- provider-specific trunk provisioning
- provider-specific auth model
- provider-specific origination/termination configuration
- possibly caller ID, codec, DTMF, or registration behavior

What does not change:

- Fonoster remains the execution layer
- `telephony-bridge` remains the Onelink-facing API/orchestration layer
- `voice-runtime` remains the live-call executor
- Onelink remains the routing authority

In practice, a different operator means:

1. create or adjust the SIP trunk in Fonoster/Routr
2. point the provider to the Fonoster SIP ingress
3. bind the number to the correct Fonoster number/application route
4. re-run live inbound and outbound validation

## Provider-Specific Notes

Twilio-specific work that was done here:

- number association to the Twilio SIP trunk
- Twilio origination URI
- current DID testing

If a different SIP operator is used later, that Twilio-specific setup is simply replaced by the other operator’s equivalent SIP trunk settings.

The rest of the Onelink/Fonoster integration does not need to be redesigned.

## Final Answer To “What Do We Do Next?”

### On This Server

Nothing else is strictly required before Onelink integration.

This server is now in a handoff-ready state.

### On The Onelink Server

Do this next:

1. wire Onelink to the bridge
2. implement real inbound route decisions
3. implement outbound call commands
4. validate `operator` and `ai` actions from real Onelink decisions
5. run full live end-to-end tests

## Definition Of Ready For Onelink Team

The Fonoster side should now be considered ready for the Onelink team when all of the following are true:

- bridge is available
- runtime is available
- DID is already routed to `Onelink Voice Runtime`
- inbound fallback path is proven
- audible media is proven
- call cleanup is proven

Those conditions are now satisfied.

## Read Next

- [`15-status-summary.md`](./15-status-summary.md)
- [`17-remaining-work-summary.md`](./17-remaining-work-summary.md)
- [`18-onelink-server-checklist.md`](./18-onelink-server-checklist.md)
