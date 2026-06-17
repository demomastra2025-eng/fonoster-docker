const { config } = require("./config");
const { logger } = require("./logger");
const {
  getCachedDecision,
  setCachedDecision,
  invalidateRouteCache,
  getCacheStatus
} = require("./routeCache");

const stateByBaseUrl = new Map();

function stateForBaseUrl(baseUrl) {
  const key = baseUrl || "default";
  if (!stateByBaseUrl.has(key)) {
    stateByBaseUrl.set(key, { consecutiveFailures: 0, circuitOpenedUntil: 0 });
  }
  return stateByBaseUrl.get(key);
}

function normalizedBaseUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function requestBaseUrl(options = {}) {
  return normalizedBaseUrl(options.baseUrl || options.onelinkBaseUrl || config.onelink.baseUrl);
}

function isConfigured(options = {}) {
  return Boolean(requestBaseUrl(options));
}

function isCircuitOpen(options = {}) {
  return stateForBaseUrl(requestBaseUrl(options)).circuitOpenedUntil > Date.now();
}

function openCircuit(options = {}) {
  stateForBaseUrl(requestBaseUrl(options)).circuitOpenedUntil = Date.now() + config.onelink.circuitResetMs;
}

function resetCircuit(options = {}) {
  const current = stateForBaseUrl(requestBaseUrl(options));
  current.consecutiveFailures = 0;
  current.circuitOpenedUntil = 0;
}

