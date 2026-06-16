# Fonoster Onelink Voice Execution Contract

Audience: Fonoster/calls, Onelink Rails, Onelink VoiceAI, and Onelink operator/app voice runtime teams.

Last updated: 2026-05-17.

This document defines the Fonoster-side telecom execution contract for all Onelink voice calls that pass through Fonoster. It is written so Onelink + VoiceAI can implement and debug against the Fonoster/calls behavior without reading Fonoster-side code.

Counterpart source-of-truth document:

- `ONELINK_VOICE_RUNTIME_MATRIX_CONTRACT.md` - Onelink/Rails/runtime matrix contract.

The three supported call modes are:

- `ai`
- `operator`
- `app`

Each mode must work in both initiation directions:

- `inbound`: PSTN/SIP caller initiates the call into Fonoster.
- `outbound`: Onelink initiates a call through the Fonoster bridge/API.

## Core Decision

Fonoster owns telecom execution. Onelink owns business state and voice runtime behavior.

```text
Fonoster side
  Owns PSTN/SIP ingress/egress, trunks, numbers, domains, app refs,
  call creation, app handoff, media stream transport, dial/bridge/hangup,
  technical call events, recording passthrough metadata when available.

Onelink Rails
  Owns CRM truth, routing policy, contacts, conversations, permissions,
  AI prompts/context/tools, operator selection, app-flow selection,
  transcript storage, final business state, summaries, recording metadata.

Onelink voice runtimes
  Own Fonoster VoiceServer endpoints, media lifecycle after app answer,
  AI/provider sessions, operator/app call-control behavior when selected,
  local recording writers, transcript buffering, tool execution via Rails,
  finalization delivery, and exact diagnostic events.
```

Rails must not receive realtime audio frames. Rails receives JSON events, transcript deltas, finalize payloads, tool requests, and recording metadata.

## Auth Boundary

Fonoster/bridge callbacks to Rails:

```http
X-Bridge-Secret: <shared secret>
X-Telephony-Secret: <shared secret>
Authorization: Bearer <bridge token>
```

Onelink voice runtimes to Rails:

```http
Authorization: Bearer <internal voice token>
```

Runtime event endpoints may also include `X-Request-Id`, `X-Event-Id`, `X-Idempotency-Key`, and `X-Event-Attempt` for tracing and idempotency.

## Required Production Topology

Fonoster should route each mode to a real Onelink-owned external voice app when that mode requires Onelink-owned media, transcript, recording, or finalization.

```text
ai mode
  Fonoster -> direct onelink-ai-voice production app endpoint

operator mode
  Fonoster -> onelink-operator-voice
  or a shared Onelink voice runtime running mode=operator

app mode
  Fonoster -> onelink-app-voice
  or a shared Onelink voice runtime running mode=app
```

The three runtimes can be one deployable service at first. The contract still treats them as separate responsibilities.

Target AI architecture:

```text
PSTN/SIP
  -> Fonoster
  -> route decision
  -> direct Onelink AI app endpoint
  -> AI runtime prewarm
  -> answer
  -> StartStreamResponse with stream_ref
  -> first valid AUDIO_OUT observed by Fonoster/bridge
```

For `ai` production calls, the selected Onelink AI Runtime app ref is the direct executor. The transitional local Fonoster voice-runtime to `app:<onelink-ai-voice-app-ref>` child handoff path is allowed only for debugging or migration compatibility. It is not the production happy path and is outside the AI first-response SLA.

AI latency SLA:

```text
start point:
  call answered
  StartStreamResponse received
  stream_ref exists

end point:
  first valid AUDIO_OUT media payload observed by Fonoster/bridge

target:
  <= 700 ms in the happy path
```

The first `AUDIO_OUT` may be greeting audio, keepalive audio, or silence PCM. It must be a real media payload observed on the Fonoster/bridge media path, not only an internal runtime event.

## Fonoster Execution Matrix

This section describes the telecom execution surface that Fonoster/calls exposes to Onelink for all supported mode and direction combinations.

| Direction | Mode | Fonoster execution | Required target | Runtime media ownership |
| --- | --- | --- | --- | --- |
| inbound | ai | Receive PSTN/SIP call, create bridge call ref, ask Rails for route, connect directly to selected Onelink AI app ref | `onelink-ai-voice` production app ref | Required |
| inbound | operator | Receive PSTN/SIP call, create bridge call ref, ask Rails for route, hand off to operator-capable runtime or execute explicit degraded direct bridge | `onelink-operator-voice` app ref for recordable calls, `agent_aor` for degraded direct bridge | Required for recordable calls |
| inbound | app | Receive PSTN/SIP call, create bridge call ref, ask Rails for route, hand off to app-capable runtime | `onelink-app-voice` app ref or shared runtime app ref | Required when recording/media/app recognition is enabled |
| outbound | ai | Accept outbound command, create PSTN/SIP call, connect answered party directly to selected AI app ref | `onelink-ai-voice` production app ref | Required |
| outbound | operator | Accept outbound command, create PSTN/SIP/operator/customer legs according to strategy | `onelink-operator-voice` app ref for recordable calls, `agent_aor` for degraded direct bridge | Required for recordable calls |
| outbound | app | Accept outbound command, create PSTN/SIP call, connect answered party to selected app runtime | `onelink-app-voice` app ref or shared runtime app ref | Required when recording/media/app recognition is enabled |

Fonoster call-control semantics:

```text
answer
  Answers the current app/runtime leg only.
  It does not prove media stream establishment.

app handoff
  Connects the bridge/original call to the selected external runtime app_ref.
  It may create a runtime_call_ref that must be correlated to bridge_call_ref.

dial
  Creates an operator/agent leg to a concrete agent_aor returned by Rails.
  Fonoster executes the target; Rails owns target selection.

transferToApp / transfer app_ref
  Moves the call to the exact app_ref returned by Rails or requested by the runtime.
  Recursive app_ref values must be rejected before execution.

hangup
  Ends the affected technical leg.
  Any parent, runtime, stream, or operator terminal close must be surfaced so the selected runtime can finalize the shared session once.
```

Fonoster must not be given:

- Gemini/OpenAI provider keys
- Rails database credentials
- prompts
- CRM tool implementation
- recording storage credentials

Onelink voice runtimes must not assume:

- Fonoster will store transcript text
- Fonoster will run provider sessions
- Fonoster will decide business routing beyond technical fallback
- Rails will handle audio frames

Transfer is not a fourth top-level mode. It is a lifecycle inside an existing `ai`, `operator`, or `app` session. For example, an AI-to-operator transfer starts in mode `ai`, emits transfer events, and finalizes as `transferred`, `operator_unavailable`, or `failed`.

## Current Known App Refs

These refs are environment-specific examples, not universal constants:

```text
runtime/router app ref
  96fc259c-6bcd-4cbf-bb7d-d2c51f248934

onelink AI voice app ref
  f2498e07-2bb5-45a1-8c8c-6fecdb4c791a
```

Important rule:

`action=ai` or `action=app` must return a real target app ref for the selected Onelink runtime. It must not return the runtime/router app ref as the target for the same inbound call. Returning the router app ref causes recursive routing or detached lifecycle bugs.

AI production rule:

For `action=ai`, the production route must target the direct Onelink AI Runtime app ref, currently represented in this environment by `f2498e07-2bb5-45a1-8c8c-6fecdb4c791a`. The local runtime/router app ref must not sit in the production AI happy path and then perform a second `app:f2498...` child handoff. That topology is transition/debug only.

Fonoster-side implementation direction:

1. Route AI calls to the selected Onelink AI Runtime app ref directly after Rails returns `action=ai`.
2. Do not answer the caller in an intermediate local runtime just to route again to `app:f2498...`.
3. Use the caller's ringing/pre-answer window for the selected AI runtime to prepare context/provider state when supported by the runtime.
4. Let the direct AI runtime decide the final answer moment so it can immediately start stream setup and send a greeting or keepalive media payload.
5. Keep all terminal delivery, media accounting, stream refs, and parent/runtime correlation on the Fonoster side stable and idempotent.
6. Treat `answer` and `StartStreamResponse` as setup milestones only. AI media success starts when Fonoster/bridge observes valid `AUDIO_OUT`.
7. If the transition/debug child handoff path is used, all logs and events must identify it as non-production topology so its latency is not compared to the production SLA.

## Identifiers And Correlation

Every event must include enough ids to join Fonoster, Rails, and the selected voice runtime into one call session.

### Canonical Ids

```text
call_ref
  Preferred canonical external call id for the user-visible call session.
  In new payloads this should equal bridge_call_ref.
  During migration, a legacy runtime may still place its local runtime ref here;
  in that case bridge_call_ref is the authoritative join key.

bridge_call_ref
  Canonical Onelink Matrix name for the original/parent Fonoster call ref.
  This is the stable join key for Rails call session persistence whenever present.

runtime_call_ref
  Canonical Onelink Matrix name for the selected runtime/app-handoff call ref
  when Fonoster creates a child technical leg.

ai_runtime_call_ref
  AI-specific alias for runtime_call_ref when mode=ai.

parent_call_ref
  Transitional Fonoster/debug alias for bridge_call_ref.
  Keep sending it during migration because existing logs and tools use it.

child_call_ref
  Transitional Fonoster/debug alias for runtime_call_ref.
  This is useful for debugging but must not become the primary CRM key.

provider_call_id
  Compatibility alias for the Fonoster/provider call reference.
  For new events it should equal bridge_call_ref unless Fonoster exposes
  an additional lower-level provider id.

account_id
  Onelink account id.

inbox_id
  Onelink inbox/channel id.

number_ref
  Onelink/Fonoster number binding ref.
  In Rails routing, number_ref wins over ingress_number when both are present.

contact_id
  Onelink contact id.

conversation_display_id
  Optional human-visible conversation id.

media_session_ref
  Fonoster media/channel session ref.
  Required for media debugging and recording association.

stream_ref
  Fonoster StartStream response ref.
  Required after media stream starts.

call_id
  Optional Onelink internal call/session id.

conversation_id
  Optional Onelink conversation id.

ai_session_id
  Onelink AI runtime session id for mode=ai.

voice_session_id
  Onelink runtime session id for any mode.
  Use this for operator/app modes if ai_session_id is not applicable.

event_id
  Stable idempotency id for one event.

event_seq
  Monotonic integer inside one voice_session_id.

request_id
  Per HTTP request/delivery attempt trace id.
```

Boundary naming rule:

```text
canonical JSON fields:
  call_ref
  bridge_call_ref
  runtime_call_ref
  ai_runtime_call_ref, for AI calls
  media_session_ref
  stream_ref

accepted transitional aliases:
  parent_call_ref -> bridge_call_ref
  child_call_ref -> runtime_call_ref
  mediaSessionRef -> media_session_ref
  streamRef -> stream_ref
  appRef -> app_ref
```

### Correlation Rules

1. New payloads should set `call_ref=bridge_call_ref` for the original/canonical user-visible call.
2. If `call_ref` and `bridge_call_ref` differ, Rails and diagnostics must join by `bridge_call_ref`.
3. A runtime-only `call_ref` without `bridge_call_ref` is legacy/degraded and must be diagnosed as missing canonical correlation.
4. Child/app-handoff refs must be sent as `runtime_call_ref`; during migration also send `child_call_ref`.
5. `media_session_ref` must be sent on all media, transcript, recording, and finalize events when known.
6. `stream_ref` must be sent on all media-stream events after StartStream succeeds.
7. Rails must not merge user-visible call sessions by `runtime_call_ref`.
8. The voice runtime must keep a bridge-runtime ref map for the lifetime of the call.
9. A terminal event for either bridge or runtime leg must close the shared runtime session.
10. No active session may remain after finalize.

### Example Correlation Envelope

```json
{
  "event_id": "evt_01JZ_CORRELATION",
  "event_seq": 1,
  "event_type": "call_linked",
  "mode": "ai",
  "direction": "inbound",
  "call_ref": "a4985766-4b39-4d7f-8bd3-c7939b930ce0",
  "bridge_call_ref": "a4985766-4b39-4d7f-8bd3-c7939b930ce0",
  "runtime_call_ref": "e1c511cf-d28c-4171-8d5a-3f2969daab46",
  "ai_runtime_call_ref": "e1c511cf-d28c-4171-8d5a-3f2969daab46",
  "parent_call_ref": "a4985766-4b39-4d7f-8bd3-c7939b930ce0",
  "child_call_ref": "e1c511cf-d28c-4171-8d5a-3f2969daab46",
  "provider_call_id": "a4985766-4b39-4d7f-8bd3-c7939b930ce0",
  "media_session_ref": "1778942868.42",
  "account_id": "530",
  "inbox_id": "inbox_123",
  "number_ref": "num_123",
  "voice_session_id": "voice_sess_01JZ",
  "ai_session_id": "ai_sess_01JZ",
  "conversation_id": "conv_123",
  "occurred_at": "2026-05-16T14:47:50.000Z",
  "source": "onelink-ai-voice"
}
```

## Common State Model

A call has three related state machines:

- telephony state
- media state
- business/final state

Do not collapse these into one boolean like `answered`. An app leg can answer while media is still absent or already broken.

### Telephony States

```text
new
route_requested
route_resolved
caller_answered
target_ringing
target_answered
active
transfer_requested
transfer_ringing
transfer_answered
ending
ended
```

### Media States

```text
none
stream_starting
stream_started
first_audio_in
provider_starting
provider_ready
first_audio_out
media_active
media_closing
media_closed
media_failed
```

### Business Terminal States

```text
completed
transferred
operator_unavailable
caller_hung_up
cancelled
rejected
failed
timeout
```

Media and provider failures are expressed as `status=failed` with specific `reason`, `error.scope`, and `error.code` values such as `media_stream_closed_before_first_audio` or `provider_stream_closed`. Rails may display or aggregate these as media/provider categories, but the canonical finalize status remains `failed`.

## Normalized Action And State Mapping

Fonoster provider/bridge events may be more detailed than the Onelink normalized action/state layer. The normalized layer is sufficient for Rails/UI/audit as long as Fonoster includes provider-specific detail in event payload metadata when needed.

Provider-side events map as follows:

```text
provider inbound received
  -> inbound_received

outbound create accepted
  -> outbound_created

bridge/app/runtime leg creation or join
  -> runtime_connecting, runtime_answered, app_handoff_started, app_handoff_completed,
     operator_dial_started, operator_answered, or transfer_answered depending on mode

provider answered/customer answered
  -> call_answered

provider bridge/leg failed
  -> session_failed or the mode-specific failure action
  -> preserve raw provider event in payload.provider_event_type/provider_status

provider hangup
  -> provider_hangup
  -> ended_by=provider unless a more specific actor is known
```

Fonoster does not require extra canonical actions such as `provider_answered`, `bridge_created`, `bridge_joined`, `leg_created`, `leg_joined`, or `leg_failed` in the Onelink normalized layer. These can remain provider detail fields in payload metadata.

