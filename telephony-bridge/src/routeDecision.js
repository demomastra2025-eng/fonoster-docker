const { config } = require("./config");

function hasExecutableTarget(decision) {
  return Boolean(
    decision?.destination ||
      decision?.phone_number ||
      decision?.phoneNumber ||
      decision?.agent_aor ||
      decision?.agentAor ||
      decision?.appRef ||
      decision?.app_ref
  );
}

function getAppRef(decision) {
  return String(decision?.appRef || decision?.app_ref || "").trim();
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

function isRuntimeAppRef(appRef, inbound) {
  const normalized = String(appRef || "").trim();
  if (!normalized) return false;

  const inboundAppRef = String(inbound?.appRef || inbound?.app_ref || "").trim();
  const configuredRuntimeAppRef = String(config.defaults.runtimeAppRef || "").trim();

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

  return {
    action: decision.action || null,
    reason: decision.reason || null,
    source: decision.source || null,
    appRef: getAppRef(decision) || null,
    agentAor: decision.agentAor || decision.agent_aor || null,
    destination: decision.destination || decision.phoneNumber || decision.phone_number || null
  };
}

function ensureExecutableLocalDecision(decision, inbound, source) {
  if (decision.action === "reject") return decision;

  if (decision.action === "app" || decision.action === "ai") {
    const appRef = getAppRef(decision);
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

    if (isRuntimeAppRef(appRef, inbound)) {
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

    return {
      ...decision,
      appRef
    };
  }

  if (decision.action === "operator") {
    const executableDecision = withDefaultOperatorTarget(decision);
    if (hasOperatorTarget(executableDecision)) return executableDecision;

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
          appRef: config.defaults.aiAppRef || null,
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
    const appRef = getAppRef(normalized);

    if (
      (normalized.action === "app" || normalized.action === "ai") &&
      appRef &&
      isRuntimeAppRef(appRef, inbound)
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

    if (normalized.action === "operator") {
      const executableDecision = withDefaultOperatorTarget(normalized);
      if (hasOperatorTarget(executableDecision)) {
        return executableDecision;
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
      return normalized;
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

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }

  return "";
}

function buildOutboundAppRefDecision(body) {
  const explicitAppRef = firstNonEmpty(
    body.app_ref,
    body.appRef,
    body.application_ref,
    body.applicationRef
  );

  if (explicitAppRef) {
    return {
      appRef: explicitAppRef
    };
  }

  if (body.ai_enabled === true || body.aiEnabled === true) {
    return {
      appRef: firstNonEmpty(
        body.ai_app_ref,
        body.aiAppRef,
        config.defaults.aiAppRef
      )
    };
  }

  return { appRef: "" };
}

module.exports = { buildInboundDecision, buildOutboundAppRefDecision };
