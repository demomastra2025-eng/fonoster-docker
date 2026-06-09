const { config } = require("./config");

function hasExecutableTarget(decision) {
  const action = normalizeDecisionAction(decision?.action);
  return Boolean(
    decision?.destination ||
      decision?.phone_number ||
      decision?.phoneNumber ||
      decision?.agent_aor ||
      decision?.agentAor ||
      (action === "ai" ? getAiAppRef(decision).appRef : getAppRef(decision))
  );
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }

  return "";
}

function getAppRef(decision) {
  return firstNonEmpty(
    decision?.appRef,
    decision?.app_ref,
    decision?.applicationRef,
    decision?.application_ref
  );
}

function getOperatorAppRef(decision = {}, { includeDefault = true } = {}) {
  return firstNonEmpty(
    decision.operatorAppRef,
    decision.operator_app_ref,
    decision.onelinkOperatorAppRef,
    decision.onelink_operator_app_ref,
    includeDefault ? config.defaults.onelinkOperatorAppRef : ""
  );
}

function normalizeAiMode(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[-\s]+/g, "_");

  if (!normalized) {
    return normalizeAiMode(config.defaults.aiMode || "fonoster_managed");
  }

  if (["onelink", "onelink_ai", "onelink_managed", "onelink_owned"].includes(normalized)) {
    return "onelink_managed";
  }

  if (
    [
      "fonoster",
      "fonoster_ai",
      "fonoster_managed",
      "fonoster_owned",
      "local",
      "bridge"
    ].includes(normalized)
  ) {
    return "fonoster_managed";
  }

  return normalized;
}

function getDecisionAiMode(decision = {}) {
  return normalizeAiMode(
    decision.aiMode ||
      decision.ai_mode ||
      decision.aiDeploymentMode ||
      decision.ai_deployment_mode ||
      decision.aiOwner ||
      decision.ai_owner ||
      ""
  );
}

function isConfiguredRuntimeAppRef(appRef) {
  const normalized = String(appRef || "").trim();
  const configuredRuntimeAppRef = String(config.defaults.runtimeAppRef || "").trim();

  return Boolean(normalized && configuredRuntimeAppRef && normalized === configuredRuntimeAppRef);
}

function isDirectOnelinkAiAppRef(appRef) {
  const normalized = String(appRef || "").trim();
  const onelinkAiAppRef = String(config.defaults.onelinkAiAppRef || "").trim();

  return Boolean(normalized && onelinkAiAppRef && normalized === onelinkAiAppRef);
}

function getAiTopology(appRef, inbound = {}) {
  const inboundAppRef = String(inbound?.appRef || inbound?.app_ref || "").trim();

  if (isConfiguredRuntimeAppRef(inboundAppRef) && isDirectOnelinkAiAppRef(appRef)) {
    return "transition_debug_child_handoff";
  }

  if (isDirectOnelinkAiAppRef(appRef)) {
    return "direct_ai";
  }

  return "fonoster_managed_ai";
}

function getAiEndpoint(appRef) {
  if (isDirectOnelinkAiAppRef(appRef)) {
    return config.defaults.onelinkAiAppEndpoint || "";
  }

  return "";
}

function withAiExecutionMetadata(decision, appRef, inbound = {}) {
  const topology = getAiTopology(appRef, inbound);
  const endpoint = getAiEndpoint(appRef);

  return {
    ...decision,
    appRef,
    app_ref: appRef,
    selectedAppRef: appRef,
    selected_app_ref: appRef,
    topology,
    productionAiDirect: topology === "direct_ai",
    production_ai_direct: topology === "direct_ai",
    ...(endpoint ? { endpoint, selectedEndpoint: endpoint, selected_endpoint: endpoint } : {})
  };
}

function isAiTransitionPathBlocked(appRef, inbound = {}) {
  return (
    config.defaults.aiDirectAppExecutorEnabled &&
    !config.defaults.aiChildHandoffFallbackEnabled &&
    getAiTopology(appRef, inbound) === "transition_debug_child_handoff"
  );
}