function buildCompatibilityPayload(payload = {}) {
  const metadata = payload.metadata && typeof payload.metadata === "object"
    ? payload.metadata
    : {};
  const bridgeCallRef =
    payload.bridge_call_ref ||
    payload.bridgeCallRef ||
    payload.parent_call_ref ||
    payload.parentCallRef ||
    payload.provider_call_id ||
    payload.providerCallId ||
    payload.call_ref ||
    payload.callRef ||
    null;
  const runtimeCallRef =
    payload.runtime_call_ref ||
    payload.runtimeCallRef ||
    payload.child_call_ref ||
    payload.childCallRef ||
    null;
  const numberRef =
    payload.number_ref ||
    payload.numberRef ||
    metadata.number_ref ||
    metadata.numberRef ||
    metadata.onelink_number_ref ||
    metadata.onelinkNumberRef ||
    null;
  const inboxId =
    payload.inbox_id ||
    payload.inboxId ||
    metadata.inbox_id ||
    metadata.inboxId ||
    metadata.chatwoot_inbox_id ||
    metadata.chatwootInboxId ||
    null;

  return {
    ...payload,
    ...(bridgeCallRef && payload.call_ref && payload.call_ref !== bridgeCallRef
      ? { legacy_call_ref: payload.call_ref, legacyCallRef: payload.call_ref }
      : {}),
    call_ref: bridgeCallRef,
    callRef: bridgeCallRef,
    bridge_call_ref: bridgeCallRef,
    bridgeCallRef: bridgeCallRef,
    parent_call_ref: payload.parent_call_ref || bridgeCallRef,
    parentCallRef: payload.parentCallRef || bridgeCallRef,
    provider_call_id: payload.provider_call_id || bridgeCallRef,
    providerCallId: payload.providerCallId || bridgeCallRef,
    runtime_call_ref: runtimeCallRef,
    runtimeCallRef: runtimeCallRef,
    child_call_ref: payload.child_call_ref || runtimeCallRef,
    childCallRef: payload.childCallRef || runtimeCallRef,
    media_session_ref: payload.media_session_ref || payload.mediaSessionRef || null,
    mediaSessionRef: payload.mediaSessionRef || payload.media_session_ref || null,
    app_ref: payload.app_ref || payload.appRef || null,
    appRef: payload.appRef || payload.app_ref || null,
    ingress_number: payload.ingress_number || payload.ingressNumber || null,
    ingressNumber: payload.ingressNumber || payload.ingress_number || null,
    caller_number: payload.caller_number || payload.callerNumber || null,
    callerNumber: payload.callerNumber || payload.caller_number || null,
    received_at: payload.received_at || payload.receivedAt || null,
    receivedAt: payload.receivedAt || payload.received_at || null,
    ...(numberRef ? { number_ref: numberRef, numberRef } : {}),
    ...(inboxId ? { inbox_id: inboxId, inboxId } : {}),
    metadata
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyError({ response, payload, error }) {
  const classified = new Error(
    error?.message ||
      payload?.error ||
      `onelink request failed (${response?.status || "unknown"})`
  );

  if (error?.name === "AbortError") {
    classified.type = "timeout";
    classified.retryable = true;
    return classified;
  }

  if (response?.status === 401 || response?.status === 403) {
    classified.type = "auth_failure";
    classified.retryable = false;
    return classified;
  }

  if (response?.status >= 400 && response?.status < 500) {
    classified.type = "bad_payload";
    classified.retryable = false;
    return classified;
  }

  classified.type = "upstream_unavailable";
  classified.retryable = true;
  return classified;
}

function parseBody(text) {
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch (_error) {
    return {
      error: text,
      _parseError: true
    };
  }
}

function buildRequestHeaders({ accountId, requestId, idempotencyKey } = {}) {
  const selectedAccountId = accountId || config.onelink.accountId || "";

  return {
    "content-type": "application/json",
    ...(config.onelink.accessToken
      ? {
          authorization: `Bearer ${config.onelink.accessToken}`,
          "x-bridge-secret": config.onelink.accessToken
        }
      : {}),
    ...(selectedAccountId ? { "x-account-id": selectedAccountId } : {}),
    ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
    ...(requestId ? { "x-request-id": requestId } : {})
  };
}

function getStatus() {
  const defaultState = stateForBaseUrl(requestBaseUrl());
  return {
    configured: isConfigured(),
    circuitOpen: isCircuitOpen(),
    circuitOpenedUntil:
      defaultState.circuitOpenedUntil > 0
        ? new Date(defaultState.circuitOpenedUntil).toISOString()
        : null,
    consecutiveFailures: defaultState.consecutiveFailures,
    circuits: Array.from(stateByBaseUrl.entries()).map(([baseUrl, current]) => ({
      baseUrl,
      circuitOpen: current.circuitOpenedUntil > Date.now(),
      circuitOpenedUntil: current.circuitOpenedUntil > 0 ? new Date(current.circuitOpenedUntil).toISOString() : null,
      consecutiveFailures: current.consecutiveFailures
    })),
    cache: getCacheStatus()
  };
}

async function requestOnelink(path, body, options = {}) {
  const idempotencyKey =
    options.idempotencyKey ||
    body.idempotency_key ||
    body.idempotencyKey ||
    "";
  const maxRetries = Number.isFinite(Number(options.maxRetries))
    ? Math.max(0, Number(options.maxRetries))
    : config.onelink.maxRetries;
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Math.max(250, Number(options.timeoutMs))
    : config.onelink.timeoutMs;

  const baseUrl = requestBaseUrl(options);
  if (!baseUrl) {
    throw classifyError({ error: new Error("onelink base URL is not configured") });
  }
  const currentState = stateForBaseUrl(baseUrl);
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      timeoutMs
    );

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: buildRequestHeaders({
          accountId: options.accountId,
          requestId: options.requestId,
          idempotencyKey
        }),
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const text = await response.text();
      const payload = parseBody(text);

      if (!response.ok) {
        throw classifyError({ response, payload });
      }

      resetCircuit({ baseUrl });

      return {
        payload,
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      const classified = classifyError({ error });
      lastError = classified;
      currentState.consecutiveFailures += 1;

      logger.warn("onelink request failed", {
        path,
        attempt,
        type: classified.type,
        message: classified.message
      });

      if (!classified.retryable || attempt >= maxRetries) {
        openCircuit({ baseUrl });
        throw classified;
      }

      const delayMs =
        Math.min(config.onelink.backoffMs * 2 ** attempt, 2000) +
        Math.floor(Math.random() * 25);
      await delay(delayMs);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error("unknown onelink request failure");
}

function isTerminalRuntimeEvent(event = {}) {
  const eventType = String(event.eventType || event.event_type || "").toLowerCase();
  const currentStatus = String(event.currentStatus || event.current_status || "").toLowerCase();
  return Boolean(
    event.terminal === true ||
      event.terminal === "true" ||
      eventType === "session_completed" ||
      eventType === "session_failed" ||
      eventType === "app_handoff_failed" ||
      ["completed", "failed", "cancelled", "canceled"].includes(currentStatus)
  );
}

async function lookupInboundContext(inbound, options = {}) {
  if (!isConfigured(options)) {
    return {
      configured: false,
      source: "not_configured",
      decision: null,
      inbound
    };
  }

  const cachedDecision = getCachedDecision({ inbound });

  if (isCircuitOpen(options)) {
    return {
      configured: true,
      degraded: true,
      source: cachedDecision ? "cache" : "circuit_open",
      decision: cachedDecision,
      error: { type: "upstream_unavailable", message: "circuit open" },
      inbound
    };
  }

  try {
    const body = buildCompatibilityPayload(inbound);
    const { payload, latencyMs } = await requestOnelink(
      config.onelink.routePath,
      body,
      {
        accountId: options.accountId,
        requestId: options.requestId,
        baseUrl: options.baseUrl
      }
    );

    setCachedDecision({ inbound }, payload, config.onelink.cacheTtlMs);

    logger.info("onelink inbound route resolved", {
      callRef: inbound.callRef,
      ingressNumber: inbound.ingressNumber,
        action: payload?.action || null,
        latencyMs
      });

    return {
      configured: true,
      degraded: false,
      source: "onelink",
      latencyMs,
      decision: payload,
      inbound
    };
  } catch (error) {
    logger.warn("using degraded inbound route mode", {
      callRef: inbound.callRef,
      ingressNumber: inbound.ingressNumber,
      type: error.type || "unknown",
      message: error.message,
      cacheHit: Boolean(cachedDecision)
    });

    return {
      configured: true,
      degraded: true,
      source: cachedDecision ? "cache" : "fallback",
      decision: cachedDecision,
      error: {
        type: error.type || "upstream_unavailable",
        message: error.message
      },
      inbound
    };
  }
}

async function forwardInboundEvent(event, options = {}) {
  if (!isConfigured(options)) {
    return {
      forwarded: false,
      skipped: true,
      reason: "onelink_not_configured"
    };
  }

  const body = buildCompatibilityPayload(event);
  const terminal = isTerminalRuntimeEvent(body);
  const { payload, latencyMs } = await requestOnelink(
    config.onelink.eventPath,
    body,
    {
      idempotencyKey:
        options.idempotencyKey ||
        event.idempotency_key ||
        event.idempotencyKey ||
        "",
      accountId: options.accountId,
      requestId: options.requestId,
      baseUrl: options.baseUrl,
      maxRetries: terminal ? Math.max(config.onelink.maxRetries, 8) : 0,
      timeoutMs: terminal ? Math.max(config.onelink.timeoutMs, 15000) : config.onelink.timeoutMs
    }
  );

  logger.info("forwarded runtime event to onelink", {
    eventType: event.eventType || event.event_type || null,
    callRef: event.callRef || event.call_ref || null,
    terminal,
    latencyMs
  });

  return {
    forwarded: true,
    skipped: false,
    latencyMs,
    payload
  };
}

module.exports = {
  isConfigured,
  getStatus,
  lookupInboundContext,
  forwardInboundEvent,
  invalidateRouteCache
};
