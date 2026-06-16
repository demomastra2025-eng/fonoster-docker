# AI Voice + Operator First-Class Rollout Plan

Last updated: 2026-05-18.

## Purpose

Зафиксировать согласованный rollout-план между OneLink и Fonoster/calls для AI Voice human-like улучшений и operator mode.

Главное ограничение: **operator mode является first-class production path**. Он не является fallback, degraded mode или побочным эффектом AI rollout-а.

## Source Contracts Checked

План должен исполняться в связке с активными контрактами:

- `FONOSTER_ONELINK_VOICE_EXECUTION_CONTRACT.md`
- `ONELINK_VOICE_RUNTIME_MATRIX_CONTRACT.md`
- `docs/18-fonoster-side-execution-plan.md`

## Ownership Boundaries

### OneLink owns

- human-like dialogue behavior;
- DialogueDirector;
- Gemini Live behavior;
- fillers;
- pauses/backchannels;
- barge-in policy;
- async tools;
- silence prompts;
- stale audio cleanup;
- assistant voice settings;
- transcript state;
- recording state and storage policy;
- runtime state;
- operator business selection policy;
- CRM/session truth.

### Fonoster/calls owns

- telecom/media foundation;
- PSTN/SIP ingress and egress;
- routing execution;
- full-duplex media transport;
- `AUDIO_IN` / `AUDIO_OUT` contract;
- stream lifecycle;
- terminal technical events;
- refs/correlation delivery;
- hangup/cancel/media close/app terminal/interruption semantics;
- avoiding premature close during barge-in;
- executing concrete operator/app targets returned by OneLink.

## Non-Negotiable Rollout Rule

AI Voice human-like improvements and operator/transfer/recording/topology changes must not be shipped as one mixed high-risk rollout.

Rollout order:

1. media/lifecycle contract clarification;
2. observability-only fields/logs/metrics;
3. joint AI smoke calls;
4. separate operator first-class smoke block;
5. only then transfer/recording-sensitive changes.

## Phase 1 — Media/Lifecycle Contract Clarification

Goal: зафиксировать короткий media/lifecycle contract до любых risky changes.

Must define:

- `AUDIO_IN` / `AUDIO_OUT` direction semantics;
- PCM format/rate/channels;
- pacing rules;
- max chunk size;
- backpressure behavior;
- error behavior;
- `stream_started` semantics;
- `media_ready` semantics;
- when OneLink can safely write `AUDIO_OUT`;
- terminal events;
- terminal source/reason taxonomy;
- required refs:
  - parent/original call ref;
  - bridge call ref;
  - runtime/AI child call ref;
  - stream ref;
  - media session ref;
  - operator leg ref when applicable;
  - terminal source/reason.

Acceptance criteria:

- OneLink and Fonoster/calls agree the contract text before implementation changes.
- Contract distinguishes setup milestones from real media success.
- `answer` and `StartStreamResponse` are not treated as proof of working audio.
- First valid `AUDIO_OUT` is measured as a real media payload observed by Fonoster/bridge.

## Phase 2 — Observability Only

Goal: add backward-compatible observability before behavior changes.

Add/verify logs, fields, and metrics for:

- first `AUDIO_IN` observed;
- first `AUDIO_OUT` observed;
- audio-in byte counters;
- audio-out byte counters;
- media established before close;
- terminal source;
- terminal reason;
- provider cancel vs caller hangup vs media close;
- parent/runtime/stream/media-session refs;
- operator/customer leg refs where applicable.

Rules:

- No topology change in this phase unless separately approved.
- No transfer/recording behavior change in this phase.
- Existing production operator path must not degrade.

Acceptance criteria:

- Logs can join one call across Fonoster, OneLink runtime, and Rails by refs.
- Terminal state can be explained without guessing.
- Byte counters prove whether media was actually exchanged.

## Phase 3 — AI Voice Human-Like Joint Smoke Calls

Goal: validate full-duplex AI behavior while keeping operator-sensitive changes out of scope.

Smoke scenarios:

1. Normal AI call.
2. AI speaks, caller interrupts.
3. Caller hangs up while AI speaks.
4. Silence before first AI audio.
5. Long async tool + filler.
6. Provider/media close.
7. AI terminal/finalize once.

For every scenario verify:

- Fonoster logs;
- OneLink runtime logs;
- Rails/session state;
- refs;
- timestamps;
- terminal reason;
- session cleanup;
- audio-in/out counters;
- no premature close during barge-in.

Barge-in target behavior:

- caller `AUDIO_IN` continues while OneLink writes `AUDIO_OUT`;
- Fonoster does not do half-duplex gating;
- caller speech during AI answer is not a terminal event;
- interruption policy stays in OneLink;
- OneLink decides whether to clear output buffer, finish a word, pause, or backchannel.

Acceptance criteria:

- AI media path remains full-duplex.
- Barge-in does not terminate the call.
- First-response SLA uses observed `AUDIO_OUT`, not only internal runtime events.

## Phase 4 — Operator First-Class Production Path

Goal: validate operator mode as a native, reliable production path independent of AI rollout.