function getAiAppRef(decision = {}) {
  const aiMode = getDecisionAiMode(decision);

  if (aiMode === "onelink_managed") {
    const onelinkAppRef = firstNonEmpty(
      decision.onelinkAiAppRef,
      decision.onelink_ai_app_ref,
      config.defaults.onelinkAiAppRef,
      decision.aiAppRef,
      decision.ai_app_ref,
      getAppRef(decision)
    );
    if (onelinkAppRef) {
      return {
        appRef: onelinkAppRef,
        aiMode,
        aiModeFallback: false
      };
    }

    return {
      appRef: config.defaults.fallbackAiAppRef || "",
      aiMode,
      aiModeFallback: Boolean(config.defaults.fallbackAiAppRef)
    };
  }

  const explicitAppRef = getAppRef(decision);
  if (explicitAppRef) {
    return {
      appRef: explicitAppRef,
      aiMode: getDecisionAiMode(decision),
      aiModeFallback: false
    };
  }

  const explicitAiAppRef = firstNonEmpty(decision.aiAppRef, decision.ai_app_ref);
  if (explicitAiAppRef) {
    return {
      appRef: explicitAiAppRef,
      aiMode: getDecisionAiMode(decision),
      aiModeFallback: false
    };
  }

  return {
    appRef: firstNonEmpty(
      decision.fonosterAiAppRef,
      decision.fonoster_ai_app_ref,
      config.defaults.fonosterAiAppRef,
      config.defaults.aiAppRef
    ),
    aiMode: "fonoster_managed",
    aiModeFallback: false
  };
}

function hasOperatorTarget(decision) {
  return Boolean(
    decision?.destination ||
      decision?.phone_number ||
      decision?.phoneNumber ||
      decision?.agent_aor ||
      decision?.agentAor
  );
}

function hasOperatorRuntimeTarget(decision) {
  if (hasOperatorTarget(decision)) {
    return Boolean(getOperatorAppRef(decision, { includeDefault: false }));
  }

  return Boolean(getOperatorAppRef(decision));
}

function buildOperatorContractMetadata(executionMode) {
  if (executionMode === "runtime_handoff") {
    return {
      operatorObservabilityKey: "operator.runtime_handoff",
      operator_observability_key: "operator.runtime_handoff",
      operatorSlaClass: "first_class_runtime",
      operator_sla_class: "first_class_runtime",
      recordingImportContract: "runtime_owned_no_fonoster_import",
      recording_import_contract: "runtime_owned_no_fonoster_import",
      transcriptContract: "onelink_runtime",
      transcript_contract: "onelink_runtime"
    };
  }

  if (executionMode === "recursive_handoff_blocked") {
    return {
      operatorObservabilityKey: "operator.recursive_handoff_blocked",
      operator_observability_key: "operator.recursive_handoff_blocked",
      operatorSlaClass: "blocked_recursive_handoff",
      operator_sla_class: "blocked_recursive_handoff",
      recordingImportContract: "not_applicable",
      recording_import_contract: "not_applicable",
      transcriptContract: "not_applicable",
      transcript_contract: "not_applicable"
    };
  }

  return {
    operatorObservabilityKey: "operator.direct_bridge.degraded",
    operator_observability_key: "operator.direct_bridge.degraded",
    operatorSlaClass: "degraded_direct_bridge",
    operator_sla_class: "degraded_direct_bridge",
    recordingImportContract: "fonoster_pull_recording_ready_required",
    recording_import_contract: "fonoster_pull_recording_ready_required",
    transcriptContract: "explicit_direct_bridge_contract_required",
    transcript_contract: "explicit_direct_bridge_contract_required"
  };
}

