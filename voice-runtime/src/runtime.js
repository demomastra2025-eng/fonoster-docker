const bridgeClient = require("./bridgeClient");
const { config } = require("./config");
const { logger } = require("./logger");
const { randomUUID } = require("node:crypto");

function buildInbound(req) {
  return {
    appRef: req.appRef || null,
    callRef: req.callRef || null,
    mediaSessionRef: req.mediaSessionRef || null,
    ingressNumber: req.ingressNumber || null,
    callerNumber: req.callerNumber || null,
    callerName: req.callerName || null,
    direction: req.callDirection || null,
    selfEndpoint: req.selfEndpoint || null,
    receivedAt: new Date().toISOString(),
    metadata: req.metadata || {}
  };
}

function extractAgentUser(agentAor) {
  if (!agentAor) return "";
  const trimmed = String(agentAor).trim();

  if (!trimmed.startsWith("sip:")) return trimmed;

  const withoutScheme = trimmed.slice(4);
  const atIndex = withoutScheme.indexOf("@");
  return atIndex >= 0 ? withoutScheme.slice(0, atIndex) : withoutScheme;
}

function resolveDialTarget(decision) {
  if (decision.destination) return String(decision.destination).trim();
  if (decision.phoneNumber) return String(decision.phoneNumber).trim();
  if (decision.agentAor) return extractAgentUser(decision.agentAor);
  return "";
}

function resolveAppTarget(decision) {
  if (!decision.appRef) return "";
  return `app:${String(decision.appRef).trim()}`;
}

const DIAL_STATUS_MAP = {
  ANSWER: "answered",
  IN_PROGRESS: "answered",
  RINGING: "ringing",
  NOANSWER: "no-answer",
  NO_ANSWER: "no-answer",
  BUSY: "busy",
  FAILED: "failed",
  CANCEL: "failed",
  CANCELED: "failed",
  CANCELLED: "failed",
  COMPLETED: "completed"
};

const TERMINAL_DIAL_STATUSES = new Set([
  "busy",
  "no-answer",
  "failed"
]);

function normalizeDialStatus(status) {
  const raw = String(status || "").trim();

  if (!raw) return "";

  const key = raw.toUpperCase().replace(/[\s-]+/g, "_");

  return DIAL_STATUS_MAP[key] || raw.toLowerCase().replace(/[\s_]+/g, "-");
}

function sanitizeDecision(decision) {
  if (!decision || typeof decision !== "object") {
    return {
      action: "reject",
      answer: false,
      message: ""
    };
  }

  const action = decision.action || "reject";
  const explicitlyAnswered =
    decision.answer === true ||
    decision.answerCall === true ||
    decision.answer_call === true;
  const explicitlyNotAnswered =
    decision.answer === false ||
    decision.answerCall === false ||
    decision.answer_call === false;

  return {
    action,
    answer:
      explicitlyNotAnswered || (action === "reject" && !explicitlyAnswered)
        ? false
        : true,
    reason: decision.reason || null,
    message: decision.message || "",
    transferMessage:
      decision.transferMessage || decision.transfer_message || "",
    timeout: decision.timeout || 60,
    appRef: decision.appRef || decision.app_ref || "",
    agentAor: decision.agentAor || decision.agent_aor || "",
    destination: decision.destination || "",
    phoneNumber: decision.phoneNumber || decision.phone_number || "",
    idempotencyKey:
      decision.idempotencyKey || decision.idempotency_key || ""
  };
}

function resolveRuntimeContext(req = {}) {
  const metadata = req.metadata && typeof req.metadata === "object" ? req.metadata : {};

  return {
    requestId:
      req.requestId ||
      metadata.request_id ||
      metadata.requestId ||
      randomUUID(),
    accountId:
      req.accountId ||
      metadata.account_id ||
      metadata.accountId ||
      metadata.account ||
      "",
    idempotencyKey:
      req.idempotencyKey ||
      req.idempotency_key ||
      metadata.idempotencyKey ||
      metadata.idempotency_key ||
      ""
  };
}

async function emitBridgeEvent(bridge, event, context = {}) {
  const eventContext = {
    requestId: context.requestId || event.requestId || "",
    accountId: context.accountId || event.accountId || "",
    idempotencyKey:
      context.idempotencyKey ||
      event.idempotencyKey ||
      event.idempotency_key ||
      ""
  };

  try {
    await bridge.emitVoiceEvent(
      { ...event, ...eventContext },
      {
        requestId: eventContext.requestId,
        accountId: eventContext.accountId,
        idempotencyKey: eventContext.idempotencyKey
      }
    );
  } catch (error) {
    logger.error("failed to emit runtime event", {
      eventType: event.eventType,
      callRef: event.callRef,
      type: error.type || "unknown",
      message: error.message
    });
  }
}

