const test = require("node:test");
const assert = require("node:assert/strict");

process.env.TELEPHONY_BRIDGE_FONOSTER_ACCESS_KEY_ID ||= "test-access-key";
process.env.TELEPHONY_BRIDGE_FONOSTER_ENDPOINT ||= "localhost:50051";
process.env.TELEPHONY_BRIDGE_FONOSTER_USERNAME ||= "test-user";
process.env.TELEPHONY_BRIDGE_FONOSTER_PASSWORD ||= "test-password";
process.env.TELEPHONY_BRIDGE_RUNTIME_APP_REF = "runtime-router-app";
process.env.TELEPHONY_BRIDGE_ONELINK_OPERATOR_APP_REF = "onelink-operator-voice-app";
process.env.TELEPHONY_BRIDGE_DEFAULT_OPERATOR_AGENT_AOR = "";

const {
  buildInboundDecision,
  buildOutboundAppRefDecision,
  buildOutboundRuntimeDecision
} = require('../src/routeDecision');

const inbound = {
  callRef: "call-parent-1",
  appRef: "runtime-router-app",
  direction: "inbound"
};

test("operator app ref is executable without agent AOR as first-class runtime handoff", async () => {
  const decision = await buildInboundDecision({
    inbound,
    chatwootContext: {
      source: "onelink",
      decision: {
        action: "operator",
        operatorAppRef: "onelink-operator-voice-app",
        reason: "business_hours_operator"
      }
    }
  });

  assert.equal(decision.action, "app");
  assert.equal(decision.originalAction, "operator");
  assert.equal(decision.routingMode, "operator");
  assert.equal(decision.appRef, "onelink-operator-voice-app");
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

test("operator runtime handoff rejects recursive runtime app ref", async () => {
  const decision = await buildInboundDecision({
    inbound,
    chatwootContext: {
      source: "onelink",
      decision: {
        action: "operator",
        operatorAppRef: "runtime-router-app",
        reason: "bad_recursive_operator_target"
      }
    }
  });

  assert.equal(decision.action, "reject");
  assert.equal(decision.reason, "recursive_operator_runtime_app_ref");
  assert.equal(decision.originalAction, "operator");
  assert.equal(decision.appRef, "runtime-router-app");
  assert.equal(decision.operatorObservabilityKey, "operator.recursive_handoff_blocked");
  assert.equal(decision.operatorSlaClass, "blocked_recursive_handoff");
});

test("operator agent-only route remains explicit degraded direct bridge", async () => {
  const decision = await buildInboundDecision({
    inbound,
    chatwootContext: {
      source: "onelink",
      decision: {
        action: "operator",
        agentAor: "sip:1001@example.test",
        reason: "legacy_agent_direct_bridge"
      }
    }
  });

  assert.equal(decision.action, "operator");
  assert.equal(decision.agentAor, "sip:1001@example.test");
  assert.equal(decision.operatorFirstClassProductionPath, false);
  assert.equal(decision.operatorExecutionMode, "direct_bridge");
  assert.equal(decision.operatorDirectBridgeDegraded, true);
  assert.equal(decision.mediaOwnership, "fonoster_direct_bridge");
  assert.equal(decision.recordingOwnership, "explicit_direct_bridge_contract_required");
  assert.equal(decision.transcriptOwnership, "explicit_direct_bridge_contract_required");
  assert.equal(decision.operatorObservabilityKey, "operator.direct_bridge.degraded");
  assert.equal(decision.operatorSlaClass, "degraded_direct_bridge");
  assert.equal(decision.recordingImportContract, "fonoster_pull_recording_ready_required");
  assert.equal(decision.transcriptContract, "explicit_direct_bridge_contract_required");
});

test("default operator app ref is used only when no concrete agent target is present", async () => {
  const decision = await buildInboundDecision({
    inbound,
    chatwootContext: {
      source: "onelink",
      decision: {
        action: "operator",
        reason: "default_operator_runtime"
      }
    }
  });

  assert.equal(decision.action, "app");
  assert.equal(decision.appRef, "onelink-operator-voice-app");
  assert.equal(decision.operatorExecutionMode, "runtime_handoff");
  assert.equal(decision.operatorFirstClassProductionPath, true);
});



test('outbound explicit app ref does not default an empty mode to reject', () => {
  const decision = buildOutboundAppRefDecision({
    app_ref: 'runtime-router-app'
  });

  assert.equal(decision.appRef, 'runtime-router-app');
  assert.equal(decision.routingMode, '');
});

test('outbound explicit app ref preserves requested operator mode', () => {
  const decision = buildOutboundAppRefDecision({
    app_ref: 'runtime-router-app',
    routing_mode: 'operator'
  });

  assert.equal(decision.appRef, 'runtime-router-app');
  assert.equal(decision.routingMode, 'operator');
});

test('outbound runtime callback uses operator metadata without inbound route lookup', () => {
  const decision = buildOutboundRuntimeDecision({
    callRef: 'outbound-call-1',
    appRef: 'runtime-router-app',
    direction: 'outbound',
    ingressNumber: '9098',
    metadata: {
      routing_mode: 'operator',
      agent_aor: 'sip:1001@operator.example.test',
      fonoster_agent_ref: '1001'
    }
  });

  assert.equal(decision.action, 'operator');
  assert.equal(decision.routingMode, 'operator');
  assert.equal(decision.agentAor, 'sip:1001@operator.example.test');
  assert.equal(decision.operatorAgentRef, '1001');
  assert.equal(decision.answer, false);
  assert.equal(decision.answerBeforeDial, false);
  assert.equal(decision.reason, 'outbound_runtime_route');
  assert.equal(decision.source, 'local_outbound_runtime');
  assert.equal(decision.operatorExecutionMode, 'direct_bridge');
});

test('operator-first outbound metadata executes runtime handoff by default', () => {
  const decision = buildOutboundRuntimeDecision({
    callRef: 'outbound-call-operator-first',
    appRef: 'runtime-router-app',
    direction: 'outbound',
    ingressNumber: '9098',
    metadata: {
      routing_mode: 'operator',
      operator_first_outbound: true,
      outbound_target_number: '+77066318623',
      agent_aor: 'sip:1001@operator.example.test',
      fonoster_agent_ref: '1001'
    }
  });

  assert.equal(decision.action, 'outbound_target');
  assert.equal(decision.originalAction, 'operator');
  assert.equal(decision.routingMode, 'operator');
  assert.equal(decision.destination, '+77066318623');
  assert.equal(decision.phoneNumber, '+77066318623');
  assert.equal(decision.callDirection, 'outbound');
  assert.equal(decision.answer, true);
  assert.equal(decision.answerBeforeDial, true);
  assert.equal(decision.reason, 'operator_first_outbound_route');
  assert.equal(decision.source, 'local_outbound_runtime');
  assert.equal(decision.operatorExecutionMode, 'runtime_handoff');
  assert.equal(decision.operatorFirstClassProductionPath, true);
});

test('operator-first outbound runtime callback honors explicit disable', () => {
  const decision = buildOutboundRuntimeDecision({
    callRef: 'outbound-call-operator-first-disabled',
    appRef: 'runtime-router-app',
    direction: 'outbound',
    ingressNumber: '9098',
    metadata: {
      routing_mode: 'operator',
      disable_operator_first_outbound: true,
      operator_first_outbound: true,
      outbound_target_number: '+77066318623',
      agent_aor: 'sip:1001@operator.example.test',
      fonoster_agent_ref: '1001'
    }
  });

  assert.equal(decision.action, 'operator');
  assert.equal(decision.routingMode, 'operator');
  assert.equal(decision.agentAor, 'sip:1001@operator.example.test');
  assert.equal(decision.answer, false);
  assert.equal(decision.answerBeforeDial, false);
  assert.equal(decision.reason, 'outbound_runtime_route');
  assert.equal(decision.source, 'local_outbound_runtime');
  assert.equal(decision.operatorExecutionMode, 'direct_bridge');
});

test('outbound runtime callback infers operator from Fonoster agent hint when mode is empty app fallback', () => {
  const decision = buildOutboundRuntimeDecision({
    callRef: 'outbound-call-2',
    appRef: 'runtime-router-app',
    direction: 'outbound',
    ingressNumber: '9098',
    metadata: {
      routing_mode: 'app',
      agent_aor: 'sip:1001@operator.example.test',
      fonoster_agent_ref: '1001'
    }
  });

  assert.equal(decision.action, 'operator');
  assert.equal(decision.routingMode, 'operator');
  assert.equal(decision.agentAor, 'sip:1001@operator.example.test');
});

test('outbound runtime callback does not infer operator from default AOR alone', () => {
  const decision = buildOutboundRuntimeDecision({
    callRef: 'outbound-call-3',
    appRef: 'runtime-router-app',
    direction: 'outbound',
    ingressNumber: '9098',
    metadata: {
      routing_mode: 'app'
    }
  });

  assert.equal(decision, null);
});
