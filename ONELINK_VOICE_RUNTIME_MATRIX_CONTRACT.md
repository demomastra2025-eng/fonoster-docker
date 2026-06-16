# OneLink Voice Runtime Matrix Contract

Canonical internal contract for how OneLink, Fonoster, and the OneLink voice runtimes must behave across `operator`, `ai`, and `app` modes for both inbound and outbound calls.

Last updated: 2026-05-17.

Related active documents:

- `ONELINK_FONOSTER_VOICE_CONTRACT.md` - canonical high-level voice/call/recording contract.
- `ONELINK_BRIDGE_API_CONTRACT.md` - Rails <-> Fonoster bridge command/callback API.
- `ONELINK_EXTERNAL_GEMINI_LIVE_VOICEAPP.md` - deployment/runbook for `onelink-ai-voice`.
- `docs/internal/voice-fonoster-integration-contract.mdx` - internal docs index that points to active source-of-truth files.

This document is intentionally implementation-facing. It names runtime files, ownership boundaries, data fields, media semantics, lifecycle events, routing decisions, fallback behavior, and acceptance criteria so Fonoster, Rails, and OneLink voice runtimes can implement the same technical contract.

This file describes target technical behavior only: expected external behavior, data contracts, media contracts, lifecycle semantics, ownership boundaries, and acceptance criteria.

## Approved AI target architecture

Target production AI architecture is **Option A**:

```text
PSTN/SIP inbound
-> Fonoster
-> route decision
-> direct OneLink AI app endpoint
-> AI runtime prewarm
-> answer
-> StartStreamResponse with stream_ref
-> first observed valid AUDIO_OUT
```

The direct production AI executor is the OneLink AI Runtime app endpoint, currently represented by the `f2498...` Fonoster app ref family. The AI production happy path must not include an intermediate local Fonoster voice-runtime -> `app:f2498...` child handoff.

The local voice-runtime -> `app:f2498...` child handoff is allowed only as transition/debug compatibility. It is outside the production SLA path and must be reported as such in diagnostics, traces, and contract language.

AI latency SLA:

```text
answer + StartStreamResponse(stream_ref present) -> first observed valid AUDIO_OUT <= 0.7s
```

`stream_started` means the runtime has received `StartStreamResponse` and has a usable `stream_ref`; it does not mean merely calling `stream()` / `StartStream.run()`. The first payload may be greeting, keepalive, or silence PCM, but it must be a real media `AUDIO_OUT` payload observed by Fonoster/bridge, not only an internal runtime event.

OneLink owns the matrix contract. Fonoster/ct.z owns the counterpart execution contract. Both documents must describe the same AI production happy path above.

## Source files checked for this version

Rails / Chatwoot:

- `app/services/telephony/inbound_routing_service.rb`
- `app/services/telephony/events_ingestion_service.rb`
- `app/services/telephony/ai_voice/context_builder.rb`
- `app/services/telephony/ai_voice/event_adapter_service.rb`
- `app/services/telephony/ai_voice/finalization_service.rb`
- `app/controllers/telephony/bridge_routes_controller.rb`
- `app/controllers/telephony/bridge_events_controller.rb`
- `app/controllers/internal/voice/ai/*_controller.rb`
- `app/models/telephony/routing_policy.rb`
- `app/models/telephony/number_binding.rb`
- `app/models/telephony/call_session.rb`

Runtime / example references:

- `services/onelink-ai-voice/src/app/voice-application.js`
- `services/onelink-ai-voice/src/sessions/voice-session.js`
- `services/onelink-ai-voice/src/onelink/client.js`
- `services/onelink-ai-voice/src/fonoster/managed-stream.js`
- `services/onelink-ai-voice/src/recordings/recording-writer.js`
- `/root/crafty/example/test-voiceapp/index.js` as historical/SDK behavior reference only.

## Hard ownership boundaries

### Fonoster owns telecom execution

Fonoster owns:

- PSTN/SIP ingress and egress.
- Fonoster numbers, trunks, domains, agents, and app refs.
- `Calls.createCall` / call creation.
- Answer/dial/transfer/hangup/reject execution.
- Technical call media handoff to the selected OneLink runtime.
- Delivery of stable telecom identifiers and lifecycle events.
- Technical fallback if an app endpoint is unreachable.

Fonoster must not own:

- Gemini keys.
- Captain prompts or tool definitions.
- CRM/customer context.
- OneLink storage credentials.
- Recording retention, permissions, signed playback/download URLs, or audit policy.
- Operator business selection policy beyond executing concrete targets returned by OneLink.

### Rails / Chatwoot owns business truth

Rails owns:

- Account/inbox/number binding resolution.
- `Telephony::RoutingPolicy` and selected route mode.
- Contact/conversation/call session records.
- Operator pool selection and busy filtering.
- Captain assistant, prompts, rules, AI settings, and tool catalog.
- Tool execution against CRM/domain data.
- Transcript ingestion, summaries, final statuses, and voice message sync.
- Recording metadata and playback/download policy.

Rails receives JSON only. Rails must never receive realtime audio frames.

### OneLink voice runtimes own recordable media path

For any recordable call, the selected OneLink runtime must stay in the media path and must see both directions:

- `AUDIO_IN`: caller/local audio into the runtime.
- `AUDIO_OUT`: AI/operator/app/remote audio out of the runtime.

Current and target runtime roles:

- `onelink-ai-voice`: AI/Gemini Live calls. Implemented today.
- `onelink-operator-voice`: operator calls. May initially be same codebase/runtime in `operator` mode, but responsibility is separate.
- `onelink-app-voice`: app-flow calls. May initially be same codebase/runtime in `app` mode, but responsibility is separate.

Direct bridge rule:

```text
If recording is required, Fonoster must not bridge caller <-> operator/app directly
in a way that removes the OneLink runtime from the media path.
```

## Mode vocabulary

Canonical routing actions:

- `ai`
- `operator`
- `app`
- `reject`

Canonical directions:

