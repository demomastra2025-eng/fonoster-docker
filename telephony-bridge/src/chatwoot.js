const { config } = require("./config");
const { logger } = require("./logger");
const {
  getCachedDecision,
  setCachedDecision,
  invalidateRouteCache,
  getCacheStatus
} = require("./routeCache");

const state = {
  consecutiveFailures: 0,
  circuitOpenedUntil: 0
};

function isConfigured() {
  return Boolean(config.onelink.baseUrl);
}

function isCircuitOpen() {
  return state.circuitOpenedUntil > Date.now();
}

function openCircuit() {
  state.circuitOpenedUntil = Date.now() + config.onelink.circuitResetMs;
}

function resetCircuit() {
  state.consecutiveFailures = 0;
  state.circuitOpenedUntil = 0;
}

function buildCompatibilityPayload(payload = {}) {
  return {
    ...payload,
    call_ref: payload.call_ref || payload.callRef || null,
    callRef: payload.callRef || payload.call_ref || null,
    ingress_number: payload.ingress_number || payload.ingressNumber || null,
    ingressNumber: payload.ingressNumber || payload.ingress_number || null,
    caller_number: payload.caller_number || payload.callerNumber || null,
    callerNumber: payload.callerNumber || payload.caller_number || null,
    received_at: payload.received_at || payload.receivedAt || null,
    receivedAt: payload.receivedAt || payload.received_at || null,
    metadata: payload.metadata || {}
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
      ? { authorization: `Bearer ${config.onelink.accessToken}` }
      : {}),
    ...(selectedAccountId ? { "x-account-id": selectedAccountId } : {}),
    ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
    ...(requestId ? { "x-request-id": requestId } : {})
  };
}

function getStatus() {
  return {
    configured: isConfigured(),
    circuitOpen: isCircuitOpen(),
    circuitOpenedUntil:
      state.circuitOpenedUntil > 0
        ? new Date(state.circuitOpenedUntil).toISOString()
        : null,
    consecutiveFailures: state.consecutiveFailures,
    cache: getCacheStatus()
  };
}

async function requestOnelink(path, body, options = {}) {
  const idempotencyKey =
    options.idempotencyKey ||
    body.idempotency_key ||
    body.idempotencyKey ||
    "";

  let lastError;

  for (let attempt = 0; attempt <= config.onelink.maxRetries; attempt++) {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      config.onelink.timeoutMs
    );

    try {
      const response = await fetch(`${config.onelink.baseUrl}${path}`, {
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

      resetCircuit();

      return {
        payload,
        latencyMs: Date.now() - startedAt
      };
    } catch (error) {
      const classified = classifyError({ error });
      lastError = classified;
      state.consecutiveFailures += 1;

      logger.warn("onelink request failed", {
        path,
        attempt,
        type: classified.type,
        message: classified.message
      });

      if (!classified.retryable || attempt >= config.onelink.maxRetries) {
        openCircuit();
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

async function lookupInboundContext(inbound, options = {}) {
  if (!isConfigured()) {
    return {
      configured: false,
      source: "not_configured",
      decision: null,
      inbound
    };
  }

  const cachedDecision = getCachedDecision({ inbound });

  if (isCircuitOpen()) {
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
        requestId: options.requestId
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
  if (!isConfigured()) {
    return {
      forwarded: false,
      skipped: true,
      reason: "onelink_not_configured"
    };
  }

  const body = buildCompatibilityPayload(event);
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
      requestId: options.requestId
    }
  );

  logger.info("forwarded runtime event to onelink", {
    eventType: event.eventType || event.event_type || null,
    callRef: event.callRef || event.call_ref || null,
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