Required normalized dimensions are accepted:

```text
call_status
route_status
bridge_status
runtime_status
media_status
recording_status
transcript_status
operator_status
app_status
finalize_status
```

`ended_by=caller|operator|ai|app|runtime|provider|system|unknown` is sufficient if `caller` is defined as the customer/PSTN party for both inbound and outbound calls.

Outbound operator strategies are accepted:

```text
operator_first
customer_first
operator_strategy
```

Fonoster does not require additional user-visible `call_status` values beyond the Matrix list. Provider-specific distinctions should be represented as `reason`, `error.code`, `error.scope`, and raw provider metadata.

### Required Success Definition

For `ai` and media-owning `app` mode, `target_answered` is not success.

Minimum success requires:

```text
target_answered
stream_started
at least one of:
  first_audio_in
  provider_ready
  first_audio_out
```

For AI voice quality success, require all of:

```text
stream_started
first_audio_in
provider_ready
first_audio_out
finalize delivered
```

For operator success, require:

```text
operator_answered
media bridge active, if Onelink owns media/recording
finalize delivered
```

## Mode Overview

### ai Mode

Purpose:

- Connect caller to realtime AI, currently Gemini Live.
- Onelink AI voice runtime owns media loop, provider session, transcript, tools, recording, and finalize.
- In production, the selected Onelink AI voice runtime is the direct executing Fonoster app endpoint.

Required behavior:

1. Receive the inbound session and route/context identifiers directly from Fonoster/Rails.
2. Prewarm AI context, provider connection, and tool catalog before answer whenever possible.
3. Answer only when the runtime can immediately start media and send greeting or keepalive audio.
4. Start Fonoster bidirectional stream with `direction=BOTH`, `format=WAV`.
5. Emit `media_stream_started` only after StartStream response with `stream_ref`.
6. Send first valid `AUDIO_OUT` within the SLA window after answer and StartStreamResponse.
7. Forward caller `AUDIO_IN` to provider without blocking the media callback on Rails/tools/storage.
8. Forward provider audio to caller as paced `AUDIO_OUT`.
9. Send first greeting without waiting for FAQ/tools; run FAQ/tools after the first phrase asynchronously or in parallel.
10. Emit transcript deltas and final transcript.
11. Execute tool calls only through Rails.
12. Record call if recording is enabled.
13. Finalize exactly once.
14. Close provider, stream, recorder, timers, and session state on terminal.

### operator Mode

Purpose:

- Connect caller to a human operator.
- Onelink Rails decides the operator target.
- If Onelink-owned recording/control is required, an Onelink operator runtime must stay in the call path.

Required behavior:

1. Answer or hold the caller according to Onelink route policy.
2. Request/receive operator target from Rails.
3. Dial the operator target through Fonoster SDK using `call.dial` when available, or an agreed transfer fallback.
4. Emit ringing, answered, busy, no-answer, failed, and hangup events.
5. Bridge caller and operator audio.
6. Record both sides if recording is enabled.
7. Finalize one shared call session.

Operator mode may be implemented in two topologies:

```text
preferred for production recording/control:
  caller -> Fonoster -> onelink-operator-voice -> operator

limited direct bridge:
  caller -> Fonoster -> operator
```

If the direct bridge is used, Onelink cannot own native recording or low-level media diagnostics for that call. The event contract still applies, but media events will be limited.

For recordable operator calls, direct bridge is a degraded/non-production topology unless explicitly accepted by Onelink for that call. The selected Onelink runtime must see both directions:

```text
AUDIO_IN   caller/customer -> runtime
AUDIO_OUT  operator/app/assistant -> caller/customer
```

If only one direction is visible, the runtime must mark recording incomplete and emit diagnostics; it must not present the artifact as complete stereo recording.

Operator result mapping:

```text
operator_no_answer
operator_busy
operator_rejected
operator_timeout
  -> finalize status=operator_unavailable
  -> or execute fallback when fallback is explicitly present in route decision

operator_dial_failed
  -> finalize status=failed
  -> or execute fallback when fallback is explicitly present in route decision

operator_hangup after operator_answered
  -> normal terminal event for the operator leg
  -> not a provider failure
  -> final call status is transferred or completed depending on topology
```

### app Mode

Purpose:

- Run a non-AI Onelink voice app flow.
- Examples: IVR, appointment workflow, verification, survey, scripted assistant, queue logic.

Required behavior:

1. Answer Fonoster app leg.
2. Correlate parent and child call refs.
3. Fetch app context/flow config from Rails.
4. Start stream if the app needs caller media, playback, recording, or realtime recognition.
5. Emit app step events.
6. Emit transcript/events if speech recognition is used.
7. Finalize one shared call session.

App mode must not be treated as a fallback bucket for AI. It is a real mode with its own app flow id, state, recording, and terminal status.

When app mode hands off to another Fonoster app, use this SDK fallback order:

```text
preferred:
  call.transferToApp({ app_ref })

fallback:
  call.transfer({ app_ref })

legacy fallback:
  call.transfer({ appRef })
```

The target app ref must be the exact app ref returned by Rails and must not equal the current router/runtime app ref.

App handoff correlation ownership:

1. Fonoster/calls must preserve the original bridge ref during app handoff and pass it to runtime/app-leg metadata and events.
2. Onelink runtime must propagate `bridge_call_ref` in all events and finalize payloads.
3. Rails joins by `bridge_call_ref`.
4. The new app/runtime ref is written as `runtime_call_ref`.

For recordable app calls, Onelink runtime media visibility must remain active through the app flow or the call must be marked as explicitly degraded.

## Inbound Direction

Inbound means PSTN/SIP caller starts the call.

### Common Inbound Sequence

```text
1. PSTN/SIP caller reaches Fonoster number.
2. Fonoster creates parent call_ref.
3. Fonoster runtime asks Onelink Rails for route.
4. Rails returns action=ai/operator/app/reject.
5. Fonoster executes the selected action.
6. Selected Onelink runtime emits lifecycle/media/finalize events.
7. Rails stores one call session keyed by parent call_ref.
```

### Inbound Route Request

Endpoint:

```http
POST /internal/voice/inbound/route
```

Request:

```json
{
  "event_id": "evt_route_01JZ",
  "event_type": "inbound_route_requested",
  "call_ref": "parent-fonoster-call-ref",
  "provider_call_id": "parent-fonoster-call-ref",
  "media_session_ref": "1778942868.42",
  "direction": "inbound",
  "from": "+77066318623",
  "to": "+18623964686",
  "caller_number": "+77066318623",
  "ingress_number": "+18623964686",
  "number_ref": "num_123",
  "app_ref": "runtime-router-app-ref",
  "started_at": "2026-05-16T14:47:48.772Z",
  "metadata": {
    "twilio_call_sid": "CA...",
    "sip_call_id": "..."
  }
}
```

### Route Response For ai

```json
{
  "action": "ai",
  "mode": "ai",
  "call_id": "call_123",
  "account_id": "530",
  "inbox_id": "inbox_123",
  "number_ref": "num_123",
  "conversation_id": "conv_123",
  "conversation_display_id": "42",
  "contact_id": "contact_123",
  "app_ref": "f2498e07-2bb5-45a1-8c8c-6fecdb4c791a",
  "ai_mode": "onelink_managed",
  "reason": "pending_conversation_ai_route",
  "recording": {
    "enabled": true,
    "source": "onelink_runtime",
    "storage_provider": "onelink_storage"
  },
  "timeout": 60,
  "fallback": {
    "on_target_unavailable": "operator",
    "operator_agent_aor": "sip:1001@operator.cloud.vconsult.kz"
  }
}
```