async function sayAndHangup(voice, message) {
  await voice.answer();
  if (message) {
    await voice.say(message);
  }
  await voice.hangup();
}

async function hangupWithoutAnswer(voice) {
  await voice.hangup();
}

async function handleOperatorRoute({ inbound, decision, voice, bridge, context }) {
  const destination = resolveDialTarget(decision);

  if (!destination) {
    throw new Error("operator decision did not include a dialable destination");
  }

  await voice.answer();

  await emitBridgeEvent(bridge, {
    eventType: "answered",
    callRef: inbound.callRef,
    mediaSessionRef: inbound.mediaSessionRef,
    action: decision.action,
    destination,
    ...context
  });

  const transferMessage =
    decision.transferMessage || config.defaultTransferMessage;

  if (transferMessage) {
    await voice.say(transferMessage);
  }

  const stream = await voice.dial(destination, {
    timeout: decision.timeout
  });

  stream.on((status) => {
    const normalizedStatus = normalizeDialStatus(status);

    logger.info("dial status update", {
      callRef: inbound.callRef,
      destination,
      status: normalizedStatus,
      rawStatus: status
    });

    void emitBridgeEvent(bridge, {
      eventType: "dial_status",
      callRef: inbound.callRef,
      mediaSessionRef: inbound.mediaSessionRef,
      action: decision.action,
      destination,
      status: normalizedStatus,
      rawStatus: status,
      raw_status: status,
      ...context
    });

    if (normalizedStatus === "answered") {
      void emitBridgeEvent(bridge, {
        eventType: "answered",
        callRef: inbound.callRef,
        mediaSessionRef: inbound.mediaSessionRef,
        action: decision.action,
        destination,
        ...context
      });
    }

    if (TERMINAL_DIAL_STATUSES.has(normalizedStatus)) {
      void emitBridgeEvent(bridge, {
        eventType: "session_completed",
        callRef: inbound.callRef,
        mediaSessionRef: inbound.mediaSessionRef,
        outcome: normalizedStatus,
        action: decision.action,
        destination,
        rawStatus: status,
        raw_status: status,
        ...context
      });
    }
  });
}

async function handleAppRoute({ inbound, decision, voice, bridge, context }) {
  const destination = resolveAppTarget(decision);

  if (!destination) {
    throw new Error("app decision did not include an executable appRef");
  }

  await voice.answer();

  await emitBridgeEvent(bridge, {
    eventType: "answered",
    callRef: inbound.callRef,
    mediaSessionRef: inbound.mediaSessionRef,
    action: decision.action,
    appRef: decision.appRef,
    destination,
    ...context
  });

  if (decision.transferMessage) {
    await voice.say(decision.transferMessage);
  }

  const stream = await voice.dial(destination, {
    timeout: decision.timeout
  });

  stream.on((status) => {
    const normalizedStatus = normalizeDialStatus(status);

    logger.info("app dial status update", {
      callRef: inbound.callRef,
      appRef: decision.appRef,
      status: normalizedStatus,
      rawStatus: status
    });

    void emitBridgeEvent(bridge, {
      eventType: "dial_status",
      callRef: inbound.callRef,
      mediaSessionRef: inbound.mediaSessionRef,
      action: decision.action,
      appRef: decision.appRef,
      destination,
      status: normalizedStatus,
      rawStatus: status,
      raw_status: status,
      ...context
    });

    if (normalizedStatus === "answered") {
      void emitBridgeEvent(bridge, {
        eventType: "answered",
        callRef: inbound.callRef,
        mediaSessionRef: inbound.mediaSessionRef,
        action: decision.action,
        appRef: decision.appRef,
        destination,
        ...context
      });
    }

    if (TERMINAL_DIAL_STATUSES.has(normalizedStatus)) {
      void emitBridgeEvent(bridge, {
        eventType: "session_completed",
        callRef: inbound.callRef,
        mediaSessionRef: inbound.mediaSessionRef,
        outcome: normalizedStatus,
        action: decision.action,
        appRef: decision.appRef,
        destination,
        rawStatus: status,
        raw_status: status,
        ...context
      });
    }
  });
}