- `inbound`
- `outbound`

Canonical transfer sub-mode:

- `transfer` means an active AI call transfers to an operator. It is not a top-level inbound route mode; it is a runtime action inside an AI session.

Runtime role by mode:

- `ai` -> `onelink-ai-voice`
- `operator` -> `onelink-operator-voice` or current shared runtime handling operator mode
- `app` -> `onelink-app-voice` or current shared runtime handling app mode
- `transfer` -> starts in `onelink-ai-voice`; if recording must continue after transfer, the agreed OneLink runtime must remain in the media path

## Required identifiers

Every cross-service request/event should carry these when available:

```json
{
  "call_ref": "bridge-call-ref",
  "bridge_call_ref": "original-fonoster-bridge-call-ref",
  "provider_call_id": "fonoster-call-ref",
  "runtime_call_ref": "selected-runtime-or-app-leg-call-ref",
  "ai_runtime_call_ref": "ai-runtime-call-ref-when-ai-is-involved",
  "account_id": 1,
  "inbox_id": 2,
  "number_ref": "fonoster-number-ref",
  "conversation_id": 123,
  "conversation_display_id": 456,
  "contact_id": 789,
  "media_session_ref": "fonoster-media-session-ref",
  "stream_ref": "fonoster-stream-ref",
  "direction": "inbound",
  "routing_mode": "ai",
  "app_ref": "fonoster-external-app-ref",
  "event_id": "stable-event-id",
  "event_seq": 1,
  "attempt": 1
}
```

Canonical call-id rules:

- `bridge_call_ref` is the original Fonoster/bridge call reference and the primary Rails/Chatwoot join key.
- `runtime_call_ref` is the runtime/app leg reference when a runtime or app handoff creates a separate technical leg.
- New payloads set `call_ref = bridge_call_ref`.
- `provider_call_id` is an alias for the Fonoster/provider call reference; for new events it should equal `bridge_call_ref` unless Fonoster exposes an additional provider id.
- Legacy runtime payloads may place `runtime_call_ref` in `call_ref`; when `bridge_call_ref` is present, Rails must join by `bridge_call_ref` and keep the runtime value as a child/runtime reference.
- A runtime-only `call_ref` without `bridge_call_ref` is accepted only as legacy/degraded correlation and should not be the target contract.

Transition aliases accepted at API boundaries:

- `parent_call_ref` -> `bridge_call_ref`
- `child_call_ref` -> `runtime_call_ref`
- `mediaSessionRef` -> `media_session_ref`
- `streamRef` -> `stream_ref`
- `appRef` -> `app_ref`

Idempotency rules:

- `event_id` or `X-Idempotency-Key` is required for runtime `/event` and `/finalize`.
- Retries must reuse the same `event_id`/idempotency key.
- `event_seq` is monotonic within one runtime session.
- When a runtime handoff creates a new technical call ref, keep the original as `bridge_call_ref` on every downstream event/finalize payload.

## Auth boundary

Fonoster/bridge callbacks to Rails:

```http
X-Bridge-Secret: <shared secret>
X-Telephony-Secret: <shared secret>
Authorization: Bearer <bridge token>
```

OneLink voice runtimes to Rails:

```http
Authorization: Bearer <internal voice token>
```

Rails accepts these voice-token env aliases:

```text
VOICE_AGENT_ONELINK_AI_SHARED_SECRET
ONELINK_AI_VOICE_INTERNAL_TOKEN
AI_VOICE_INTERNAL_TOKEN
ONELINK_INTERNAL_SECRET
ONELINK_INTERNAL_TOKEN
```

Runtime client currently uses:

```text
VOICE_AGENT_ONELINK_AI_BASE_URL
VOICE_AGENT_ONELINK_AI_SHARED_SECRET
ONELINK_AI_VOICE_INTERNAL_TOKEN
ONELINK_INTERNAL_SECRET
ONELINK_INTERNAL_TOKEN
VOICE_AGENT_INTERNAL_TOKEN
TELEPHONY_BRIDGE_ONELINK_ACCESS_TOKEN
TELEPHONY_BRIDGE_ACCESS_TOKEN
TELEPHONY_BRIDGE_SHARED_SECRET
```

## Rails inbound route callback

Fonoster or the selected runtime calls:

```http
POST /internal/voice/inbound/route
```

Minimum request:

```json
{
  "call_ref": "fonoster-call-ref",
  "ingress_number": "+186...",
  "caller_number": "+770...",
  "number_ref": "fonoster-number-ref",
  "app_ref": "current-runtime-app-ref",
  "media_session_ref": "media-session-ref"
}
```

Rails resolves `Telephony::NumberBinding`, `Telephony::RoutingPolicy`, existing voice conversation, and operator candidates.

Important current Rails behavior:

- `number_ref` wins over `ingress_number` for number binding lookup.
- `routing_policy.mode` decides primary route: `operator`, `app`, `ai`, `reject`.
- Pending existing voice conversations may force AI when `ai_enabled` and Captain assistant exist.
- `configured_app_ref` and `effective_ai_app_ref` are rejected as recursive if equal to request `app_ref`.
- If routing is not diagnostic and `call_ref` + caller exist, Rails emits `session_started` through `Telephony::EventsIngestionService`.
- Recording payload defaults to enabled unless `ai_voice_settings.recording_enabled` explicitly disables it.

### Inbound route decisions

AI decision:

```json
{
  "action": "ai",
  "ai_mode": "fonoster_managed|onelink_managed",
  "app_ref": "onelink-ai-voice-fonoster-external-app-ref",
  "reason": "ai_route",
  "account_id": 1,
  "inbox_id": 2,
  "number_ref": "number-ref",
  "conversation_id": 123,
  "conversation_display_id": 456,
  "recording": {
    "enabled": true,
    "source": "onelink_runtime",
    "storage_provider": "onelink_storage"
  }
}
```

Operator decision:

```json
{
  "action": "operator",
  "reason": "operator_route",
  "agent_aor": "sip:1001@operator.cloud.vconsult.kz",
  "agent_ref": "fonoster-agent-ref",
  "agent_aors": ["sip:1001@operator.cloud.vconsult.kz"],
  "operator_pool": false,
  "operator_pool_size": 1,
  "operator_candidates": [
    {
      "id": 10,
      "agent_ref": "fonoster-agent-ref",
      "agent_aor": "sip:1001@operator.cloud.vconsult.kz",
      "user_id": 5,
      "name": "Operator Name"
    }
  ],
  "account_id": 1,
  "inbox_id": 2,
  "number_ref": "number-ref",
  "recording": {
    "enabled": true,
    "source": "onelink_runtime",
    "storage_provider": "onelink_storage"
  }
}
```

App decision:

```json
{
  "action": "app",
  "app_ref": "target-fonoster-app-ref",
  "reason": "app_route",
  "account_id": 1,
  "inbox_id": 2,
  "number_ref": "number-ref",
  "recording": {
    "enabled": true,
    "source": "onelink_runtime",
    "storage_provider": "onelink_storage"
  }
}
```

Reject decision:

```json
{
  "action": "reject",
  "message": "We are unable to connect your call right now.",
  "reason": "number_not_bound|routing_policy_missing|operator_unavailable|reject_route|unsupported_mode"
}
```

## Inbound mode matrix

### Inbound `ai`

Flow:

```text
PSTN/SIP
-> Fonoster number
-> route lookup in Rails
-> Rails returns action=ai + app_ref
-> Fonoster connects call directly to the selected OneLink AI app endpoint
-> AI runtime receives inbound session/context and starts prewarm
-> runtime preconnects Gemini Live/context/tool catalog whenever possible before answer
-> runtime answers only when it can immediately send greeting/keepalive
-> runtime starts bidirectional stream BOTH/WAV
-> StartStreamResponse received with usable stream_ref
-> first observed valid AUDIO_OUT within production SLA
-> AUDIO_IN caller -> Gemini
-> Gemini audio -> AUDIO_OUT caller
-> runtime records both directions if enabled
-> runtime sends transcript/event/finalize JSON to Rails
```

OneLink runtime obligations:

- The selected OneLink AI app endpoint is the direct production executor for `action=ai`.
- Do not use local voice-runtime -> `app:f2498...` child handoff in the AI production happy path; keep that path transition/debug only.
- Receive inbound session/context immediately after route decision and start AI prewarm before answer whenever possible.
- Preconnect Gemini Live and prepare context/tool catalog before answer whenever possible.
- Answer only when the runtime can immediately send a greeting/keepalive media payload.
- Start stream immediately after answer with `direction=BOTH`, `format=WAV`.
- Treat `stream_started` as `StartStreamResponse` received with usable `stream_ref`, not as a mere `stream()` call.
- Fail fast and finalize `failed` when `StartStream.run()` does not return `streamRef`/stream response in time.
- Send first greeting/keepalive without waiting for FAQ/tools.
- Run FAQ/tools after the first phrase, asynchronously or in parallel where possible.
- Use `AUDIO_IN` only as caller input to Gemini.
- Write Gemini output as `AUDIO_OUT` using `StreamMessageType.AUDIO_OUT`.
- Pace output as PCM16 frames at `VOICE_AGENT_REALTIME_CALL_RATE` (currently 8000 Hz, 20 ms frames).
- Record inbound and outbound tracks into OneLink-owned storage when recording is enabled.
- Emit `media_stream_started` before active media, and `recording_ready` when recording is closed.
- Finalize exactly once semantically; retries must be idempotent.

AI production latency SLA:

- Measure from `answer` + received `StartStreamResponse` with `stream_ref` to first Fonoster/bridge-observed valid `AUDIO_OUT`.
- Happy-path target is `<= 0.7s`.
- The first `AUDIO_OUT` may be greeting, keepalive, or silence PCM, but must be a real media payload observed by Fonoster/bridge.

Rails obligations:

- `/internal/voice/ai/context` returns account, conversation, contact, inbox, AI config, Captain config, transfer config, recording config, and tool catalog.
- `/internal/voice/ai/tools/:name` is the only tool execution boundary.
- `/internal/voice/ai/event` adapts runtime events into `Telephony::EventsIngestionService` and ingests transcript deltas.
- `/internal/voice/ai/finalize` maps final status into canonical call status.

Fonoster obligations:

- Connect the call directly to the selected OneLink AI EXTERNAL app ref in the AI production happy path.
- Do not route AI happy-path calls through a local voice-runtime -> `app:f2498...` child handoff.
- Provide stable `call_ref`, `media_session_ref`, and `stream_ref` when available.
- Deliver both `AUDIO_IN` and `AUDIO_OUT` semantics through the SDK/media transport.
- Account first valid `AUDIO_OUT` from stream payloads and expose enough timing/byte evidence to verify the SLA.
- Do not keep Gemini config or keys on the Fonoster side.

### Inbound `operator`

Flow:

```text
PSTN/SIP
-> Fonoster number
-> route lookup in Rails
-> Rails returns action=operator + operator_candidates/agent_aor
-> Fonoster connects call to OneLink operator-capable runtime
-> runtime answers
-> runtime starts passive bidirectional recording stream when recording enabled
-> runtime dials operator candidate(s)
-> first answered operator leg wins
-> losing operator legs are best-effort rejected/hung up
-> lifecycle + recording events -> Rails
```

OneLink runtime obligations:

- Use `operator_candidates` when present; otherwise use single `agent_aor`/`destination`/`target`.
- Dial candidates through Fonoster SDK (`call.dial`) or transfer fallback (`call.transfer`) with `agent_aor`.
- Treat answer events as `operator_answered` / `in_progress`.
- Treat `operator_no_answer`, `operator_busy`, `operator_rejected`, and `operator_timeout` as `operator_unavailable` or explicit fallback when the route includes one.
- Treat `operator_dial_failed` as `failed` or explicit fallback when configured.
- Treat `operator_hangup` after `operator_answered` as a normal operator-leg terminal event, not provider failure.
- Apply a default 30 second operator timeout unless `operator_timeout_ms` is supplied.
- If multiple candidates are dialed, first answer wins and losing legs are cleaned up best-effort with `operator_cancelled` where available.
- Start passive recording before dialing when recording is enabled.
- Passive recording must observe both `AUDIO_IN` and `AUDIO_OUT`; if only one direction is visible, mark recording as incomplete/unavailable rather than claiming full stereo recording.

Operator outcome events:

- `operator_ringing`
- `operator_answered`
- `operator_no_answer`
- `operator_busy`
- `operator_rejected`
- `operator_timeout`
- `operator_dial_failed`
- `operator_cancelled`
- `operator_hangup`

Rails obligations:

- Return only enabled, registered, SIP `agent_aor` candidates.
- Exclude busy operator bindings using active call sessions.
- Sort configured/preferred operator first, then deterministic fallback ordering.
- Store candidate metadata in call session event metadata.
- Set `agent_binding_id` when an operator answer event identifies a binding/candidate.

Fonoster obligations:

- Execute dial/bridge to operator target(s).
- Emit enough lifecycle to distinguish caller hangup, operator answer, no-answer, busy, rejected, failed, and terminal hangup.
- Keep the OneLink runtime in the recordable media path.

### Inbound `app`

Flow:

```text
PSTN/SIP
-> Fonoster number
-> route lookup in Rails
-> Rails returns action=app + app_ref
-> Fonoster connects call to OneLink app-capable runtime
-> runtime answers
-> runtime starts passive recording when recording enabled
-> runtime transfers/hands off to target app_ref
-> lifecycle + recording events -> Rails
```

OneLink runtime obligations:

- Reject recursive app refs: if Rails returns current runtime app ref, do not loop; local runtime may handle only explicit `recursive_runtime_app_ref` fallback behavior.
- Use app handoff in this fallback order: `call.transferToApp({ app_ref })`, then `call.transfer({ app_ref })`, then legacy `call.transfer({ appRef })`.
- Keep recording active through app handoff if the call is recordable.
- Preserve `bridge_call_ref` through app handoff; any new app/runtime leg reference must be emitted as `runtime_call_ref`.
- Emit `app_routing`, `app_handoff_failed` when handoff fails, `session_completed`, `session_failed`, and recording lifecycle events.

Rails obligations:

- Return `app_ref` only after checking it is not the runtime app ref that initiated the route lookup.
- Fall back according to policy if app ref is missing or recursive.

Fonoster obligations:

- Execute app handoff to the exact app ref returned by OneLink.
- Do not substitute local test apps in production.
- Preserve original call identifiers or pass `bridge_call_ref` when a technical handoff creates a new call ref.

## Outbound command contract

Rails initiates outbound through the Fonoster bridge:

```http
POST /telephony/calls/outbound
```

Common required fields:

```json
{
  "from": "+186...",
  "to": "+770...",
  "metadata": {
    "onelink_account_id": 1,
    "conversation_id": 123,
    "contact_id": 456,
    "inbox_id": 2,
    "number_ref": "number-ref",
    "routing_mode": "ai|operator|app",
    "recording_enabled": true
  }
}
```

Bridge response:

```json
{
  "ref": "fonoster-call-ref",
  "status": "created"
}
```

Rails must store `ref` as the canonical provider/Fonoster call reference and reconcile status through events/finalize. `call_ref` and `provider_call_id` may be accepted as outbound-create response aliases during transition, but the canonical response field is `ref`; subsequent runtime/event payloads should carry that value as `bridge_call_ref`.

### Outbound `ai`

Request shape:

```json
{
  "from": "+186...",
  "to": "+770...",
  "app_ref": "onelink-ai-voice-fonoster-external-app-ref",
  "ai_mode": "onelink_managed",
  "metadata": {
    "onelink_account_id": 1,
    "conversation_id": 123,
    "contact_id": 456,
    "routing_mode": "ai",
    "recording_enabled": true
  }
}
```

Flow:

```text
Rails creates call session/conversation intent
-> Rails calls Fonoster bridge /telephony/calls/outbound with AI app_ref
-> Fonoster Calls.createCall
-> Fonoster connects answered call to onelink-ai-voice
-> runtime fetches context using call_ref/account/conversation metadata
-> Gemini Live handles media
-> runtime records/events/transcripts/finalize to Rails
```

Required behavior:

- The outbound call must use the OneLink AI EXTERNAL app ref, not local `test-voiceapp`.
- Runtime context lookup must include `account_id` and preferably `conversation_id` to avoid ambiguous call resolution.
- Final statuses use the same AI finalization contract as inbound.

### Outbound `operator`

Request shape options:

```json
{
  "from": "+186...",
  "to": "+770...",
  "agent_aor": "sip:1001@operator.cloud.vconsult.kz",
  "metadata": {
    "onelink_account_id": 1,
    "conversation_id": 123,
    "contact_id": 456,
    "routing_mode": "operator",
    "recording_enabled": true
  }
}
```

Preferred recordable shape when a OneLink operator runtime app ref exists:

```json
{
  "from": "+186...",
  "to": "+770...",
  "app_ref": "onelink-operator-voice-fonoster-external-app-ref",
  "agent_aor": "sip:1001@operator.cloud.vconsult.kz",
  "metadata": {
    "onelink_account_id": 1,
    "conversation_id": 123,
    "contact_id": 456,
    "routing_mode": "operator",
    "recording_enabled": true
  }
}
```

Required behavior:

- If recording is required, the operator call must pass through OneLink operator-capable runtime so both caller/customer and operator audio are visible to OneLink.
- A direct Fonoster call from operator to customer is allowed only for non-recordable calls or explicitly agreed degraded mode.
- Rails remains source of truth for call session status and recording metadata.

### Outbound `app`

Request shape:

```json
{
  "from": "+186...",
  "to": "+770...",
  "app_ref": "onelink-app-voice-or-target-app-ref",
  "metadata": {
    "onelink_account_id": 1,
    "conversation_id": 123,
    "contact_id": 456,
    "routing_mode": "app",
    "recording_enabled": true
  }
}
```

Required behavior:

- If recording is required, use a OneLink app-capable runtime as the selected app or ensure the target app keeps OneLink in the media path.
- If the app runtime hands off to another app, preserve `bridge_call_ref` and propagate lifecycle events.
- App-specific business logic must not require Rails to process realtime audio.

## AI transfer to operator

Transfer starts inside active `ai` mode.

Flow:

```text
Gemini tool_call
-> onelink-ai-voice ToolExecutor
-> Rails /internal/voice/ai/tools/:name
-> Rails returns action=transfer + operator_agent_aor
-> runtime emits transfer_requested + transfer_started
-> runtime dials operator through Fonoster SDK
-> runtime emits transfer_answered/transfer_result or transfer_failed
-> finalize transferred/operator_unavailable/failed
```

Tool result expected by runtime:

```json
{
  "ok": true,
  "result": {
    "action": "transfer",
    "operator_agent_aor": "sip:1001@operator.cloud.vconsult.kz",
    "reason": "customer_requested_human"
  }
}
```

Runtime maps provider events:

- Answer/connect/accepted -> `transfer_answered`, `transfer_result.result=answered`.
- No-answer/timeout/busy/rejected/declined -> `transfer_failed`, final `operator_unavailable` unless provider error says failed.
- Operator leg completion after answer -> final `transferred` with reason `operator_completed`.
- Dial exception -> final `failed` with `operator_dial_failed`.

Recording rule:

- If the AI call is recordable, transfer must not bypass OneLink recording without explicit degraded-mode decision.
- Preferred topology: AI runtime remains the media/control anchor through the transfer and continues recording.
- Alternate topology: handoff from AI runtime to operator runtime is allowed only when `bridge_call_ref` and recording continuity are preserved.
- Direct AI-to-operator transfer without OneLink runtime media visibility is degraded mode, not production-ready full recording.
- If recording cannot continue after transfer, finalize with explicit metadata that recording is partial/incomplete.

## Call action and state contract

This section defines the complete action/state layer that Rails, runtimes, Fonoster, and the UI must be able to reconstruct for every inbound and outbound call. It is separate from telecom provider internals: provider events may be richer, but OneLink must persist the normalized state below for system behavior, audit, and user-visible UI.

Canonical call actions:

- `inbound_received` - provider/bridge received an inbound PSTN/SIP call.
- `outbound_requested` - Rails/user/automation requested an outbound call.
- `outbound_created` - Fonoster accepted outbound creation and returned canonical `ref`.
- `route_lookup_started` / `route_lookup_completed` / `route_lookup_failed`.
- `route_selected` with `mode=ai|operator|app|reject` and selected target metadata.
- `call_answered` - caller/customer leg answered by bridge/runtime/app.
- `runtime_connecting` / `runtime_answered` - OneLink runtime leg is being connected/has answered.
- `media_stream_starting` / `media_stream_started` / `media_stream_failed` / `media_stream_closed`.
- `ai_started` / `ai_first_message_sent` / `ai_tool_call_started` / `ai_tool_call_completed` / `ai_tool_call_failed`.
- `operator_dial_started` / `operator_ringing` / `operator_answered` / `operator_no_answer` / `operator_busy` / `operator_rejected` / `operator_timeout` / `operator_dial_failed` / `operator_cancelled` / `operator_hangup`.
- `app_handoff_started` / `app_handoff_completed` / `app_handoff_failed`.
- `transfer_requested` / `transfer_answered` / `transfer_failed` / `transfer_completed`.
- `recording_started` / `recording_ready` / `recording_failed` / `recording_incomplete`.
- `transcript_started` / `transcript_delta` / `transcript_finalized` / `transcript_failed`.
- `caller_hangup` / `remote_hangup` / `provider_hangup` / `runtime_hangup`.
- `session_completed` / `session_failed` / `session_cancelled` / `session_rejected` / `session_timeout`.
- `finalize_sent` / `finalize_accepted` / `finalize_duplicate` / `finalize_conflict`.

Provider raw detail rule:

- OneLink normalized actions do not need separate canonical `provider_answered`, `bridge_created`, `bridge_joined`, `leg_created`, `leg_joined`, or `leg_failed` actions.
- Provider/bridge/runtime-rich details remain in raw/provider metadata and may be carried as `payload.provider_event_type`, `provider_status`, `provider_leg_ref`, `provider_reason`, `provider_error`, and provider-specific metadata.
- OneLink persists the normalized action/state layer for Rails, UI, audit, idempotency, and reporting. Provider-specific details must not create additional user-visible `call_status` values unless explicitly added to this contract.

State dimensions stored by OneLink:

- `call_status`: canonical user/system call state.
- `route_status`: route lookup/selection state.
- `bridge_status`: provider/bridge leg state.
- `runtime_status`: OneLink runtime/app leg state.
- `media_status`: media stream state.
- `recording_status`: recording lifecycle state.
- `transcript_status`: transcript lifecycle state.
- `operator_status`: operator candidate/winning leg state when mode is `operator` or AI transfers to operator.
- `app_status`: app handoff state when mode is `app`.
- `finalize_status`: finalization/idempotency state.

Canonical `call_status` values visible to Rails/UI:

- `created` - outbound command accepted but no ringing/answer yet.
- `routing` - inbound call is being routed.
- `ringing` - caller/customer/operator/app leg is ringing or being connected.
- `connecting` - runtime/app/media is being established after answer.
- `in_progress` - live media/control path is active.
- `completed` - call ended normally after answer.
- `transferred` - AI/runtime successfully handed control to operator/app; Rails may display as completed/transferred but must preserve transfer metadata.
- `no_answer` - no operator/customer/app answered before timeout.
- `busy` - remote/operator side was busy.
- `rejected` - route, operator, customer, or app explicitly rejected.
- `cancelled` - caller/user cancelled before meaningful answer or terminal state.
- `failed` - provider/runtime/media/system failure.
- `timeout` - route/runtime/media/provider timeout not better represented by `no_answer`.

