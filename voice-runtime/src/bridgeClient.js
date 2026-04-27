const { config } = require("./config");
const { logger } = require("./logger");

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyError({ response, payload, error }) {
  const classified = new Error(
    error?.message ||
      payload?.error ||
      `bridge request failed (${response?.status || "unknown"})`
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
  return {
    "content-type": "application/json",
    ...(config.bridgeSharedSecret
      ? { "x-bridge-secret": config.bridgeSharedSecret }
      : {}),
    ...(accountId ? { "x-account-id": accountId } : {}),
    ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
    ...(requestId ? { "x-request-id": requestId } : {})
  };
}

async function postJson(path, body, options = {}) {
  let lastError;

  const idempotencyKey =
    options.idempotencyKey ||
    body.idempotency_key ||
    body.idempotencyKey ||
    "";

  for (let attempt = 0; attempt <= config.bridgeMaxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.bridgeTimeoutMs);

    try {
      const response = await fetch(`${config.bridgeBaseUrl}${path}`, {
        method: "POST",
        headers: buildRequestHeaders({
          accountId: options.accountId,
          idempotencyKey,
          requestId: options.requestId
        }),
        body: JSON.stringify(body),
        signal: controller.signal
      });

      const text = await response.text();
      const payload = parseBody(text);

      if (!response.ok) {
        throw classifyError({ response, payload });
      }

      return payload;
    } catch (error) {
      const classified = classifyError({ error });
      lastError = classified;

      logger.warn("bridge request failed", {
        path,
        attempt,
        type: classified.type,
        message: classified.message
      });

      if (!classified.retryable || attempt >= config.bridgeMaxRetries) {
        throw classified;
      }

      const delayMs =
        Math.min(config.bridgeBackoffMs * 2 ** attempt, 5000) +
        Math.floor(Math.random() * 25);
      await delay(delayMs);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error("unknown bridge request failure");
}

async function fetchInboundDecision(inbound, options = {}) {
  return await postJson(
    "/internal/voice/inbound/route",
    {
      call_ref: inbound.callRef,
      app_ref: inbound.appRef,
      appRef: inbound.appRef,
      ingress_number: inbound.ingressNumber,
      caller_number: inbound.callerNumber,
      direction: inbound.direction,
      received_at: inbound.receivedAt,
      metadata: inbound.metadata || {},
      account_id:
        options.accountId || inbound.account_id || inbound.accountId || "",
      request_id: options.requestId || inbound.requestId || inbound.request_id || "",
      idempotency_key:
        options.idempotencyKey ||
        inbound.idempotency_key ||
        inbound.idempotencyKey ||
        ""
    },
    {
      accountId: options.accountId,
      requestId: options.requestId,
      idempotencyKey: options.idempotencyKey
    }
  );
}

async function emitVoiceEvent(event, options = {}) {
  const body = {
    ...event,
    account_id:
      options.accountId ||
      event.account_id ||
      event.accountId ||
      "",
    request_id:
      options.requestId ||
      event.request_id ||
      event.requestId ||
      "",
    idempotency_key:
      options.idempotencyKey ||
      event.idempotency_key ||
      event.idempotencyKey ||
      ""
  };
  const accountId = options.accountId || body.account_id || "";
  const requestId = options.requestId || body.request_id || "";
  const idempotencyKey = options.idempotencyKey || body.idempotency_key || "";

  return await postJson("/internal/voice/inbound/event", body, {
    accountId,
    requestId,
    idempotencyKey
  });
}

module.exports = { fetchInboundDecision, emitVoiceEvent };
