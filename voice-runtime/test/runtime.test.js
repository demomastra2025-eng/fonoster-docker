process.env.VOICE_RUNTIME_APP_HANDOFF_STATUS_TIMEOUT_MS = "25";
process.env.VOICE_RUNTIME_APP_HANDOFF_TERMINAL_TIMEOUT_MS = "200";
process.env.VOICE_RUNTIME_CONTROL_EVENTS_ENABLED = "0";
process.env.VOICE_RUNTIME_RECORDING_READY_DELAY_MS = "0";
process.env.VOICE_RUNTIME_RECORDING_BASE_URL = "https://cloud.vconsult.kz/recordings";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { buildInbound, handleIncomingCall, sanitizeDecision } = require("../src/runtime");
const bridgeClient = require("../src/bridgeClient");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createVoice() {
  const emitter = new EventEmitter();
  emitter.write = (message) => {
    emitter.lastWrite = message;
  };

  return {
    voice: emitter,
    answer: async () => {},
    hangup: async () => {
      emitter.hungUp = true;
    }
  };
}

function createBridge(decision) {
  const events = [];

  return {
    events,
    fetchInboundDecision: async () => decision,
    emitVoiceEvent: async (event) => {
      events.push(event);
    },
    pollControlEvents: async () => []
  };
}

function createInbound() {
  return {
    appRef: "router-app",
    callRef: `call-${Math.random().toString(16).slice(2)}`,
    mediaSessionRef: `media-${Math.random().toString(16).slice(2)}`,
    ingressNumber: "+18623964686",
    callerNumber: "+77066318623",
    callDirection: "inbound",
    metadata: {
      account_id: "530"
    }
  };
}

function createDecision() {
  return {
    action: "ai",
    appRef: "ai-app",
    reason: "pending_conversation_ai_route",
    accountId: "530",
    inboxId: "4083",
    numberRef: "number-ref"
  };
}

test("sanitizeDecision preserves operator execution and ownership metadata", () => {
  const decision = sanitizeDecision({
    action: "app",
    routingMode: "operator",
    appRef: "onelink-operator-voice-app",
    operatorAppRef: "onelink-operator-voice-app",
    operatorFirstClassProductionPath: true,
    operatorExecutionMode: "runtime_handoff",
    operatorDirectBridgeDegraded: false,
    mediaOwnership: "onelink_runtime",
    recordingOwnership: "onelink_runtime",
    transcriptOwnership: "onelink_runtime",
    operatorObservabilityKey: "operator.runtime_handoff",
    operatorSlaClass: "first_class_runtime",
    recordingImportContract: "runtime_owned_no_fonoster_import",
    transcriptContract: "onelink_runtime"
  });

  assert.equal(decision.routingMode, "operator");
  assert.equal(decision.operatorAppRef, "onelink-operator-voice-app");
  assert.equal(decision.operatorFirstClassProductionPath, true);
  assert.equal(decision.operatorExecutionMode, "runtime_handoff");
  assert.equal(decision.operatorDirectBridgeDegraded, false);
  assert.equal(decision.mediaOwnership, "onelink_runtime");
  assert.equal(decision.recordingOwnership, "onelink_runtime");
  assert.equal(decision.transcriptOwnership, "onelink_runtime");
  assert.equal(decision.operatorObservabilityKey, "operator.runtime_handoff");
  assert.equal(decision.operatorSlaClass, "first_class_runtime");
  assert.equal(decision.recordingImportContract, "runtime_owned_no_fonoster_import");
  assert.equal(decision.transcriptContract, "onelink_runtime");
});

test("buildInbound preserves OneLink routing context from metadata", () => {
  const inbound = buildInbound({
    appRef: "router-app",
    callRef: "call-with-number-ref",
    mediaSessionRef: "media-with-number-ref",
    ingressNumber: "9098",
    callerNumber: "87066318623",
    callDirection: "inbound",
    metadata: {
      onelink_number_ref: "number-ref",
      chatwoot_inbox_id: "4593",
      chatwoot_account_id: "530"
    }
  });

  assert.equal(inbound.numberRef, "number-ref");
  assert.equal(inbound.inboxId, "4593");
  assert.equal(inbound.accountId, "530");
});

