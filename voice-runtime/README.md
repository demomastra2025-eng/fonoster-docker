# Voice Runtime

Thin Fonoster external voice runtime for inbound call execution.

## Responsibility

This service does not own business logic.

It only:

- receives the live voice session from Fonoster
- asks the local `telephony-bridge` for the inbound decision
- executes the returned call action
- emits runtime events back to the bridge

## Current Actions

- `reject`
- `operator`
- `app`
- `ai`

The runtime supports `app` and `ai` actions through local application handoff
when a concrete `appRef` is available.

## Current Wiring

- service name: `voice-runtime`
- default port: `50062`
- bridge base URL: `http://telephony-bridge:3100`

## Notes

- This runtime is intended to become the production inbound path later.
- The current public test DID is intentionally left on the built-in demo app
  until the final end-to-end cutover is explicitly performed.