function withOperatorExecutionMetadata(decision, executionMode, extra = {}) {
  const runtimeOwned = executionMode === "runtime_handoff";
  const contractMetadata = buildOperatorContractMetadata(executionMode);

  return {
    ...decision,
    operatorFirstClassProductionPath: runtimeOwned,
    operator_first_class_production_path: runtimeOwned,
    operatorExecutionMode: executionMode,
    operator_execution_mode: executionMode,
    operatorDirectBridgeDegraded: !runtimeOwned,
    operator_direct_bridge_degraded: !runtimeOwned,
    mediaOwnership:
      decision.mediaOwnership ||
      decision.media_ownership ||
      (runtimeOwned ? "onelink_runtime" : "fonoster_direct_bridge"),
    media_ownership:
      decision.media_ownership ||
      decision.mediaOwnership ||
      (runtimeOwned ? "onelink_runtime" : "fonoster_direct_bridge"),
    recordingOwnership:
      decision.recordingOwnership ||
      decision.recording_ownership ||
      (runtimeOwned ? "onelink_runtime" : "explicit_direct_bridge_contract_required"),
    recording_ownership:
      decision.recording_ownership ||
      decision.recordingOwnership ||
      (runtimeOwned ? "onelink_runtime" : "explicit_direct_bridge_contract_required"),
    transcriptOwnership:
      decision.transcriptOwnership ||
      decision.transcript_ownership ||
      (runtimeOwned ? "onelink_runtime" : "explicit_direct_bridge_contract_required"),
    transcript_ownership:
      decision.transcript_ownership ||
      decision.transcriptOwnership ||
      (runtimeOwned ? "onelink_runtime" : "explicit_direct_bridge_contract_required"),
    ...contractMetadata,
    ...extra
  };
}

function withDefaultOperatorTarget(decision) {
  if (hasOperatorTarget(decision)) return decision;

  const agentAor = String(config.defaults.operatorAgentAor || "").trim();
  if (!agentAor) return decision;

  return {
    ...decision,
    agentAor,
    defaultedAgentAor: true
  };
}

function isRuntimeAppRef(appRef, inbound, action = "") {
  const normalized = String(appRef || "").trim();
  if (!normalized) return false;

  const inboundAppRef = String(inbound?.appRef || inbound?.app_ref || "").trim();
  const configuredRuntimeAppRef = String(config.defaults.runtimeAppRef || "").trim();

  if (
    normalizeDecisionAction(action) === "ai" &&
    config.defaults.aiDirectAppExecutorEnabled &&
    inboundAppRef &&
    normalized === inboundAppRef &&
    isDirectOnelinkAiAppRef(normalized)
  ) {
    return false;
  }

  return Boolean(
    (inboundAppRef && normalized === inboundAppRef) ||
      (configuredRuntimeAppRef && normalized === configuredRuntimeAppRef)
  );
}

function normalizeDecisionAction(rawAction) {
  const normalized = String(rawAction || "reject").trim().toLowerCase();
  if (normalized === "ai_agent" || normalized === "ai-agent") {
    return "ai";
  }
  return normalized;
}

function shouldAnswerReject(decision) {
  return (
    decision?.answer === true ||
    decision?.answerCall === true ||
    decision?.answer_call === true
  );
}

function buildRejectDecision({
  inbound,
  reason,
  source,
  message,
  answer = false,
  extra = {}
}) {
  return {
    action: "reject",
    answer,
    message: message || "",
    reason,
    source,
    inbound,
    ...extra
  };
}

function normalizeReason(reason) {
  return String(reason || "").trim().toLowerCase();
}

function isNativeFallbackReason(reason) {
  const normalized = normalizeReason(reason);
  if (!normalized) return false;

  return config.defaults.nativeRouteFallbackReasons
    .map(normalizeReason)
    .includes(normalized);
}

function summarizeDecision(decision) {
  if (!decision || typeof decision !== "object") return null;
  const action = normalizeDecisionAction(decision.action);
  const aiTarget = action === "ai" ? getAiAppRef(decision) : {};

  return {
    action: action || null,
    routingMode: decision.routingMode || decision.routing_mode || null,
    reason: decision.reason || null,
    source: decision.source || null,
    appRef: getAppRef(decision) || aiTarget.appRef || null,
    aiMode: decision.aiMode || decision.ai_mode || aiTarget.aiMode || null,
    operatorAppRef: getOperatorAppRef(decision) || null,
    agentAor: decision.agentAor || decision.agent_aor || null,
    destination: decision.destination || decision.phoneNumber || decision.phone_number || null
  };
}