### Route Response For operator

```json
{
  "action": "operator",
  "mode": "operator",
  "call_id": "call_123",
  "account_id": "530",
  "inbox_id": "inbox_123",
  "number_ref": "num_123",
  "conversation_id": "conv_123",
  "contact_id": "contact_123",
  "app_ref": "fonoster-app-ref-for-onelink-operator-voice",
  "agent_aor": "sip:1001@operator.cloud.vconsult.kz",
  "agent_ref": "agent_1001",
  "agent_aors": ["sip:1001@operator.cloud.vconsult.kz"],
  "operator_pool_size": 1,
  "recording": {
    "enabled": true,
    "source": "onelink_runtime",
    "storage_provider": "onelink_storage"
  },
  "reason": "operator_route",
  "timeout": 30
}
```

If using limited direct bridge, `app_ref` can be omitted and `agent_aor` is required. If Onelink-owned recording/control is required, `app_ref` is required.

### Route Response For app

```json
{
  "action": "app",
  "mode": "app",
  "call_id": "call_123",
  "account_id": "530",
  "inbox_id": "inbox_123",
  "number_ref": "num_123",
  "conversation_id": "conv_123",
  "contact_id": "contact_123",
  "app_ref": "fonoster-app-ref-for-onelink-app-voice",
  "app_flow_id": "flow_appointment_booking",
  "recording": {
    "enabled": true,
    "source": "onelink_runtime",
    "storage_provider": "onelink_storage"
  },
  "reason": "app_flow_route",
  "timeout": 60
}
```

### Route Response For reject

```json
{
  "action": "reject",
  "mode": "reject",
  "call_id": "call_123",
  "conversation_id": "conv_123",
  "reason": "business_hours_closed",
  "message": "We are currently closed."
}
```

Business rejection must return HTTP 200 with `action=reject`. Non-2xx means technical failure and may trigger technical fallback.

Routing rules:

1. If both `number_ref` and `ingress_number` are present, Rails routing policy uses `number_ref` as the stronger binding.
2. `action=ai` must return the direct Onelink AI Runtime production app ref, not the local runtime/router app ref.
3. Recursive app refs must be rejected or converted to explicit technical fallback; do not attempt the handoff and then let the runtime detach.
4. `ai_mode=onelink_managed` means the selected Onelink runtime owns provider session, media loop, transcript, recording, and finalization.
5. `ai_mode=fonoster_managed`, if ever used, must be negotiated separately because it changes ownership boundaries.
6. Recursive app-ref detection applies to `ai`, `app`, fallback chains, and any transfer-to-app flow.
7. The canonical recursive reason is `recursive_runtime_app_ref`.
8. `action=app` must return a target app runtime `app_ref` that differs from the router/current app ref.

## Outbound Direction

Outbound means Onelink starts the call through Fonoster.

### Common Outbound Sequence

```text
1. Rails creates a call session and chooses mode.
2. Rails calls Fonoster bridge outbound API.
3. Fonoster creates the outbound PSTN/SIP call.
4. When the remote party answers, Fonoster connects the call to the selected app ref or operator target.
5. Selected Onelink runtime emits lifecycle/media/finalize events.
6. Rails stores one call session keyed by the returned parent call_ref.
```

### Outbound Request

Endpoint:

```http
POST /telephony/calls/outbound
```

Request:

```json
{
  "mode": "ai",
  "direction": "outbound",
  "to": "+77066318623",
  "from": "+18623964686",
  "account_id": "530",
  "inbox_id": "inbox_123",
  "number_ref": "num_123",
  "conversation_id": "conv_123",
  "contact_id": "contact_123",
  "call_id": "call_123",
  "app_ref": "fonoster-app-ref-for-selected-onelink-runtime",
  "recording_enabled": true,
  "metadata": {
    "onelink_account_id": "530",
    "inbox_id": "inbox_123",
    "number_ref": "num_123",
    "conversation_id": "conv_123",
    "contact_id": "contact_123",
    "routing_mode": "ai",
    "recording_enabled": true,
    "campaign_id": "camp_123",
    "initiated_by_user_id": "user_123"
  }
}
```

Response:

```json
{
  "ref": "parent-fonoster-call-ref",
  "status": "created",
  "call_ref": "parent-fonoster-call-ref",
  "provider_call_id": "parent-fonoster-call-ref"
}
```

`ref` and `status=created` match the current Onelink Matrix contract. `call_ref` and `provider_call_id` are compatibility aliases that may be returned by the bridge during migration.

### Outbound ai Mode

Use `app_ref=onelink-ai-voice`. The AI runtime owns media after the called party answers.

Required events:

```text
outbound_requested
outbound_ringing
caller_answered
media_stream_started
provider_session_started
first_audio_out or first_audio_in
finalize
```

### Outbound operator Mode

Two valid meanings exist. The request must make the chosen one explicit.

```text
operator_call_to_customer
  Operator or CRM initiates a call to customer.
  Onelink operator runtime may bridge operator and customer.

customer_to_operator_callback
  System calls customer first, then connects to operator after answer.
```

Required fields:

```json
{
  "mode": "operator",
  "app_ref": "fonoster-app-ref-for-onelink-operator-voice",
  "operator_agent_aor": "sip:1001@operator.cloud.vconsult.kz",
  "operator_strategy": "operator_call_to_customer",
  "recording_enabled": true
}
```

If `recording_enabled=true`, the outbound operator call must use the Onelink operator-capable runtime path. A direct Fonoster operator-to-customer call is valid only for non-recordable calls or an explicitly agreed degraded mode.

### Outbound app Mode

Use `app_ref=onelink-app-voice` and include `app_flow_id`.

```json
{
  "mode": "app",
  "app_ref": "fonoster-app-ref-for-onelink-app-voice",
  "app_flow_id": "flow_payment_reminder"
}
```

## Fonoster Stream Contract

This contract applies to Onelink voice runtimes when they own media.

### Start

After answering the app leg:

```text
StartStreamRequest:
  media_session_ref: required
  direction: BOTH
  format: WAV

StartStreamResponse:
  media_session_ref
  stream_ref
```

The runtime must not report `media_stream_started` until it has received `StartStreamResponse`.

StartStream failure mapping:

```text
StartStream timeout
  event_type=start_stream_response_timeout
  status=failed
  reason=media_stream_not_established

StartStream response without stream_ref
  event_type=media_stream_not_established
  status=failed
  reason=media_stream_not_established
```

`media_stream_started` must not be emitted optimistically before a real stream/session ref exists.

### Payloads

Fonoster sends caller audio to the runtime:

```json
{
  "streamPayload": {
    "mediaSessionRef": "1778942868.42",
    "streamRef": "7344bd15-83bd-4494-8216-f4483d068518",
    "format": "WAV",
    "type": "AUDIO_IN",
    "data": "<bytes>"
  }
}
```

The runtime sends audio to the caller:

```json
{
  "streamPayload": {
    "mediaSessionRef": "1778942868.42",
    "streamRef": "7344bd15-83bd-4494-8216-f4483d068518",
    "format": "WAV",
    "type": "AUDIO_OUT",
    "data": "<bytes>"
  }
}
```

Runtime requirements:

- Always preserve `mediaSessionRef`.
- Always preserve `streamRef`.
- Always include `format`.
- Do not write `AUDIO_OUT` before `streamRef` is known.
- Treat duplicate close/end/error events as one terminal path.
- Never block the audio frame callback on Rails or object storage.
- Log the first `AUDIO_IN` and first `AUDIO_OUT` as events.
- Pace outbound audio in consistent frames, 20 ms recommended.
- Use a bounded output buffer. On overflow, drop frames deliberately and emit a pacer/drop diagnostic event.
- On interruption/barge-in, clear queued outbound audio before sending new assistant audio.
- Cancel provider send/receive tasks when the Fonoster stream or call closes.

Current telephony audio assumption:

```text
sample rate: 8000 Hz on call-facing output
encoding: signed 16-bit little-endian PCM frames
frame pacing: 20 ms recommended
```

If a runtime receives provider audio at another rate, it must resample before `AUDIO_OUT`.

For `AUDIO_IN`, the runtime expects call-facing PCM at 8000 Hz unless Fonoster explicitly negotiates a different format.

### Implementation Notes From Reference Examples

The reference examples in `fonoster-library` and the local `test-voiceapp` show implementation patterns that should be carried into the production Onelink runtimes.

#### Fonoster stream handling

Use `response.stream({ direction: BOTH, format: WAV })` as the public contract. In `@fonoster/voice 0.18.2`, implementations must still verify that outgoing payloads carry `mediaSessionRef`, `streamRef`, and `format`. If the public helper does not preserve metadata reliably in the deployed SDK build, wrap StartStream explicitly and attach metadata before every `AUDIO_OUT` write.

Safe runtime behavior:

```text
on StartStreamResponse:
  store stream_ref
  attach media_session_ref, stream_ref, and format to runtime stream object
  emit media_stream_started

on AUDIO_IN:
  ignore payloads for other stream_ref values
  update first_audio_in once
  push audio into provider input queue

on AUDIO_OUT:
  write only with matching media_session_ref and stream_ref
  pace frames to the call-facing sample rate

on close:
  remove stream data listeners
  StopStream if stream_ref exists
  cancel provider tasks
  finalize once
```

#### Provider bridge pattern

The Gemini Live examples use separate async loops/queues for input audio, text input, provider receive, and output audio. Keep this pattern. Do not do provider websocket work directly inside Fonoster's payload callback.

Recommended queues:

```text
caller_audio_queue
provider_text_queue
provider_event_queue
assistant_audio_output_queue
```

Rules:

- `AUDIO_IN` callback only validates, meters, records, and enqueues caller audio.
- Provider sender task drains `caller_audio_queue`.
- Provider receiver task emits transcript/tool/provider events and enqueues assistant audio.
- Output pacer drains `assistant_audio_output_queue` and writes `AUDIO_OUT`.
- Every queue has a max size or max buffered milliseconds.
- Every dropped frame/chunk is logged with reason and byte count.

#### Audio rate conversion

Gemini Live commonly outputs 24 kHz PCM. The current telephony side expects 8 kHz PCM. The runtime must resample provider audio before writing to Fonoster. The Twilio examples use a two-step conversion for quality; for Fonoster, the exact library can differ, but the contract remains:

```text
provider output rate -> call output rate
24 kHz -> 8 kHz currently
PCM16 little-endian out to Fonoster
20 ms pacing recommended
```

#### Interruption behavior

When the provider reports interruption or the caller begins speaking during assistant playback:

```text
clear assistant output buffer
emit interruption event
emit output_buffer_cleared event
continue accepting caller audio unless call is terminal
```

Do not let stale assistant audio play after interruption.

## Mode-Specific Lifecycle Details

### ai Lifecycle

Expected sequence:

```text
voice_session_started
ai_context_requested
ai_context_loaded
provider_session_starting, when pre-answer prewarm is supported
provider_session_started, when pre-answer prewarm is supported
app_leg_answered
media_stream_starting
media_stream_started
first_audio_out, greeting/keepalive/silence PCM within SLA
first_audio_in
caller_speech_started, optional
transcript_delta, repeated
provider_session_starting, if provider was not prewarmed before answer
provider_session_started, if provider was not prewarmed before answer
assistant_speech_started, optional
tool_started/tool_completed/tool_failed, optional
recording_ready, optional and may arrive after finalize
finalize
voice_session_closed
```

`call_linked` with `child_call_ref` is expected only when Fonoster creates a separate runtime/app technical leg. It is not required in the direct AI production happy path when the selected Onelink AI app endpoint is the direct executor.

The first `first_audio_out` event in the happy path may represent greeting, keepalive, or silence PCM. It must correspond to a valid outbound media payload that Fonoster/bridge can observe.

Minimum event payload for `media_stream_started`:

```json
{
  "event_type": "media_stream_started",
  "mode": "ai",
  "call_ref": "parent-call-ref",
  "parent_call_ref": "parent-call-ref",
  "child_call_ref": "child-app-leg-ref",
  "media_session_ref": "1778942868.42",
  "stream_ref": "7344bd15-83bd-4494-8216-f4483d068518",
  "direction": "BOTH",
  "format": "WAV",
  "source": "onelink-ai-voice"
}
```

If the app leg answers but media does not start, emit one of:

```text
media_stream_not_established
start_stream_response_timeout
voice_stream_ended_before_app_answer
media_stream_closed_before_first_audio
```

Never emit `completed` for this condition. Use `status=failed` with a specific media failure `reason`.

### operator Lifecycle

Expected sequence for Onelink-owned operator runtime:

```text
voice_session_started
operator_context_requested
operator_target_selected
caller_answered
operator_dial_started
operator_ringing
operator_answered
operator_media_bridge_started
recording_started, optional
operator_hangup or caller_hangup
recording_ready, optional and may arrive after finalize
finalize
voice_session_closed
```

No-answer sequence:

```text
operator_dial_started
operator_ringing
operator_no_answer
fallback_started or finalize(operator_unavailable)
```

Busy/failed sequence:

```text
operator_dial_started
operator_busy, operator_rejected, operator_timeout, or operator_dial_failed
fallback_started, finalize(operator_unavailable), or finalize(failed)
```

Operator terminal mapping:

```text
operator_no_answer
operator_busy
operator_rejected
operator_timeout
  -> operator_unavailable unless fallback is explicitly configured

operator_dial_failed
  -> failed unless fallback is explicitly configured

operator_hangup after answer
  -> normal operator leg terminal
  -> final status transferred/completed according to topology
```

Required operator fields:

```json
{
  "mode": "operator",
  "operator_agent_aor": "sip:1001@operator.cloud.vconsult.kz",
  "operator_ref": "agent_1001",
  "operator_display_name": "Support 1001",
  "operator_dial_timeout_ms": 30000
}
```

### app Lifecycle

Expected sequence:

```text
voice_session_started
app_context_requested
app_context_loaded
app_leg_answered
media_stream_started, if media is used
app_flow_started
app_step_started/app_step_completed, repeated
transcript_delta, optional
app_flow_completed or app_flow_failed
recording_ready, optional and may arrive after finalize
finalize
voice_session_closed
```

Required app fields:

```json
{
  "mode": "app",
  "app_flow_id": "flow_appointment_booking",
  "app_flow_version": "2026-05-16",
  "app_ref": "fonoster-app-ref-for-onelink-app-voice"
}
```

App mode terminal reasons:

```text
app_flow_completed
app_flow_failed
caller_hung_up
timeout
media_stream_failed
validation_failed
```

### AI Transfer To Operator

AI transfer is a runtime action inside an active AI call. It is not a top-level route mode.

For recordable AI calls, transfer must not bypass Onelink runtime media visibility unless the call is explicitly marked as degraded.