test("fetchInboundDecision forwards OneLink routing context to bridge", async () => {
  const originalFetch = global.fetch;
  let capturedBody;

  global.fetch = async (_url, options = {}) => {
    capturedBody = JSON.parse(options.body);
    return {
      ok: true,
      text: async () => JSON.stringify({ action: "operator" })
    };
  };

  try {
    await bridgeClient.fetchInboundDecision({
      callRef: "call-with-number-ref",
      bridgeCallRef: "call-with-number-ref",
      appRef: "router-app",
      mediaSessionRef: "media-with-number-ref",
      numberRef: "number-ref",
      inboxId: "4593",
      accountId: "530",
      ingressNumber: "9098",
      callerNumber: "87066318623",
      direction: "inbound",
      receivedAt: "2026-06-07T11:00:00.000Z",
      metadata: {}
    });
  } finally {
    global.fetch = originalFetch;
  }

  assert.equal(capturedBody.number_ref, "number-ref");
  assert.equal(capturedBody.numberRef, "number-ref");
  assert.equal(capturedBody.inbox_id, "4593");
  assert.equal(capturedBody.inboxId, "4593");
  assert.equal(capturedBody.account_id, "530");
});

test("operator app handoff emits ownership metadata on decision_received", async () => {
  const voice = createVoice();
  const bridge = createBridge({
    action: "app",
    routingMode: "operator",
    appRef: "onelink-operator-voice-app",
    operatorAppRef: "onelink-operator-voice-app",
    operatorFirstClassProductionPath: true,
    operatorExecutionMode: "runtime_handoff",
    operatorDirectBridgeDegraded: false,
    mediaOwnership: "onelink_runtime",
    recordingOwnership: "onelink_runtime",
    transcriptOwnership: "onelink_runtime",
    operatorObservabilityKey: "operator.runtime_handoff",
    operatorSlaClass: "first_class_runtime",
    recordingImportContract: "runtime_owned_no_fonoster_import",
    transcriptContract: "onelink_runtime"
  });
  const run = handleIncomingCall(createInbound(), voice, { bridge });

  await delay(5);
  const decisionReceived = bridge.events.find(
    (event) => event.eventType === "decision_received"
  );

  assert.equal(decisionReceived.operatorFirstClassProductionPath, true);
  assert.equal(decisionReceived.operatorExecutionMode, "runtime_handoff");
  assert.equal(decisionReceived.operatorDirectBridgeDegraded, false);
  assert.equal(decisionReceived.mediaOwnership, "onelink_runtime");
  assert.equal(decisionReceived.recordingOwnership, "onelink_runtime");
  assert.equal(decisionReceived.transcriptOwnership, "onelink_runtime");
  assert.equal(decisionReceived.operatorObservabilityKey, "operator.runtime_handoff");
  assert.equal(decisionReceived.operatorSlaClass, "first_class_runtime");
  assert.equal(decisionReceived.recordingImportContract, "runtime_owned_no_fonoster_import");
  assert.equal(decisionReceived.transcriptContract, "onelink_runtime");

  voice.voice.emit("data", {
    dialStatus: {
      status: "CANCEL",
      runtimeCallRef: "runtime-child",
      streamRef: "stream-ref",
      closeSource: "test.cancel"
    }
  });
  await run;
  await delay(5);

  assert.equal(
    bridge.events.some((event) => event.eventType === "recording_ready"),
    false
  );
});

test("operator direct bridge skips recording_ready for Fonoster pull contract", async () => {
  const voice = createVoice();
  const inbound = createInbound();
  const bridge = createBridge({
    action: "operator",
    routingMode: "operator",
    agentAor: "sip:1001@operator.cloud.vconsult.kz",
    recordingOwnership: "explicit_direct_bridge_contract_required",
    recordingImportContract: "fonoster_pull_recording_ready_required"
  });
  const run = handleIncomingCall(inbound, voice, { bridge });

  await delay(5);
  voice.voice.emit("data", {
    dialStatus: {
      status: "CANCEL",
      runtimeCallRef: "runtime-child",
      streamRef: "stream-ref",
      closeSource: "test.cancel"
    }
  });
  await run;
  await delay(5);

  assert.equal(
    bridge.events.some((event) => event.eventType === "recording_ready"),
    false
  );
});