function buildOperatorRuntimeHandoffDecision(decision, inbound, source) {
  const appRef = hasOperatorTarget(decision)
    ? getOperatorAppRef(decision, { includeDefault: false })
    : getOperatorAppRef(decision);
  if (!appRef) return null;

  if (isRuntimeAppRef(appRef, inbound)) {
    return buildRejectDecision({
      inbound,
      reason: "recursive_operator_runtime_app_ref",
      source: `${source || "operator_runtime"}_downgraded`,
      extra: {
        originalAction: decision.action || "operator",
        appRef,
        ...buildOperatorContractMetadata("recursive_handoff_blocked")
      }
    });
  }

  return {
    ...withOperatorExecutionMetadata(decision, "runtime_handoff"),
    action: "app",
    originalAction: decision.originalAction || decision.original_action || "operator",
    original_action: decision.original_action || decision.originalAction || "operator",
    routingMode: "operator",
    routing_mode: "operator",
    appRef,
    operatorAppRef: appRef,
    operator_app_ref: appRef,
    source,
    reason: decision.reason || "operator_runtime_handoff"
  };
}

function ensureExecutableLocalDecision(decision, inbound, source) {
  if (decision.action === "reject") return decision;

  if (decision.action === "app" || decision.action === "ai") {
    const aiTarget = decision.action === "ai" ? getAiAppRef(decision) : {};
    const appRef = decision.action === "ai" ? aiTarget.appRef : getAppRef(decision);
    if (!appRef) {
      return buildRejectDecision({
        inbound,
        reason: `missing_${decision.action}_app_ref`,
        source: `${source || "local_default_fallback"}_downgraded`,
        message:
          "This route is not executable because no Fonoster application ref is configured.",
        extra: { originalAction: decision.action }
      });
    }

    if (isRuntimeAppRef(appRef, inbound, decision.action)) {
      return buildRejectDecision({
        inbound,
        reason: "recursive_runtime_app_ref",
        source: `${source || "local_default_fallback"}_downgraded`,
        extra: {
          originalAction: decision.action,
          appRef
        }
      });
    }

    if (decision.action === "ai" && isAiTransitionPathBlocked(appRef, inbound)) {
      return buildRejectDecision({
        inbound,
        reason: "ai_direct_app_executor_required",
        source: `${source || "local_default_fallback"}_downgraded`,
        message:
          "AI direct app executor is enabled and child handoff fallback is disabled.",
        extra: {
          originalAction: decision.action,
          appRef,
          selectedAppRef: appRef,
          selected_app_ref: appRef,
          topology: getAiTopology(appRef, inbound)
        }
      });
    }

    return {
      ...(decision.action === "ai"
        ? withAiExecutionMetadata(decision, appRef, inbound)
        : { ...decision, appRef }),
      ...(decision.action === "ai"
        ? {
            aiMode: aiTarget.aiMode,
            ai_mode: aiTarget.aiMode,
            aiModeFallback: aiTarget.aiModeFallback,
            ai_mode_fallback: aiTarget.aiModeFallback
          }
        : {})
    };
  }

  if (decision.action === "operator") {
    const executableDecision = withDefaultOperatorTarget(decision);

    if (hasOperatorRuntimeTarget(executableDecision)) {
      return buildOperatorRuntimeHandoffDecision(
        executableDecision,
        inbound,
        source || "operator_runtime"
      );
    }

    if (hasOperatorTarget(executableDecision)) {
      return withOperatorExecutionMetadata(executableDecision, "direct_bridge");
    }

    return buildRejectDecision({
      inbound,
      reason: "missing_operator_agent_aor",
      source: `${source || "local_default_fallback"}_downgraded`,
      message:
        "This route is not executable because no operator SIP AOR is configured.",
      extra: { originalAction: decision.action }
    });
  }

  return buildRejectDecision({
    inbound,
    reason: "unsupported_local_action",
    source: `${source || "local_default_fallback"}_downgraded`,
    extra: { originalAction: decision.action }
  });
}