Preferred transfer topologies:

```text
option 1:
  AI runtime remains the media/control anchor through the operator transfer
  AI runtime continues recording caller/operator directions

option 2:
  AI runtime hands off to operator runtime
  bridge_call_ref is preserved
  recording continuity is preserved or explicitly marked partial
```

Direct AI-to-operator transfer without Onelink media visibility is allowed only as explicit degraded mode and is not production-ready for full recording.

Transfer result mapping:

```text
operator answered and transfer bridge completes
  status=transferred or completed, according to topology

operator unavailable/no-answer/busy/rejected/timeout
  status=operator_unavailable, unless fallback succeeds

dial/provider exception
  status=failed, unless fallback succeeds
```

## JSON Event API

The recommended canonical event endpoint for all voice runtimes is:

```http
POST /internal/voice/runtime/event
```

Compatibility endpoints may remain:

```http
POST /internal/voice/inbound/event
POST /internal/voice/ai/event
```

If only the AI endpoint exists today, it may accept all modes temporarily, but every payload must include `mode`.

Generic runtime endpoint requirements:

```text
required payload fields:
  mode
  bridge_call_ref
  runtime_call_ref, when a runtime/app leg exists
  event_id
  event_seq

compatibility model:
  /internal/voice/runtime/event may adapt to /internal/voice/ai/event
  /internal/voice/runtime/transcript may adapt to /internal/voice/ai/transcript
  /internal/voice/runtime/finalize may adapt to /internal/voice/ai/finalize
```

Until generic endpoints are enabled, runtimes use the current `/internal/voice/ai/*` endpoints with explicit `mode` or `routing_mode` metadata.

### Common Event Envelope

```json
{
  "event_id": "evt_01JZ",
  "event_seq": 12,
  "event_type": "media_stream_started",
  "mode": "ai",
  "direction": "inbound",
  "call_ref": "parent-call-ref",
  "bridge_call_ref": "parent-call-ref",
  "runtime_call_ref": "child-call-ref",
  "ai_runtime_call_ref": "child-call-ref",
  "parent_call_ref": "parent-call-ref",
  "child_call_ref": "child-call-ref",
  "provider_call_id": "parent-call-ref",
  "media_session_ref": "1778942868.42",
  "stream_ref": "stream-ref",
  "call_id": "call_123",
  "account_id": "530",
  "inbox_id": "inbox_123",
  "number_ref": "num_123",
  "conversation_id": "conv_123",
  "contact_id": "contact_123",
  "voice_session_id": "voice_sess_01JZ",
  "ai_session_id": "ai_sess_01JZ",
  "occurred_at": "2026-05-16T14:47:55.392Z",
  "source": "onelink-ai-voice",
  "payload": {}
}
```

### Required Headers

```http
Content-Type: application/json
X-Request-Id: <uuid>
X-Event-Id: <event_id>
X-Idempotency-Key: <event_id>
X-Event-Attempt: <attempt number>
Authorization: Bearer <onelink internal voice token>
```

### Rails Status Mapping

Runtime events are lifecycle facts. Rails may map them to user-facing call statuses using this stable contract:

```text
session_started
decision_received
operator_ringing
call_started
app_received_call
  -> ringing

app_answered
stream_started
media_stream_started
ai_answered
operator_answered
transfer_answered
  -> in_progress

operator_no_answer
operator_timeout
timeout
  -> no_answer

operator_failed
session_failed
transfer_failed
provider_error
media_stream_closed
media_stream_not_established
media_stream_framing_error
  -> failed

caller_hangup
  -> cancelled

session_completed
transfer_completed
call_ended
completed
  -> completed

recording_ready
transfer_requested
transfer_result
transcript_delta
tool_started
tool_completed
tool_failed
  -> no direct status transition
```

## Transcript Contract

Recommended endpoint:

```http
POST /internal/voice/runtime/transcript
```

Compatibility endpoint:

```http
POST /internal/voice/ai/transcript
```

Payload:

```json
{
  "event_id": "evt_transcript_01JZ",
  "event_seq": 25,
  "mode": "ai",
  "call_ref": "parent-call-ref",
  "bridge_call_ref": "parent-call-ref",
  "runtime_call_ref": "child-call-ref",
  "parent_call_ref": "parent-call-ref",
  "child_call_ref": "child-call-ref",
  "media_session_ref": "1778942868.42",
  "stream_ref": "stream-ref",
  "voice_session_id": "voice_sess_01JZ",
  "account_id": "530",
  "inbox_id": "inbox_123",
  "number_ref": "num_123",
  "conversation_id": "conv_123",
  "contact_id": "contact_123",
  "speaker": "caller",
  "text": "Hello, I need help with my order.",
  "is_final": true,
  "language": "en-US",
  "started_at": "2026-05-16T14:48:01.000Z",
  "ended_at": "2026-05-16T14:48:03.000Z",
  "source": "onelink-ai-voice"
}
```

Allowed speakers:

```text
caller
assistant
operator
app
system
```

Transcript rules:

1. Store transcript under parent `call_ref`.
2. Include child ref only as debug metadata.
3. Deltas and final transcripts must be idempotent.
4. Finalize must include the complete transcript known at terminal time.
5. Late transcript corrections may be sent after finalize as update events if explicitly supported.

## Finalize Contract

Recommended endpoint:

```http
POST /internal/voice/runtime/finalize
```

Compatibility endpoint:

```http
POST /internal/voice/ai/finalize
```

Finalize is the canonical terminal business event. It must be delivered exactly once logically and retried idempotently.

Payload:

```json
{
  "event_id": "evt_finalize_01JZ",
  "event_seq": 99,
  "event_type": "finalize",
  "mode": "ai",
  "direction": "inbound",
  "call_ref": "parent-call-ref",
  "bridge_call_ref": "parent-call-ref",
  "runtime_call_ref": "child-call-ref",
  "ai_runtime_call_ref": "child-call-ref",
  "parent_call_ref": "parent-call-ref",
  "child_call_ref": "child-call-ref",
  "provider_call_id": "parent-call-ref",
  "media_session_ref": "1778942868.42",
  "stream_ref": "stream-ref",
  "call_id": "call_123",
  "account_id": "530",
  "inbox_id": "inbox_123",
  "number_ref": "num_123",
  "conversation_id": "conv_123",
  "contact_id": "contact_123",
  "voice_session_id": "voice_sess_01JZ",
  "ai_session_id": "ai_sess_01JZ",
  "status": "failed",
  "reason": "media_stream_closed_before_first_audio",
  "started_at": "2026-05-16T14:47:48.772Z",
  "answered_at": "2026-05-16T14:47:55.379Z",
  "media_started_at": "2026-05-16T14:47:55.392Z",
  "ended_at": "2026-05-16T14:47:55.410Z",
  "duration_ms": 6638,
  "media_duration_ms": 18,
  "final_transcript": [],
  "summary": null,
  "recording": {
    "recording_ref": null,
    "recording_url": null,
    "recording_status": "pending",
    "degraded": false,
    "missing_direction": null
  },
  "error": {
    "code": "media_stream_closed_before_first_audio",
    "message": "Fonoster stream closed before first AUDIO_IN/AUDIO_OUT",
    "source": "mediaStream.close",
    "retryable": false
  },
  "source": "onelink-ai-voice"
}
```

Allowed final statuses:

```text
completed
transferred
operator_unavailable
caller_hung_up
cancelled
rejected
timeout
failed
```

Finalize rules:

1. One logical finalize per parent `call_ref`.
2. Retries reuse the same `event_id`.
3. A duplicate identical finalize returns 2xx with `already_finalized=true`.
4. A conflicting finalize must not produce 5xx; Rails stores the first terminal state and logs a conflict event.
5. Finalize must not wait for recording upload.
6. `recording_ready` can arrive after finalize.
7. Finalize must close all runtime-side session state.

## Recording Contract

Recording is owned by the selected Onelink voice runtime when Onelink needs native recording.

Recommended artifact:

```text
format: stereo WAV
encoding: PCM signed 16-bit little-endian
sample rate: 8000 Hz unless deployment changes call rate
left channel: caller
right channel: assistant/operator/app
```

`recording_ready` payload:

```json
{
  "event_type": "recording_ready",
  "mode": "ai",
  "call_ref": "parent-call-ref",
  "bridge_call_ref": "parent-call-ref",
  "runtime_call_ref": "child-call-ref",
  "parent_call_ref": "parent-call-ref",
  "child_call_ref": "child-call-ref",
  "media_session_ref": "1778942868.42",
  "recording_ref": "rec_01JZ",
  "recording_url": "https://...",
  "storage_key": "voice-recordings/530/parent-call-ref/recording.wav",
  "format": "wav",
  "content_type": "audio/wav",
  "channels": 2,
  "sample_rate": 8000,
  "bits_per_sample": 16,
  "duration_ms": 120000,
  "wall_duration_ms": 121000,
  "byte_size": 3840044,
  "sha256": "hex-sha256",
  "writer": "onelink-ai-voice",
  "storage_provider": "onelink-object-storage",
  "inbound_bytes": 1920000,
  "outbound_bytes": 1920000,
  "is_complete_stereo": true,
  "recording_status": "complete",
  "degraded": false,
  "missing_direction": null,
  "source": "onelink-ai-voice"
}
```

Recording rules:

1. Recorder must not block media callbacks.
2. Recorder closes on terminal.
3. Upload happens asynchronously.
4. Upload failure emits `error` with `scope=recording`.
5. Rails attaches recording by parent `call_ref`.
6. If either inbound or outbound bytes are zero for a recordable two-party call, set `is_complete_stereo=false`, `degraded=true`, `recording_status=incomplete`, and emit a recording diagnostic event.
7. If no usable recording can be produced, set `recording_status=unavailable`, `degraded=true`, and `missing_direction=unknown` when the missing side cannot be determined.
8. `missing_direction` values are `caller`, `remote`, or `unknown`.
9. If Fonoster sends legacy `owner=onelink`, Onelink may accept or ignore it as informational metadata. The canonical recording config remains `source=onelink_runtime` and `storage_provider=onelink_storage`.

## Error And Close Source Contract

Every abnormal terminal event must include an exact source.

Allowed close sources:

```text
StartStream.timeout
StartStream.error
StartStream.close
voice.stream.close
mediaStream.close
call.close
parent_call.close
child_call.close
caller_hangup
operator_hangup
provider.close
provider.error
rails.timeout
rails.error
recording.error
unknown
```

Required error fields:

```json
{
  "scope": "voice_stream",
  "code": "media_stream_closed_before_first_audio",
  "message": "Stream closed 14ms after StartStreamResponse",
  "source": "mediaStream.close",
  "retryable": false,
  "details": {
    "milliseconds_after_stream_started": 14,
    "had_first_audio_in": false,
    "had_first_audio_out": false,
    "had_provider_ready": false
  }
}
```

Error scopes:

```text
routing
voice_stream
media_bridge
provider
operator_dial
app_flow
rails_context
rails_tool
recording
finalize
unknown
```

Important mappings:

```text
app leg answered, stream never starts
  status=failed
  reason=media_stream_not_established
  detail=start_stream_response_timeout, when caused by StartStream timeout

stream starts then closes before first audio
  status=failed
  reason=media_stream_closed_before_first_audio

parent call closes before app answer
  status=caller_hung_up or cancelled
  reason=voice_stream_ended_before_app_answer

provider websocket closes before response
  status=failed
  reason=provider_stream_closed

operator does not answer
  status=operator_unavailable
  reason=operator_no_answer

operator busy/rejected/timeout
  status=operator_unavailable
  reason=operator_busy, operator_rejected, or operator_timeout

operator dial exception
  status=failed
  reason=operator_dial_failed

operator hangs up after answer
  status=transferred or completed, according to topology
  reason=operator_hangup or operator_completed
```

## Required Event Types

Common:

```text
voice_session_started
call_linked
route_decision
caller_answered
target_ringing
target_answered
media_stream_starting
media_stream_started
first_audio_in
first_audio_out
recording_started
recording_ready
error
finalize
voice_session_closed
```

AI:

```text
ai_context_requested
ai_context_loaded
provider_session_starting
provider_session_started
provider_session_closed
caller_speech_started
caller_speech_ended
assistant_speech_started
assistant_speech_ended
transcript_delta
tool_started
tool_completed
tool_failed
```

Operator:

```text
operator_target_selected
operator_dial_started
operator_ringing
operator_answered
operator_no_answer
operator_busy
operator_rejected
operator_timeout
operator_dial_failed
operator_media_bridge_started
operator_hangup
```

App:

```text
app_context_requested
app_context_loaded
app_flow_started
app_step_started
app_step_completed
app_flow_completed
app_flow_failed
```

## Idempotency And Retry

Delivery is at least once.

Sender rules:

1. Generate `event_id` once per logical event.
2. Reuse the same `event_id` on retry.
3. Increment `attempt` or `X-Event-Attempt`.
4. Retry transient failures.
5. Do not retry permanent validation/auth failures forever.

Retry on:

```text
network timeout
connection reset
HTTP 408
HTTP 409 if retryable
HTTP 425
HTTP 429
HTTP 500
HTTP 502
HTTP 503
HTTP 504
```

Do not retry as normal transient delivery:

```text
HTTP 400
HTTP 401
HTTP 403
HTTP 404
HTTP 422
```

Rails dedupe priority:

1. `event_id`
2. `(call_ref, event_id)`
3. `(voice_session_id, event_seq)`

## Session Cleanup Requirements

On any terminal source:

```text
parent leg closed
child leg closed
stream closed
provider closed
operator leg closed
app flow terminal
explicit hangup
timeout
fatal error
```

The selected runtime must:

1. Stop accepting audio frames.
2. Close provider session if present.
3. Close stream if still open.
4. Close recorder if present.
5. Close operator/app leg if present.
6. Best-effort close bridge and runtime call legs when the SDK/topology exposes them.
7. Stop timers and polling loops.
8. Emit exact close-source event.
9. Finalize semantically once.
10. Delete in-memory session state.

There must be no lingering `sessions:1` after finalize.

Rails finalize handling:

```text
same duplicate finalize
  -> return success
  -> expose already_finalized=true when possible

conflicting duplicate finalize
  -> store conflict metadata
  -> do not overwrite the first terminal state
  -> do not return a transient 5xx for a handled conflict
  -> preferred response is HTTP 200 with ok=true, already_finalized=true, conflict=true
  -> HTTP 409 is allowed only when runtime treats it as terminal/non-retryable
```

## Smoke-Test Order

After implementation changes, run smoke tests in this order:

1. AI inbound happy path.
2. StartStream timeout and stream closes before first audio.
3. Duplicate finalize and conflicting finalize.
4. Operator inbound answered.
5. Operator no-answer/busy/rejected/timeout.
6. Recording missing one direction.
7. App inbound.
8. Outbound AI/operator/app.