async function handleUnsupportedBridgeAction({ inbound, decision, voice, bridge, context }) {
  logger.warn("runtime received unsupported direct app handoff", {
    callRef: inbound.callRef,
    action: decision.action,
    appRef: decision.appRef
  });

  await emitBridgeEvent(bridge, {
    eventType: "unsupported_action",
    callRef: inbound.callRef,
    mediaSessionRef: inbound.mediaSessionRef,
    action: decision.action,
    appRef: decision.appRef,
    ...context
  });

  await sayAndHangup(
    voice,
    decision.message || config.unsupportedActionMessage
  );
}

async function handleIncomingCall(req, voice, deps = {}) {
  const bridge = deps.bridge || bridgeClient;
  const inbound = buildInbound(req);
  const runtimeContext = resolveRuntimeContext(req);

  logger.info("received inbound voice session", {
    callRef: inbound.callRef,
    ingressNumber: inbound.ingressNumber,
    callerNumber: inbound.callerNumber,
    appRef: inbound.appRef,
    requestId: runtimeContext.requestId || null,
    accountId: runtimeContext.accountId || null
  });

  await emitBridgeEvent(bridge, {
    eventType: "session_started",
    callRef: inbound.callRef,
    mediaSessionRef: inbound.mediaSessionRef,
    ingressNumber: inbound.ingressNumber,
    callerNumber: inbound.callerNumber,
    appRef: inbound.appRef,
    direction: inbound.direction,
    metadata: inbound.metadata,
    ...runtimeContext
  });

  try {
    const decision = sanitizeDecision(
      await bridge.fetchInboundDecision(inbound, {
        accountId: runtimeContext.accountId,
        requestId: runtimeContext.requestId,
        idempotencyKey: runtimeContext.idempotencyKey
      })
    );

    logger.info("received bridge decision", {
      callRef: inbound.callRef,
      action: decision.action,
      reason: decision.reason
    });

    await emitBridgeEvent(bridge, {
      eventType: "decision_received",
      callRef: inbound.callRef,
      mediaSessionRef: inbound.mediaSessionRef,
      decision,
      ...runtimeContext
    });

    switch (decision.action) {
      case "operator":
        await handleOperatorRoute({
          inbound,
          decision,
          voice,
          bridge,
          context: runtimeContext
        });
        return;
      case "ai-agent":
      case "app":
      case "ai":
        if (decision.appRef) {
          await handleAppRoute({
            inbound,
            decision,
            voice,
            bridge,
            context: runtimeContext
          });
          return;
        }

        if (resolveDialTarget(decision)) {
          await handleOperatorRoute({
            inbound,
            decision,
            voice,
            bridge,
            context: runtimeContext
          });
          return;
        }

        await handleUnsupportedBridgeAction({
          inbound,
          decision,
          voice,
          bridge,
          context: runtimeContext
        });
        return;
      case "reject":
      default:
        if (decision.answer === false) {
          await hangupWithoutAnswer(voice);
        } else {
          await sayAndHangup(
            voice,
            decision.message || config.defaultFailureMessage
          );
        }

        await emitBridgeEvent(bridge, {
          eventType: decision.answer === false ? "rejected" : "answered",
          callRef: inbound.callRef,
          mediaSessionRef: inbound.mediaSessionRef,
          action: "reject",
          ...runtimeContext
        });

        await emitBridgeEvent(bridge, {
          eventType: "session_completed",
          callRef: inbound.callRef,
          mediaSessionRef: inbound.mediaSessionRef,
          outcome:
            decision.answer === false ? "rejected_without_answer" : "rejected",
          ...runtimeContext
        });
        return;
    }
  } catch (error) {
    logger.error("voice runtime failed", {
      callRef: inbound.callRef,
      message: error.message,
      stack: error.stack
    });

    await emitBridgeEvent(bridge, {
      eventType: "session_failed",
      callRef: inbound.callRef,
      mediaSessionRef: inbound.mediaSessionRef,
      error: error.message,
      ...runtimeContext
    });

    try {
      await hangupWithoutAnswer(voice);
    } catch (secondaryError) {
      logger.error("failed to hang up failed voice session", {
        callRef: inbound.callRef,
        message: secondaryError.message
      });
    }
  }
}

module.exports = {
  buildInbound,
  emitBridgeEvent,
  extractAgentUser,
  normalizeDialStatus,
  resolveDialTarget,
  sanitizeDecision,
  handleIncomingCall
};