function buildFallbackDecision(inbound, reason, source) {
  const action = normalizeDecisionAction(config.defaults.inboundAction);
  const decisionSource = source || "local_default_fallback";

  switch (action) {
    case "app":
      return ensureExecutableLocalDecision(
        {
          action: "app",
          appRef: config.defaults.appRef || config.defaults.aiAppRef || null,
          reason: reason || "default_app_route",
          source: decisionSource,
          inbound
        },
        inbound,
        decisionSource
      );
    case "ai":
      return ensureExecutableLocalDecision(
        {
          action: "ai",
          aiMode: config.defaults.aiMode,
          reason: reason || "default_ai_route",
          source: decisionSource,
          inbound
        },
        inbound,
        decisionSource
      );
    case "operator":
      return ensureExecutableLocalDecision(
        {
          action: "operator",
          agentAor: config.defaults.operatorAgentAor || null,
          reason: reason || "default_operator_route",
          source: decisionSource,
          inbound
        },
        inbound,
        decisionSource
      );
    case "reject":
    default:
      return buildRejectDecision({
        inbound,
        answer: false,
        message: config.defaults.rejectMessage,
        reason: reason || "default_reject_route",
        source: decisionSource
      });
  }
}

function buildUpstreamUnavailableDecision(inbound, reason, source) {
  return buildRejectDecision({
    inbound,
    answer: false,
    message: "",
    reason: reason || "onelink_unreachable",
    source: source || "onelink_unavailable"
  });
}

function buildNativeFallbackDecision(inbound, upstreamDecision) {
  const upstreamReason = upstreamDecision?.reason || "upstream_reject";
  const decision = buildFallbackDecision(
    inbound,
    `native_fallback_${upstreamReason}`,
    "local_native_fallback"
  );

  return {
    ...decision,
    upstreamDecision: summarizeDecision(upstreamDecision)
  };
}

function normalizeUpstreamDecision(decision, inbound, source) {
  if (!decision || typeof decision !== "object") {
    return buildFallbackDecision(inbound, "empty_upstream_decision", source);
  }

  const normalizedAction = normalizeDecisionAction(decision.action);
  const normalized = {
    ...decision,
    action: normalizedAction,
    source: source || "onelink",
    reason: decision.reason || `${source || "onelink"}_decision`,
    inbound
  };

  if (normalized.action === "reject") {
    return {
      ...normalized,
      answer: shouldAnswerReject(decision),
      message: shouldAnswerReject(decision) ? normalized.message || "" : ""
    };
  }

  if (
    normalized.action === "operator" ||
    normalized.action === "app" ||
    normalized.action === "ai"
  ) {
    const aiTarget = normalized.action === "ai" ? getAiAppRef(normalized) : {};
    const appRef = normalized.action === "ai" ? aiTarget.appRef : getAppRef(normalized);

    if (
      (normalized.action === "app" || normalized.action === "ai") &&
      appRef &&
      isRuntimeAppRef(appRef, inbound, normalized.action)
    ) {
      return buildRejectDecision({
        inbound,
        reason: "recursive_runtime_app_ref",
        source: `${source || "onelink"}_downgraded`,
        extra: {
          originalAction: normalized.action,
          appRef
        }
      });
    }

    if (normalized.action === "ai" && isAiTransitionPathBlocked(appRef, inbound)) {
      return buildRejectDecision({
        inbound,
        reason: "ai_direct_app_executor_required",
        source: `${source || "onelink"}_downgraded`,
        message:
          "AI direct app executor is enabled and child handoff fallback is disabled.",
        extra: {
          originalAction: normalized.action,
          appRef,
          selectedAppRef: appRef,
          selected_app_ref: appRef,
          topology: getAiTopology(appRef, inbound)
        }
      });
    }

    if (normalized.action === "operator") {
      const executableDecision = withDefaultOperatorTarget(normalized);

      if (hasOperatorRuntimeTarget(executableDecision)) {
        return buildOperatorRuntimeHandoffDecision(
          executableDecision,
          inbound,
          source || "onelink"
        );
      }

      if (hasOperatorTarget(executableDecision)) {
        return withOperatorExecutionMetadata(executableDecision, "direct_bridge");
      }

      return buildRejectDecision({
        inbound,
        message:
          normalized.message ||
          "This route is not executable on the current Fonoster runtime.",
        reason: "unsupported_operator_route",
        source: `${source || "onelink"}_downgraded`,
        extra: {
          originalAction: normalized.action
        }
      });
    }

    if (hasExecutableTarget(normalized)) {
      return normalized.action === "ai"
        ? {
            ...withAiExecutionMetadata(normalized, appRef, inbound),
            aiMode: aiTarget.aiMode,
            ai_mode: aiTarget.aiMode,
            aiModeFallback: aiTarget.aiModeFallback,
            ai_mode_fallback: aiTarget.aiModeFallback
          }
        : normalized;
    }

    return buildRejectDecision({
      inbound,
      message:
        normalized.message ||
        "This route is not executable on the current Fonoster runtime.",
      reason: `unsupported_${normalized.action}_route`,
      source: `${source || "onelink"}_downgraded`,
      extra: {
        originalAction: normalized.action,
        appRef: appRef || null
      }
    });
  }

  return buildFallbackDecision(
    inbound,
    "unsupported_upstream_action",
    `${source || "onelink"}_fallback`
  );
}