## Acceptance Test Matrix

The integration is not production-ready until these tests pass.

### ai inbound happy path

Expected:

```text
route_decision mode=ai
call_linked with parent_call_ref and child_call_ref
target_answered
media_stream_started
provider_session_started
first_audio_in
first_audio_out
transcript_delta caller
transcript_delta assistant
finalize status=completed
recording_ready attached to parent call_ref
no dangling runtime session
```

Caller must hear AI audio in PSTN.

### ai outbound happy path

Expected:

```text
outbound_requested
remote_answered
media_stream_started
provider_session_started
first_audio_out or first_audio_in
transcript events
finalize
recording_ready
```

### ai stream closes immediately

Simulate or reproduce stream close before first audio.

Expected:

```text
media_stream_started may exist
first_audio_in absent
first_audio_out absent
error scope=voice_stream
reason=media_stream_closed_before_first_audio
finalize status=failed
no completed status
no dangling runtime session
```

### StartStream timeout

Expected:

```text
media_stream_started absent
start_stream_response_timeout emitted
media_stream_not_established emitted
finalize status=failed
reason=media_stream_not_established
detail=start_stream_response_timeout
no AUDIO_OUT write attempted without stream_ref
no dangling runtime session
```

### operator inbound answered

Expected:

```text
route_decision mode=operator
operator_target_selected
operator_dial_started
operator_answered
operator_media_bridge_started, if Onelink owns media
finalize status=completed
recording_ready if enabled
```

### operator no answer

Expected:

```text
operator_dial_started
operator_no_answer
fallback_started or finalize status=operator_unavailable
no dangling runtime session
```

### operator busy/rejected/timeout

Expected:

```text
operator_dial_started
operator_busy or operator_rejected or operator_timeout
fallback_started or finalize status=operator_unavailable
reason=operator_busy or operator_rejected or operator_timeout
no provider failure classification
```

### operator outbound recordable

Expected:

```text
outbound_requested mode=operator
operator-capable runtime app_ref used
operator/customer lifecycle reconciles to one call session
runtime sees caller/customer and operator directions
recording_ready is_complete_stereo=true
finalize terminal state attached by bridge_call_ref
```

### app inbound happy path

Expected:

```text
route_decision mode=app
app_context_loaded
app_flow_started
app_step_started/app_step_completed
app_flow_completed
finalize status=completed
recording_ready if enabled
```

### app outbound happy path

Expected:

```text
outbound_requested mode=app
remote_answered
app_flow_started
app_flow_completed
finalize status=completed
```

### recursive_runtime_app_ref rejected

Expected:

```text
route_decision action=ai or action=app returns current runtime app_ref
handoff not executed
fallback_started or finalize status=failed/rejected according to policy
reason=recursive_runtime_app_ref
no recursive runtime call loop
```

### caller hangs up before target answer

Expected:

```text
parent_call.close or caller_hangup source
finalize status=caller_hung_up or cancelled
reason=voice_stream_ended_before_app_answer
child/runtime session closed if it exists
```

### provider failure

Expected:

```text
provider.error or provider.close
error scope=provider
fallback operator or finalize status=failed reason=provider_stream_closed
no completed status unless fallback succeeds
```

### recording missing one direction

Expected:

```text
recording_enabled=true
inbound_bytes=0 or outbound_bytes=0
recording diagnostic emitted
recording_ready is_complete_stereo=false
recording_status=incomplete
degraded=true
missing_direction=caller, remote, or unknown
recording not presented as complete stereo
```

### duplicate finalize idempotency

Expected:

```text
same event_id and same terminal payload retried
Rails returns success
already_finalized=true when supported
first terminal state unchanged
```

### conflicting finalize idempotency

Expected:

```text
same call session receives different terminal payload after first finalize
Rails stores finalize_conflict metadata
first terminal state unchanged
no transient 5xx for handled conflict
```

## What The Recent Failed Test Means

Observed example:

```text
parent call_ref:
  a4985766-4b39-4d7f-8bd3-c7939b930ce0

child/app handoff call_ref:
  e1c511cf-d28c-4171-8d5a-3f2969daab46

media_session_ref:
  1778942868.42

stream_ref:
  7344bd15-83bd-4494-8216-f4483d068518

timeline:
  app handoff answered
  StartStream succeeded
  stream closed about 14 ms later
  no first_audio_in
  no first_audio_out
  no transcript
```

Correct classification:

```text
status=failed
reason=media_stream_closed_before_first_audio
source=mediaStream.close or voice.stream.close
```

This must not be shown to users as a successful AI answer. `ai_answered` means only that the app leg answered. It does not mean AI audio was established.

## Implementation Checklist For Onelink + VoiceAI

1. Keep a session object keyed by parent `call_ref`.
2. Store child refs as secondary ids on the same session when a transition/debug handoff or other technical child leg exists.
3. Include parent refs in every event and child refs when a child technical leg exists.
4. Emit `call_linked` when child ref is known; direct AI production paths may omit child refs if no child technical leg is created.
5. Emit `media_stream_started` only after StartStream response.
6. Emit `first_audio_in` on first caller audio payload.
7. Emit `first_audio_out` before or when first audio is written to Fonoster.
8. Do not finalize `completed` unless media reached the mode-specific success threshold.
9. Finalize on parent close.
10. Finalize on child close.
11. Finalize on stream close.
12. Finalize on provider fatal close.
13. Close parent state and any child runtime state that exists on any terminal.
14. Do not leave dangling sessions after finalize.
15. Record and upload asynchronously.
16. Attach transcript, recording, and final status to parent `call_ref`.
17. For AI production calls, prewarm context/provider state before answer when possible.
18. For AI production calls, do not wait for FAQ/tool calls before the first greeting or keepalive `AUDIO_OUT`.
19. For AI production calls, measure `answer + StartStreamResponse/stream_ref -> first observed AUDIO_OUT` and keep the happy-path target at `<= 700 ms`.

## Minimum Logs Required In Runtime

Every log line for an active call should include:

```text
mode
direction
call_ref
parent_call_ref
child_call_ref, when a child technical leg exists
media_session_ref
stream_ref
voice_session_id
event_type or action
source
```

Required diagnostic log events:

```text
route_decision_received
ai_direct_endpoint_selected
ai_transition_child_handoff_used, only for debug/migration topology
ai_prewarm_started
ai_prewarm_ready
call_linked
app_leg_answered
start_stream_request_sent
start_stream_response_received
media_stream_started
first_audio_in
provider_session_started
first_audio_out
answer_to_first_audio_out_ms
stream_close
provider_close
parent_call_close
child_call_close
finalize_sent
finalize_retry
finalize_ok
session_deleted
```

Do not log secrets, provider API keys, full prompts, or full customer context.

## Non-Negotiable Invariants

1. One parent `call_ref` equals one user-visible call session.
2. Child refs never become the CRM primary key.
3. App leg answer is not media success.
4. StartStream response is not AI success.
5. `completed` requires mode-specific success.
6. Any terminal close source must finalize once.
7. Recording may arrive after finalize.
8. Rails never receives realtime audio frames.
9. Voice runtimes never block audio callbacks on Rails/storage.
10. Every event must be idempotent.
11. Direct Onelink AI Runtime app endpoint is the AI production happy path.
12. Local runtime to `app:f2498...` child handoff is transition/debug only and outside production SLA.
13. AI first-response SLA is measured from `answer + StartStreamResponse/stream_ref` to first valid `AUDIO_OUT` observed by Fonoster/bridge.