test("operator route does not dial after caller hangs up before route decision", async () => {
  const voice = createVoice();
  const bridge = createBridge({
    action: "operator",
    agentAor: "sip:1001@operator.cloud.vconsult.kz",
    reason: "operator_route",
    accountId: "530",
    inboxId: "4593",
    numberRef: "number-ref"
  });
  bridge.fetchInboundDecision = async () => {
    await delay(25);
    return {
      action: "operator",
      agentAor: "sip:1001@operator.cloud.vconsult.kz",
      reason: "operator_route",
      accountId: "530",
      inboxId: "4593",
      numberRef: "number-ref"
    };
  };

  const run = handleIncomingCall(createInbound(), voice, { bridge });

  await delay(5);
  voice.voice.emit("end");
  await run;

  assert.equal(voice.voice.lastWrite, undefined);
  assert.equal(voice.voice.hungUp, undefined);
  assert.equal(
    bridge.events.some((event) => event.eventType === "operator_timeout"),
    false
  );

  const missed = bridge.events.find((event) => event.eventType === "missed");
  assert.equal(missed.currentStatus, "missed");
  assert.equal(missed.endReason, "caller_hangup_before_route_decision");
  assert.equal(missed.endedBy, "caller");
});

test("answered app handoff is not failed by status timeout", async () => {
  const voice = createVoice();
  const bridge = createBridge(createDecision());
  const run = handleIncomingCall(createInbound(), voice, { bridge });

  await delay(5);
  voice.voice.emit("data", {
    dialStatus: {
      status: "ANSWER",
      runtimeCallRef: "runtime-child",
      streamRef: "stream-ref"
    }
  });

  await delay(70);

  assert.equal(
    bridge.events.some(
      (event) =>
        event.eventType === "session_completed" &&
        event.endReason === "app_leg_terminal_status_timeout"
    ),
    false
  );
  assert.equal(
    bridge.events.some(
      (event) =>
        event.eventType === "app_handoff_failed" &&
        event.endReason === "app_leg_terminal_status_timeout"
    ),
    false
  );

  voice.voice.emit("data", {
    dialStatus: {
      status: "CANCEL",
      runtimeCallRef: "runtime-child",
      streamRef: "stream-ref",
      closeSource: "test.cancel"
    }
  });
  await run;

  const terminal = bridge.events.find(
    (event) => event.eventType === "session_completed"
  );
  assert.equal(terminal.runtimeCallRef, "runtime-child");
  assert.equal(terminal.streamRef, "stream-ref");
  assert.equal(terminal.endReason, "media_stream_closed_before_audio");
});

test("answered app handoff cancel after audio out is not closed before audio", async () => {
  const voice = createVoice();
  const bridge = createBridge(createDecision());
  const run = handleIncomingCall(createInbound(), voice, { bridge });

  await delay(5);
  voice.voice.emit("data", {
    dialStatus: {
      status: "ANSWER",
      runtimeCallRef: "runtime-child",
      streamRef: "stream-ref"
    }
  });

  await delay(5);
  voice.voice.emit("data", {
    dialStatus: {
      status: "CANCEL",
      runtimeCallRef: "runtime-child",
      streamRef: "stream-ref",
      closeSource: "test.cancel",
      sawAudioOut: true,
      firstAudioOutBytes: 320,
      audioOutBytesTotal: 58560,
      startStreamResponseAt: "2026-05-17T08:00:00.000Z",
      firstAudioInAt: "2026-05-17T08:00:00.100Z",
      firstAudioOutAt: "2026-05-17T08:00:00.125Z",
      firstAudioOutDeltaMs: 125,
      cancelAt: "2026-05-17T08:00:02.000Z"
    }
  });
  await run;

  const terminal = bridge.events.find(
    (event) => event.eventType === "session_completed"
  );
  assert.equal(terminal.endReason, "media_stream_closed_after_audio");
  assert.equal(terminal.outcome, "media_stream_closed_after_audio");
  assert.equal(terminal.currentStatus, "cancelled");
  assert.equal(terminal.mediaEstablished, true);
  assert.equal(terminal.mediaEstablishedReason, "audio_out_observed_by_bridge");
  assert.equal(terminal.firstAudioOutBytes, 320);
  assert.equal(terminal.audioOutBytesTotal, 58560);
  assert.equal(terminal.firstAudioOutDeltaMs, 125);
  assert.equal(terminal.cancelDeltaMs, 2000);
  assert.equal(terminal.cancel_delta_ms, 2000);
  assert.equal(terminal.cancelAfterFirstAudioInDeltaMs, 1900);
  assert.equal(terminal.cancel_after_first_audio_in_delta_ms, 1900);
  assert.equal(terminal.cancelAfterFirstAudioOutDeltaMs, 1875);
  assert.equal(terminal.cancel_after_first_audio_out_delta_ms, 1875);
  assert.equal(
    bridge.events.some((event) => event.eventType === "app_handoff_failed"),
    false
  );
});