Terminal runtime statuses remain the smaller finalize set defined below. `call_status` may include UI-specific states such as `created`, `routing`, `ringing`, `connecting`, `busy`, and `transferred` for timeline/display, but finalize must map into the bounded terminal statuses.

Required timestamps and actor fields:

- `requested_at` for outbound/user/automation command.
- `received_at` for inbound provider receipt.
- `route_started_at`, `route_completed_at`.
- `answered_at` for the first answered customer/caller leg.
- `runtime_answered_at` when OneLink runtime/app leg answers.
- `media_started_at`, `media_closed_at`.
- `operator_ringing_at`, `operator_answered_at`, `operator_ended_at` when applicable.
- `app_handoff_started_at`, `app_handoff_completed_at` when applicable.
- `ended_at` and `duration_ms` for final state.
- `ended_by=caller|operator|ai|app|runtime|provider|system|unknown`. `caller` means the customer/PSTN party for both inbound and outbound calls.
- `initiated_by=user|automation|inbound_caller|ai|system`.

Inbound coverage:

- `ai`: inbound received -> route selected AI -> direct OneLink AI app endpoint -> AI prewarm -> answer -> StartStreamResponse with `stream_ref` -> first observed valid `AUDIO_OUT` -> AI media/tool lifecycle -> recording/transcript -> terminal/finalize.
- `operator`: inbound received -> route selected operator -> runtime answer for recordable calls -> operator candidate dialing -> first answer wins or unavailable fallback -> recording -> terminal/finalize.
- `app`: inbound received -> route selected app -> runtime answer for recordable/app-aware calls -> app handoff -> recording/transcript when configured -> terminal/finalize.
- `reject`: inbound received -> route selected reject -> provider reject/hangup -> terminal `rejected`/`cancelled` with no recording requirement.

Outbound coverage:

- `ai`: outbound requested -> Fonoster creates call -> customer answers -> connect AI runtime -> StartStream -> AI media/tool lifecycle -> recording/transcript -> terminal/finalize.
- `operator`: outbound requested -> strategy decides `operator_first`, `customer_first`, or configured `operator_strategy` -> connect both legs through OneLink runtime for recordable calls -> recording -> terminal/finalize.
- `app`: outbound requested -> Fonoster creates call -> customer answers -> connect app-capable runtime -> app handoff -> recording/transcript when configured -> terminal/finalize.
- User/system cancellation before answer must produce `cancelled`; remote no-answer must produce `no_answer`; provider/runtime failures must produce `failed` with reason/error details.

User-visible artifacts:

- A native `voice_call` message/bubble is created or upserted with stable `source_id=voice_call:<bridge_call_ref>`.
- The bubble must show direction `inbound|outbound`, mode `ai|operator|app|reject`, current user-facing status, duration, caller/customer/operator/app labels when available, and final end reason.
- Recording playback appears only after `recording_ready` and account authorization/signed URL are available.
- If recording is degraded, the UI must not present it as a complete stereo recording; expose incomplete/unavailable state.
- Transcript appears after `transcript_finalized` or as incremental transcript deltas where the UI supports live display.
- Duplicate events/finalize must update the same call/message idempotently, never create duplicate bubbles.

## Event and status contract

Bridge/routing lifecycle endpoint:

```http
POST /internal/voice/inbound/event
```

Current AI runtime adapter endpoint:

```http
POST /internal/voice/ai/event
```

Current finalize endpoint:

```http
POST /internal/voice/ai/finalize
```

Target generic runtime endpoints:

```http
POST /internal/voice/runtime/event
POST /internal/voice/runtime/transcript
POST /internal/voice/runtime/finalize
```

Generic endpoint payloads must include `mode=ai|operator|app`, `bridge_call_ref`, `runtime_call_ref` when present, `event_id`, and `event_seq`. During transition, generic endpoints may be implemented as adapters/aliases over the current AI-specific endpoints; until generic endpoints are enabled, runtimes use the current `/internal/voice/ai/*` endpoints with explicit `routing_mode`/`mode` metadata.

Important event status mappings in Rails:

- `session_started`, `decision_received`, `operator_ringing`, `call_started`, `app_received_call` -> `ringing`
- `app_answered`, `stream_started`, `media_stream_started`, `ai_answered`, `operator_answered`, `transfer_answered` -> `in_progress`
- `operator_no_answer`, `operator_timeout`, `timeout` -> `no_answer`
- `operator_failed`, `session_failed`, `transfer_failed`, `provider_error`, `media_stream_closed`, `media_stream_not_established`, `media_stream_framing_error` -> `failed`
- `caller_hangup` -> `cancelled`
- `session_completed`, `transfer_completed`, `call_ended`, `completed` -> `completed`
- `recording_ready`, `transfer_requested`, `transfer_result`, transcript/tool/progress events do not directly change status.

Finalize allowed statuses:

- `completed` -> call status `completed`
- `transferred` -> call status `completed`
- `failed` -> call status `failed`
- `caller_hung_up` -> call status `cancelled`
- `operator_unavailable` -> call status `no_answer`
- `rejected` -> call status `rejected`
- `cancelled` -> call status `cancelled`
- `timeout` -> call status `no_answer`

Only the statuses above are terminal runtime statuses. Media/provider details such as `media_failed`, `provider_failed`, `media_stream_not_established`, `provider_stream_closed`, and `start_stream_response_timeout` are `reason`, `error.code`, `error.scope`, or event types, not final statuses.

Finalize payload minimum:

```json
{
  "event_id": "finalize:call-ref:session_completed",
  "event_seq": 99,
  "call_ref": "call-ref",
  "provider_call_id": "fonoster-call-ref",
  "bridge_call_ref": "original-call-ref",
  "ai_runtime_call_ref": "runtime-call-ref",
  "ai_session_id": "ai_uuid",
  "conversation_id": 123,
  "status": "completed",
  "reason": "session_completed",
  "started_at": "2026-05-16T00:00:00Z",
  "ended_at": "2026-05-16T00:03:00Z",
  "duration_ms": 180000,
  "recording_ref": "voice-recordings/1/call-ref/recording.wav",
  "transcript_ref": "ai_voice_transcript:call-ref",
  "summary": "Short call summary"
}
```

Idempotency:

- First finalize stores `metadata.ai_voice.finalize` or the equivalent runtime finalize metadata.
- Duplicate same finalize returns success with `already_finalized=true`.
- Conflicting duplicate finalize is stored in `metadata.ai_voice.finalize_conflicts` or equivalent runtime conflict metadata and must not rewrite the original final state.
- A conflicting finalize should not be retried by the runtime. The preferred response is HTTP `200` with a conflict marker, for example:

```json
{
  "ok": true,
  "already_finalized": true,
  "conflict": true
}
```

HTTP `409` may be used only if the runtime treats it as terminal/non-retryable.

## Recording contract

Current implemented writer: `services/onelink-ai-voice/src/recordings/recording-writer.js`.

Current recording shape:

- WAV container.
- 8000 Hz default sample rate.
- Stereo PCM16.
- Inbound/caller written to one channel.
- Outbound/AI/operator/app written to the other channel.
- Storage key: `voice-recordings/<account_id>/<call_ref>/recording.wav`.
- `recording_ready` event contains:
  - `recording_ref`
  - `storage_key`
  - `byte_size`
  - `content_type`
  - `sha256`
  - `duration_ms`
  - `wall_duration_ms`
  - `writer`
  - `storage_provider`
  - `sample_rate`
  - `channels`
  - `bits_per_sample`
  - `inbound_bytes`
  - `outbound_bytes`

Contract rules:

- Recording is OneLink-owned, not Fonoster-owned.
- Fonoster may provide technical stream transport, but permanent recording storage and access policy stay in OneLink.
- For `ai`, runtime writes caller input and Gemini output.
- For `operator`, runtime writes caller and operator leg audio.
- For `app`, runtime writes caller and app/remote audio.
- If either direction is missing, OneLink must not present the recording as complete stereo recording.
- Missing caller/customer audio maps to `missing_direction=caller`.
- Missing operator/app/assistant/remote audio maps to `missing_direction=remote`.
- If the missing side cannot be determined, use `missing_direction=unknown`.
- Degraded recording metadata uses `recording_status=incomplete|unavailable`, `degraded=true`, and `missing_direction=caller|remote|unknown`.
- `recording_ready` may arrive after finalize; Rails must accept late recording metadata.

## Fallback contract

### Route lookup failure

Runtime behavior:

- If `/internal/voice/inbound/route` fails before a decision, runtime returns/uses `action=reject`, `reason=route_lookup_failed`.
- Telephony execution should not continue into an unscoped AI/operator/app route.

### AI app missing or recursive

Rails behavior:

- If AI app ref missing -> fallback with reason `ai_app_ref_missing`.
- If AI app ref equals current runtime app ref -> fallback/reject with reason `recursive_runtime_app_ref`.
- Fallback order follows `routing_policy.fallback_mode`.

### App ref missing or recursive

Rails behavior:

- If app ref missing -> fallback with reason `app_ref_missing`.
- If app ref equals current runtime app ref -> fallback/reject with reason `recursive_runtime_app_ref`.

### Operator unavailable

Rails behavior:

- If no enabled, registered, non-busy SIP operator candidates -> reject or fallback depending policy.

Runtime behavior:

- If all operator dial attempts fail/no-answer/timeout -> emit `operator_no_answer`/`operator_failed` and use fallback app/AI only when the route decision includes fallback app ref/mode.
- Otherwise reject/hangup and persist terminal event.

### Gemini unavailable / context unavailable

Runtime behavior:

- Context fetch failure -> fallback context and `session_failed` with reason `context_unavailable`.
- Gemini connection failure -> `realtime_unavailable`, `session_failed`, local scripted fallback if configured.
- If media stream was never established, finalize `failed` with reason `media_stream_not_established`.

### StartStream/media failure

Runtime behavior:

- `StartStream.run()` timeout -> emit `start_stream_response_timeout`, then `media_stream_not_established`; finalize with `status=failed`, `reason=media_stream_not_established`, and `error.code=start_stream_response_timeout`.
- `StartStreamResponse` with a usable `stream_ref` is required before `media_stream_started`.
- The runtime must not write `AUDIO_OUT` until `stream_ref` is known.
- Bad output frames -> emit `media_stream_framing_error` and finalize failed.
- Provider stream close/error -> emit `provider_stream_closed`/`provider_error`; completion maps to failed unless already transferred/completed.

Bridge/Fonoster first-media accounting:

- Bridge/apiserver must account first stream payloads at streamPayload level, not only through high-level call status.
- Terminal events should carry, when available: `start_stream_response_at`, `first_audio_in_at`, `first_audio_out_at`, `first_audio_in_bytes`, `first_audio_out_bytes`, `audio_in_bytes_total`, `audio_out_bytes_total`, `saw_audio_in`, `saw_audio_out`, `media_session_ref`, and `stream_ref`.
- Any valid `AUDIO_OUT` stream payload with bytes observed by Fonoster counts as media observed, including silence/zero PCM frames.
- If `saw_audio_out=true` and (`first_audio_out_bytes > 0` or `audio_out_bytes_total > 0`), bridge/Fonoster must not classify the call as `media_stream_closed_before_audio`.
- If Fonoster needs a stricter caller-audibility signal, it must be a separate state/reason from `media_stream_closed_before_audio`; do not reuse “before audio” when audio payloads were observed.
- If `media_established=false` while `saw_audio_out=true` and outbound byte totals are non-zero, this is a bridge media-established/first-media guard bug or race, not proof that OneLink failed to write `AUDIO_OUT`.