Core position:

- operator mode is first-class production path;
- operator mode is not fallback;
- operator mode is not degraded mode;
- operator mode is not a side-effect of AI rollout;
- operator mode must work without AI as a mandatory intermediate layer.

Operator path must be:

- native;
- stable;
- predictable by lifecycle;
- observable;
- compatible with current production scenarios;
- explicit about media ownership;
- explicit about recording/transcript ownership.

Implemented observability/SLA contract fields:

- first-class runtime handoff:
  - `operatorObservabilityKey=operator.runtime_handoff`;
  - `operatorSlaClass=first_class_runtime`;
  - `recordingImportContract=runtime_owned_no_fonoster_import`;
  - `transcriptContract=onelink_runtime`.
- degraded direct bridge:
  - `operatorObservabilityKey=operator.direct_bridge.degraded`;
  - `operatorSlaClass=degraded_direct_bridge`;
  - `recordingImportContract=fonoster_pull_recording_ready_required`;
  - `transcriptContract=explicit_direct_bridge_contract_required`.
- recursive operator handoff block:
  - `operatorObservabilityKey=operator.recursive_handoff_blocked`;
  - `operatorSlaClass=blocked_recursive_handoff`.

Technical requirements:

- operator routing is explicit and native;
- no recursive app handoff;
- no blind direct bridge without events when OneLink must see call state;
- parent/original call ref is preserved;
- operator/runtime call ref is available if a separate leg is created;
- terminal events allow OneLink to close the call session correctly;
- if OneLink continues recording/transcript, media path must not unexpectedly bypass OneLink;
- if media ownership changes, that change must be explicit by event/contract.

Operator smoke matrix:

1. Inbound → operator native.
2. Outbound → operator/customer.
3. AI → operator transfer.
4. Caller hangup before operator answer.
5. Operator hangup first.
6. Operator unavailable.
7. Failed bridge.
8. Recording/transcript continues or explicitly stops by contract.
9. Terminal events contain all required refs/reason.
10. OneLink call session does not remain active after completion.

Per-scenario verification:

- bridge/original call ref;
- operator leg ref;
- runtime call ref when applicable;
- media session ref when applicable;
- terminal source;
- terminal reason;
- session cleanup;
- recording ownership;
- transcript ownership;
- no duplicate finalize;
- no orphan active call session.

Acceptance criteria:

- Operator changes are production-ready only after successful joint smoke matrix.
- The joint smoke matrix must confirm:
  - refs;
  - terminal reasons;
  - session cleanup;
  - recording/transcript ownership.

## Phase 5 — Transfer/Recording-Sensitive Changes

Goal: only after AI and operator smoke validation, agree changes that affect transfer, media ownership, recording, transcript continuation, and topology.

Topics requiring explicit approval:

- AI → operator transfer topology;
- media ownership during and after transfer;
- recording ownership;
- transcript continuation;
- bridge/handoff lifecycle;
- direct bridge vs runtime-in-media-path rules;
- late recording import contract if Fonoster records operator/direct-bridge mode.

Recording/import rule for operator/direct-bridge cases:

- Prefer pull contract, not primary multipart upload.
- Fonoster emits JSON `recording_ready` with bearer auth and idempotency key.
- OneLink downloads asynchronously, verifies size/sha256, stores, and attaches to the exact call bubble.
- AI app recordings remain OneLink-runtime owned and must not be imported from Fonoster.

Acceptance criteria:

- Recording/transcript ownership is explicit for every topology.
- OneLink can reconcile final session state without duplicate sessions.
- Fonoster and OneLink agree whether runtime remains in the media path.

## Rollout Gating Rule

Final agreed block:

Согласны:

- общий AI Voice human-like план идёт phased/contract-first;
- operator mode выносим отдельным first-class production path;
- operator mode — не fallback, не degraded mode и не побочный эффект AI rollout-а;
- transfer/operator/recording/topology изменения не смешиваем с AI human-like rollout;
- любые изменения в этой зоне проходят отдельное согласование и smoke validation;
- operator changes считаются готовыми к production только после успешного прохождения отдельной joint smoke matrix с подтверждёнными:
  - refs;
  - terminal reasons;
  - session cleanup;
  - recording/transcript ownership.

Это является обязательным rollout-gating ограничением.

## Immediate Next Steps

1. OneLink prepares short Phase 1 contract/checklist.
2. Fonoster/calls confirms media/lifecycle semantics and current gaps.
3. Both sides add Phase 2 observability without topology changes.
4. Run Phase 3 AI smoke calls.
5. Run Phase 4 operator first-class smoke matrix separately.
6. Only after both pass, discuss Phase 5 transfer/recording-sensitive changes.

## Production Readiness Definition

The rollout is not production-ready until:

- active contracts are updated or explicitly referenced;
- AI smoke matrix passes;
- operator smoke matrix passes;
- refs are visible in logs/events;
- terminal reasons are unambiguous;
- session cleanup is verified;
- recording/transcript ownership is explicit;
- rollback path is documented;
- no operator production scenario is degraded by AI Voice changes.
