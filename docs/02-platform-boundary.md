# Platform Boundary

## Core Rule

Keep platform code, deployment code, and business logic separate.

## What Belongs In Fonoster

`Fonoster` should own:

- SIP ingress and egress
- RTP/media handling
- voice session lifecycle
- trunks, numbers, domains, credentials, agents
- built-in dashboard and platform APIs
- AI application execution

Use [`/root/fonoster`](/root/fonoster) only for:

- platform patches
- dashboard fixes
- API or telephony fixes
- intentional upstream fork changes

## What Does Not Belong In Fonoster

Do not put these under [`/root/fonoster`](/root/fonoster):

- Chatwoot-specific routing rules
- CRM contact lookup logic
- operator assignment logic
- tenant-specific feature flags
- product prompts and business workflows
- per-customer telephony policies

Those belong in your own application layer.

## What Belongs In The Deployment Bundle

Use [`/root/fonoster-docker`](/root/fonoster-docker) for:

- `compose.yaml`
- `.env`
- mounted service configs
- integration notes
- changelog
- API test scripts and documentation

## Why This Separation Matters

If business logic is mixed into the Fonoster source tree:

- upstream updates become painful
- debugging platform issues becomes harder
- your CRM logic and telephony engine become tightly coupled
- future contributors cannot tell what is product code vs platform code

## Recommended Long-Term Layout

- [`/root/fonoster`](/root/fonoster)
  - platform source and minimal patches

- [`/root/fonoster-docker`](/root/fonoster-docker)
  - deployment/runtime bundle

- `chatwoot server`
  - CRM

- `telephony bridge`
  - integration service between Chatwoot and Fonoster

- `node voice runtime`
  - thin external app runtime used by Fonoster