Rails/runtime reconciliation after terminal media failure:

- A terminal bridge event with `status=failed` or `end_reason=media_stream_closed_before_audio` is authoritative for the call session unless a later valid terminal success event with the same correlation ids explicitly supersedes it.
- Late runtime events such as `realtime_audio_out`, `media_writer_started`, or transcript updates must not turn a terminal failed call into `completed` in the Chatwoot voice bubble.
- Runtime child sessions created for app/AI handoff must be finalized or reconciled after the parent bridge terminal event; they must not remain indefinitely `ringing` or keep the sidecar `/health` session count non-zero.

## Audio format contract

Call-facing media uses:

- PCM16 little-endian.
- 8000 Hz sample rate.
- 20 ms frames recommended.
- `AUDIO_IN` is caller/customer audio into the selected OneLink runtime.
- `AUDIO_OUT` is AI/operator/app/remote audio out of the selected OneLink runtime toward the call.
- Provider audio with another sample rate, including Gemini 24 kHz output, must be resampled/paced by the runtime before writing call-facing `AUDIO_OUT`.

## Production readiness checklist by mode

AI inbound:

- Fonoster number route returns `action=ai` with real OneLink AI app ref.
- Fonoster EXTERNAL app endpoint reaches the direct OneLink AI Runtime executor privately.
- The production AI happy path has no intermediate local voice-runtime -> `app:f2498...` child handoff.
- AI prewarm starts immediately after route decision / inbound session creation.
- `stream_started` is emitted only after `StartStreamResponse` with usable `stream_ref`.
- First valid `AUDIO_OUT` observed by Fonoster/bridge occurs within `<= 0.7s` after `answer` + `StartStreamResponse`/`stream_ref` in the happy path.
- Runtime receives `AUDIO_IN` and writes `AUDIO_OUT`.
- Caller hears Gemini.
- Rails sees `media_stream_started`, `ai_answered`, transcript events, finalize.
- Recording has both inbound and outbound bytes.

AI outbound:

- Rails outbound command includes AI app ref and account/conversation metadata.
- Runtime context resolves without ambiguity.
- Finalize and recording attach to the correct conversation.

Operator inbound:

- Rails returns non-empty `operator_candidates` or `agent_aor`.
- Runtime dials candidate(s), first answer wins.
- Rails gets `operator_ringing`, `operator_answered` or `operator_no_answer`.
- Recording remains OneLink-owned and contains both caller/operator directions.

Operator outbound:

- If recordable, bridge command uses operator-capable OneLink runtime path, not direct provider-only bridge.
- Operator/customer lifecycle is reconciled into one `Telephony::CallSession`.
- Recording and terminal status attach to the right conversation/contact.

App inbound:

- Rails returns non-recursive target `app_ref`.
- Runtime app handoff succeeds or emits `app_handoff_failed`.
- Recording remains active while app/remote audio is present.

App outbound:

- Bridge command includes app ref and account/conversation metadata.
- If recordable, selected app path keeps OneLink runtime in the media path.
- Late recording/finalize events reconcile to the original call session.

Cross-mode:

- Duplicate `/event` retries are idempotent.
- Duplicate `/finalize` retries are idempotent.
- Conflicting finalize does not overwrite the first terminal state.
- Caller hangup is distinguished from operator/app/provider failure.
- `bridge_call_ref` is preserved across runtime/app handoffs.
- Recursive runtime app refs are rejected/fallback without loops for `ai`, `app`, fallback chains, and transfer-to-app.
- Recording missing one direction is marked degraded/incomplete with `missing_direction`.
- StartStream timeout and stream-close-before-first-audio paths finalize cleanly with no leaked runtime session.
- Operator busy/rejected/timeout outcomes map to `operator_unavailable` or explicit fallback.
- No production route points to local historical `test-voiceapp`.
- No production AI SLA path uses local voice-runtime -> `app:f2498...` child handoff; that path is transition/debug only.
- No Gemini/CRM/storage secrets exist on Fonoster.

Smoke-test order after implementation changes:

1. AI inbound happy path.
2. StartStream timeout and stream closes before first audio.
3. Duplicate finalize and conflicting finalize.
4. Operator inbound answered.
5. Operator no-answer/busy/rejected/timeout.
6. Recording missing one direction.
7. App inbound.
8. Outbound AI/operator/app.

## Known implementation notes / gaps

- `onelink-ai-voice` currently contains AI, operator-route, app-route, transfer, media streaming, and recording logic in one service. Architecturally, operator and app modes may later become separate runtime services, but the media/recording contract remains the same.
- Current local voice-runtime -> `app:f2498...` AI child handoff is a transition/debug compatibility path, not the approved production happy path and not the SLA path.
- Current operator/app route handling uses passive recording plus `call.dial`, `call.transfer`, or `call.transferToApp` where the Fonoster SDK exposes these methods.
- Full operator/app stereo recording is only possible if Fonoster media topology exposes both directions to the OneLink runtime.
- `/root/crafty/example/test-voiceapp/index.js` is historical reference for SDK internals (`StartStream`, `StopStream`, `Stream`, `AUDIO_OUT`, transfer tool flow), not production source of truth.
- Current Rails `Telephony::InboundRoutingService` returns `app_ref` for `ai` and `app`; mode semantics come from `action` plus `ai_mode` where applicable.
- Current Rails `Telephony::AiVoice::ContextBuilder` is AI-focused; operator/app contexts should not depend on Gemini fields unless the shared runtime is deliberately reusing the AI service path.

## Final rule

For every `operator`, `ai`, and `app` call in both inbound and outbound directions:

```text
Fonoster executes telecom.
OneLink runtime owns recordable media path.
Rails owns business truth and JSON state.
No recordable production call may bypass OneLink runtime media visibility.
```
