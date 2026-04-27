# Documentation

This directory is the structured documentation set for the current self-hosted Fonoster deployment.

It contains two documentation tracks:

- older Chatwoot-oriented design notes kept for reference
- current Onelink-native integration notes, which should now be treated as the primary track

## Goals

- keep operational notes out of chat history
- separate platform facts from product decisions
- make the documentation expandable without rewriting existing files
- keep deployment docs close to [`/root/fonoster-docker`](/root/fonoster-docker)

## Document Map

- [`01-current-state.md`](./01-current-state.md)
  - current live state of the stack
  - active domain, number, main resources, runtime notes

- [`02-platform-boundary.md`](./02-platform-boundary.md)
  - what belongs in Fonoster
  - what does not belong in Fonoster
  - why deployment and source trees stay separate

- [`03-fonoster-api-capabilities.md`](./03-fonoster-api-capabilities.md)
  - what the native Fonoster API/SDK already provides
  - what it does not provide as a generic admin API

- [`04-chatwoot-target-architecture.md`](./04-chatwoot-target-architecture.md)
  - legacy Chatwoot-oriented target architecture
  - recommended high-level architecture for Chatwoot on another server
  - service boundaries and call flows

- [`05-telephony-bridge.md`](./05-telephony-bridge.md)
  - responsibilities of the bridge service
  - recommended modules, endpoints, and DB mappings

- [`06-node-voice-runtime.md`](./06-node-voice-runtime.md)
  - why a thin Node voice app is still useful even if the main CRM is not Node
  - how it should interact with the bridge

- [`07-entity-mapping.md`](./07-entity-mapping.md)
  - legacy Chatwoot-oriented mapping notes
  - mapping between Chatwoot entities and Fonoster entities
  - routing and AI-control model

- [`08-api-contracts.md`](./08-api-contracts.md)
  - suggested external and internal API contracts
  - request/response shapes for the first MVP

- [`09-delivery-phases.md`](./09-delivery-phases.md)
  - implementation order
  - MVP scope and later phases

- [`10-open-items.md`](./10-open-items.md)
  - known gaps, risks, production hardening tasks

- [`11-native-api-reference.md`](./11-native-api-reference.md)
  - practical native Fonoster API/SDK reference for integrators
  - what methods to use and for which use cases

- [`12-bridge-vs-native-matrix.md`](./12-bridge-vs-native-matrix.md)
  - decision matrix for where each feature should live
  - bridge vs native API vs voice runtime

- [`13-chatwoot-developer-guide.md`](./13-chatwoot-developer-guide.md)
  - legacy Chatwoot-oriented implementation guide
  - what Chatwoot developers should build
  - suggested Rails/Ruby integration patterns and request examples

- [`14-chatwoot-server-checklist.md`](./14-chatwoot-server-checklist.md)
  - legacy Chatwoot rollout checklist
  - step-by-step rollout checklist for the Chatwoot server
  - config, networking, API wiring, and first tests

- [`15-status-summary.md`](./15-status-summary.md)
  - short executive summary
  - what is done, what is not done, and what happens next

- [`16-onelink-native-telephony-integration-plan.md`](./16-onelink-native-telephony-integration-plan.md)
  - current target architecture for `onelink` as control plane
  - what was implemented and what was originally planned

- [`17-remaining-work-summary.md`](./17-remaining-work-summary.md)
  - consolidated current list of what is still left to do
  - recommended completion order and definition of done

- [`18-onelink-server-checklist.md`](./18-onelink-server-checklist.md)
  - current rollout checklist for the Onelink server
  - current integration contract and validation steps

- [`19-final-handoff.md`](./19-final-handoff.md)
  - final compact handoff for the current Fonoster-side work
  - what is done, what is next, and how provider replacement works

- [`_templates/new-doc-template.md`](./_templates/new-doc-template.md)
  - template for adding new documents without breaking structure

## Writing Rules

- Add new documents with numeric prefixes to preserve reading order.
- Keep one concern per file.
- Put operational facts in `01-current-state.md` or `10-open-items.md`.
- Put architecture decisions in their own files instead of expanding the changelog.
- Do not store passwords, API secrets, or private keys in this directory.

## Related Files Outside `docs/`

- [`/root/fonoster-docker/CHANGELOG.md`](/root/fonoster-docker/CHANGELOG.md)
- [`/root/fonoster-docker/API_TESTS.md`](/root/fonoster-docker/API_TESTS.md)
- [`/root/fonoster-docker/CRM_INTEGRATION_PLAN.md`](/root/fonoster-docker/CRM_INTEGRATION_PLAN.md)
- [`/root/fonoster-docker/PROJECT_LAYOUT.md`](/root/fonoster-docker/PROJECT_LAYOUT.md)