async function buildInboundDecision({ inbound, chatwootContext }) {
  if (
    config.defaults.nativeRouteEnabled &&
    config.defaults.nativeRoutePreferLocal
  ) {
    return buildFallbackDecision(
      inbound,
      "native_route_preferred",
      "local_native"
    );
  }

  if (chatwootContext?.decision) {
    const decision = normalizeUpstreamDecision(
      chatwootContext.decision,
      inbound,
      chatwootContext.source || "onelink"
    );

    if (
      config.defaults.nativeRouteEnabled &&
      decision.action === "reject" &&
      isNativeFallbackReason(decision.reason)
    ) {
      return buildNativeFallbackDecision(inbound, decision);
    }

    return decision;
  }

  if (chatwootContext?.configured) {
    if (config.defaults.nativeRouteEnabled) {
      return buildFallbackDecision(
        inbound,
        `native_fallback_${chatwootContext?.error?.type || "onelink_unreachable"}`,
        "local_native_fallback"
      );
    }

    return buildUpstreamUnavailableDecision(
      inbound,
      chatwootContext?.error?.type || "onelink_unreachable",
      chatwootContext?.source || "local_default_fallback"
    );
  }

  return buildFallbackDecision(inbound, undefined, "not_configured");
}


function getPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeCallDirection(rawDirection) {
  const normalized = String(rawDirection || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (["outbound", "to_pstn", "pstn_outbound", "api_originated", "api_originated_outbound"].includes(normalized)) {
    return "outbound";
  }

  if (["inbound", "from_pstn", "pstn_inbound"].includes(normalized)) {
    return "inbound";
  }

  return normalized;
}

function outboundRuntimeMetadata(inbound = {}) {
  return getPlainObject(inbound.metadata);
}

function outboundRuntimeDirection(inbound = {}) {
  const metadata = outboundRuntimeMetadata(inbound);
  return normalizeCallDirection(firstNonEmpty(
    inbound.direction,
    inbound.callDirection,
    inbound.call_direction,
    metadata.call_direction,
    metadata.callDirection,
    metadata.direction
  ));
}

function isOutboundRuntimeRoute(inbound = {}) {
  return outboundRuntimeDirection(inbound) === "outbound";
}

function outboundExplicitOperatorAgentAor(inbound = {}, metadata = outboundRuntimeMetadata(inbound)) {
  return firstNonEmpty(
    inbound.operatorAgentAor,
    inbound.operator_agent_aor,
    metadata.operator_agent_aor,
    metadata.operatorAgentAor,
    metadata.agent_aor,
    metadata.agentAor
  );
}

function outboundOperatorAgentAor(inbound = {}, metadata = outboundRuntimeMetadata(inbound)) {
  return firstNonEmpty(
    outboundExplicitOperatorAgentAor(inbound, metadata),
    config.defaults.operatorAgentAor
  );
}

function outboundOperatorAgentRef(inbound = {}, metadata = outboundRuntimeMetadata(inbound)) {
  return firstNonEmpty(
    inbound.operatorAgentRef,
    inbound.operator_agent_ref,
    metadata.operator_agent_ref,
    metadata.operatorAgentRef,
    metadata.fonoster_agent_ref,
    metadata.fonosterAgentRef
  );
}

function truthyMetadataFlag(value) {
  return ["1", "true", "yes", "on"].includes(
    String(value || "").trim().toLowerCase()
  );
}

function isOperatorFirstOutbound(inbound = {}, metadata = outboundRuntimeMetadata(inbound)) {
  const explicitlyAllowed = truthyMetadataFlag(firstNonEmpty(
    inbound.allowOperatorFirstOutbound,
    inbound.allow_operator_first_outbound,
    metadata.allowOperatorFirstOutbound,
    metadata.allow_operator_first_outbound,
    process.env.TELEPHONY_BRIDGE_OPERATOR_FIRST_OUTBOUND_ENABLED
  ));
  if (!explicitlyAllowed) return false;

  return truthyMetadataFlag(firstNonEmpty(
    inbound.operatorFirstOutbound,
    inbound.operator_first_outbound,
    metadata.operatorFirstOutbound,
    metadata.operator_first_outbound
  ));
}

function outboundTargetNumber(inbound = {}, metadata = outboundRuntimeMetadata(inbound)) {
  return firstNonEmpty(
    inbound.outboundTargetNumber,
    inbound.outbound_target_number,
    inbound.targetNumber,
    inbound.target_number,
    inbound.customerNumber,
    inbound.customer_number,
    inbound.originalTo,
    inbound.original_to,
    metadata.outboundTargetNumber,
    metadata.outbound_target_number,
    metadata.targetNumber,
    metadata.target_number,
    metadata.customerNumber,
    metadata.customer_number,
    metadata.originalTo,
    metadata.original_to
  );
}

function hasOutboundOperatorHint(inbound = {}, metadata = outboundRuntimeMetadata(inbound)) {
  return Boolean(
    outboundExplicitOperatorAgentAor(inbound, metadata) ||
      outboundOperatorAgentRef(inbound, metadata)
  );
}

function inferOutboundRuntimeMode(inbound = {}) {
  const metadata = outboundRuntimeMetadata(inbound);
  const explicitMode = firstNonEmpty(
    inbound.routingMode,
    inbound.routing_mode,
    metadata.routing_mode,
    metadata.routingMode,
    metadata.mode
  );
  const normalizedMode = explicitMode ? normalizeDecisionAction(explicitMode) : "";

  if (
    hasOutboundOperatorHint(inbound, metadata) &&
    (!normalizedMode || normalizedMode === "app" || normalizedMode === "reject")
  ) {
    return "operator";
  }

  if (["operator", "ai", "app"].includes(normalizedMode)) {
    return normalizedMode;
  }

  return "";
}

function buildOutboundRuntimeDecision(inbound = {}) {
  if (!isOutboundRuntimeRoute(inbound)) return null;

  const metadata = outboundRuntimeMetadata(inbound);
  const routingMode = inferOutboundRuntimeMode(inbound);
  const source = "local_outbound_runtime";

  if (routingMode === "operator") {
    const agentAor = outboundOperatorAgentAor(inbound, metadata);
    const agentRef = outboundOperatorAgentRef(inbound, metadata);
    const targetNumber = outboundTargetNumber(inbound, metadata);

    if (isOperatorFirstOutbound(inbound, metadata)) {
      if (!targetNumber) {
        return buildRejectDecision({
          inbound,
          reason: "missing_outbound_target_number",
          source: `${source}_downgraded`,
          message:
            "This outbound operator route is not executable because no target number is configured.",
          extra: {
            originalAction: "operator",
            routingMode: "operator",
            routing_mode: "operator"
          }
        });
      }

      return withOperatorExecutionMetadata(
        {
          action: "outbound_target",
          originalAction: "operator",
          original_action: "operator",
          routingMode: "operator",
          routing_mode: "operator",
          destination: targetNumber,
          phoneNumber: targetNumber,
          phone_number: targetNumber,
          outboundTargetNumber: targetNumber,
          outbound_target_number: targetNumber,
          agentAor: agentAor || null,
          agent_aor: agentAor || null,
          operatorAgentRef: agentRef || null,
          operator_agent_ref: agentRef || null,
          callDirection: "outbound",
          call_direction: "outbound",
          answer: true,
          answerBeforeDial: true,
          answer_before_dial: true,
          reason: "operator_first_outbound_route",
          source,
          inbound,
          metadata
        },
        "runtime_handoff",
        {
          operatorOutboundTargetFirstClass: true,
          operator_outbound_target_first_class: true
        }
      );
    }

    return ensureExecutableLocalDecision(
      {
        action: "operator",
        routingMode: "operator",
        routing_mode: "operator",
        agentAor: agentAor || null,
        agent_aor: agentAor || null,
        operatorAgentRef: agentRef || null,
        operator_agent_ref: agentRef || null,
        answer: false,
        answerBeforeDial: false,
        answer_before_dial: false,
        reason: "outbound_runtime_route",
        source,
        inbound,
        metadata
      },
      inbound,
      source
    );
  }

  if (routingMode === "ai") {
    return ensureExecutableLocalDecision(
      {
        action: "ai",
        aiMode: metadata.ai_mode || metadata.aiMode || undefined,
        aiAppRef: metadata.ai_app_ref || metadata.aiAppRef || undefined,
        reason: "outbound_runtime_route",
        source,
        inbound,
        metadata
      },
      inbound,
      source
    );
  }

  if (routingMode === "app") {
    const appRef = firstNonEmpty(
      metadata.target_app_ref,
      metadata.targetAppRef,
      metadata.application_ref,
      metadata.applicationRef,
      metadata.app_ref,
      metadata.appRef
    );

    if (!appRef || isRuntimeAppRef(appRef, inbound, "app")) {
      return null;
    }

    return ensureExecutableLocalDecision(
      {
        action: "app",
        appRef,
        app_ref: appRef,
        reason: "outbound_runtime_route",
        source,
        inbound,
        metadata
      },
      inbound,
      source
    );
  }

  return null;
}

function buildOutboundAppRefDecision(body) {
  const requestedModeValue = firstNonEmpty(
    body.routingMode,
    body.routing_mode,
    body.mode
  );
  const requestedMode = requestedModeValue ? normalizeDecisionAction(requestedModeValue) : "";
  const explicitAppRef = firstNonEmpty(
    body.app_ref,
    body.appRef,
    body.application_ref,
    body.applicationRef
  );

  if (explicitAppRef) {
    return {
      appRef: explicitAppRef,
      routingMode: requestedMode || ""
    };
  }

  if (requestedMode === "operator") {
    return {
      appRef: getOperatorAppRef(body),
      routingMode: "operator"
    };
  }

  if (
    requestedMode === "ai" ||
    body.ai_enabled === true ||
    body.aiEnabled === true
  ) {
    return {
      ...getAiAppRef(body),
      routingMode: "ai"
    };
  }

  if (requestedMode === "app") {
    return {
      appRef: config.defaults.appRef || "",
      routingMode: "app"
    };
  }

  return { appRef: "" };
}

module.exports = { buildInboundDecision, buildOutboundAppRefDecision, buildOutboundRuntimeDecision };