test("answered app handoff terminalizes immediately when caller closes entry voice stream", async () => {
  const voice = createVoice();
  const bridge = createBridge(createDecision());
  const inbound = createInbound();
  const run = handleIncomingCall(inbound, voice, { bridge });

  await delay(5);
  voice.voice.emit("data", {
    dialStatus: {
      status: "ANSWER",
      runtimeCallRef: "runtime-child",
      streamRef: "stream-ref",
      sawAudioOut: true,
      firstAudioOutBytes: 320,
      audioOutBytesTotal: 58560,
      firstAudioOutDeltaMs: 125
    }
  });

  await delay(5);
  voice.voice.emit("end");
  await run;

  const terminal = bridge.events.find(
    (event) => event.eventType === "session_completed"
  );
  assert.equal(terminal.callRef, inbound.callRef);
  assert.equal(terminal.runtimeCallRef, "runtime-child");
  assert.equal(terminal.streamRef, "stream-ref");
  assert.equal(terminal.currentStatus, "cancelled");
  assert.equal(terminal.endReason, "media_stream_closed_after_audio");
  assert.equal(terminal.terminalSource, "voice_end");
  assert.equal(terminal.endedBy, "caller");
  assert.equal(terminal.hangupInitiator, "caller");
  assert.equal(terminal.appLegTerminalReceived, false);
  assert.equal(terminal.mediaEstablished, true);
  assert.equal(terminal.audioOutBytesTotal, 58560);
  assert.equal(
    bridge.events.some((event) => event.eventType === "app_handoff_failed"),
    false
  );
});

test("answered app handoff terminalizes when terminal status never arrives", async () => {
  const voice = createVoice();
  const bridge = createBridge(createDecision());
  const run = handleIncomingCall(createInbound(), voice, { bridge });

  await delay(5);
  voice.voice.emit("data", {
    dialStatus: {
      status: "ANSWER",
      runtimeCallRef: "runtime-child",
      streamRef: "stream-ref"
    }
  });

  await run;

  const terminal = bridge.events.find(
    (event) => event.eventType === "session_completed"
  );
  assert.equal(terminal.runtimeCallRef, "runtime-child");
  assert.equal(terminal.streamRef, "stream-ref");
  assert.equal(terminal.currentStatus, "failed");
  assert.equal(terminal.endReason, "app_handoff_terminal_timeout_after_answer");
  assert.equal(terminal.terminalSource, "app_handoff_terminal_timeout");
  assert.equal(terminal.appLegTerminalReceived, false);
  assert.equal(terminal.terminalTimeoutMs, 200);
  assert.equal(voice.voice.hungUp, true);
});

test("unanswered app handoff still fails by status timeout", async () => {
  const voice = createVoice();
  const bridge = createBridge(createDecision());

  await handleIncomingCall(createInbound(), voice, { bridge });

  const terminal = bridge.events.find(
    (event) => event.eventType === "session_completed"
  );
  assert.equal(terminal.currentStatus, "failed");
  assert.equal(terminal.endReason, "app_handoff_status_timeout");
  assert.equal(voice.voice.hungUp, true);
});
