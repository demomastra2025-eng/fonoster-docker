# PROJECT LAYOUT

## Goal

Keep Fonoster platform code, deployment code, and business integration code separated.

## Recommended Directories

- [`/root/fonoster`](/root/fonoster)
  - Upstream/Fork of Fonoster source code
  - Use for platform patches only
  - Examples:
    - Dashboard fixes
    - API/voice subsystem fixes
    - SIP/telephony platform changes

- [`/root/fonoster-docker`](/root/fonoster-docker)
  - Deployment bundle for this server
  - Use for:
    - `compose.yaml`
    - `.env`
    - mounted configs
    - Caddy/Envoy integration references
    - operational notes and changelog

- `CRM backend` or a separate `crm-telephony-bridge` service
  - Place your business logic here
  - This is where the real external app should live
  - Recommended responsibilities:
    - CRM lookup on incoming calls
    - switch AI on/off
    - switch telephony on/off
    - route to operator / group / AI flow
    - receive Fonoster events
    - synchronize agents, numbers, trunks, application refs

## What Should Not Live Inside `/root/fonoster`

Do not place your CRM-specific routing logic or product logic inside the Fonoster source tree unless you are intentionally forking platform behavior.

Avoid putting these into [`/root/fonoster`](/root/fonoster):

- customer-specific call flows
- CRM API adapters
- operator business rules
- tenant-specific feature flags
- AI prompt orchestration for your product

Those belong in your own application layer.

## External App Placement

Preferred order:

1. Inside your CRM backend as a dedicated telephony module, if the logic is tightly coupled to CRM entities
2. As a separate `crm-telephony-bridge` service next to the CRM, if you want a cleaner boundary
3. Not inside [`/root/fonoster`](/root/fonoster), unless you are deliberately changing the Fonoster platform itself

## Current Practical Setup On This Server

- Platform source:
  - [`/root/fonoster`](/root/fonoster)

- Runtime / deployment:
  - [`/root/fonoster-docker`](/root/fonoster-docker)

- Temporary Twilio/Fonoster integration workspace:
  - [`/root/fonoster-twilio-test`](/root/fonoster-twilio-test)

- Temporary experimental external app:
  - [`/root/fonoster-docker/test-voiceapp`](/root/fonoster-docker/test-voiceapp)

## Recommended Next Step

Use the current Twilio number only to validate ingress and platform wiring.

Then build the real application layer separately from Fonoster, with:

- one external app for deterministic CRM-driven call flow
- one autopilot app for AI flows
- one bridge service for SDK/API operations and event handling
