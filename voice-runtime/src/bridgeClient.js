const { randomUUID } = require("node:crypto");
const { config } = require("./config");
const { logger } = require("./logger");

const eventSeqByScope = new Map();
const maxEventSeqScopes = 10000;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function nextEventSeq(scope) {
  const key = scope || "global";
  if (!eventSeqByScope.has(key) && eventSeqByScope.size >= maxEventSeqScopes) {
    const oldestKey = eventSeqByScope.keys().next().value;
    if (oldestKey) {
      eventSeqByScope.delete(oldestKey);
    }
  }
  const next = (eventSeqByScope.get(key) || 0) + 1;
  eventSeqByScope.set(key, next);
  return next;
}

function classifyError({ response, payload, error }) {
  if (error?.type) {
    return error;
  }

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

function buildRequestHeaders({ accountId, requestId, idempotencyKey, eventId, eventAttempt } = {}) {
  return {
    "content-type": "application/json",
    ...(config.bridgeSharedSecret
      ? { "x-bridge-secret": config.bridgeSharedSecret }
      : {}),
    ...(accountId ? { "x-account-id": accountId } : {}),
    ...(idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {}),
    ...(eventId ? { "x-event-id": eventId } : {}),
    ...(eventAttempt ? { "x-event-attempt": String(eventAttempt) } : {}),
    ...(requestId ? { "x-request-id": requestId } : {})
  };
}

async function postJson(path, body, options = {}) {
  let lastError;

  const eventId =
    options.eventId ||
    body.event_id ||
    body.eventId ||
    "";
  const idempotencyKey =
    options.idempotencyKey ||
    body.idempotency_key ||
    body.idempotencyKey ||
    eventId ||
    "";

  for (let attempt = 0; attempt <= config.bridgeMaxRetries; attempt++) {
    const eventAttempt = attempt + 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.bridgeTimeoutMs);
    const requestBody = eventId
      ? {
          ...body,
          event_id: body.event_id || eventId,
          eventId: body.eventId || eventId,
          attempt: eventAttempt
        }
      : body;

    try {
      const response = await fetch(`${config.bridgeBaseUrl}${path}`, {
        method: "POST",
        headers: buildRequestHeaders({
          accountId: options.accountId,
          idempotencyKey,
          requestId: options.requestId,
          eventId,
          eventAttempt
        }),
        body: JSON.stringify(requestBody),
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

async function getJson(path, options = {}) {
  const controller = new AbortController();
  const timeoutMs = Math.max(
    1000,
    Number(options.timeoutMs || config.bridgeTimeoutMs)
  );
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${config.bridgeBaseUrl}${path}`, {
      method: "GET",
      headers: buildRequestHeaders({
        accountId: options.accountId,
        requestId: options.requestId
      }),
      signal: controller.signal
    });
    const text = await response.text();
    const payload = parseBody(text);

    if (!response.ok) {
      throw classifyError({ response, payload });
    }

    return payload;
  } catch (error) {
    throw classifyError({ error });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchInboundDecision(inbound, options = {}) {
  const bridgeCallRef =
    inbound.bridgeCallRef ||
    inbound.bridge_call_ref ||
    inbound.callRef ||
    "";

  return await postJson(
    "/internal/voice/inbound/route",
    {
      call_ref: bridgeCallRef,
      callRef: bridgeCallRef,
      bridge_call_ref: bridgeCallRef,
      bridgeCallRef,
      provider_call_id: bridgeCallRef,
      providerCallId: bridgeCallRef,
      app_ref: inbound.appRef,
      appRef: inbound.appRef,
      runtime_call_ref: inbound.runtimeCallRef || inbound.runtime_call_ref || "",
      runtimeCallRef: inbound.runtimeCallRef || inbound.runtime_call_ref || "",
      parent_call_ref: bridgeCallRef,
      parentCallRef: bridgeCallRef,
      child_call_ref: inbound.runtimeCallRef || inbound.runtime_call_ref || "",
      childCallRef: inbound.runtimeCallRef || inbound.runtime_call_ref || "",
      media_session_ref: inbound.mediaSessionRef,
      mediaSessionRef: inbound.mediaSessionRef,
      number_ref: inbound.numberRef || inbound.number_ref || "",
      numberRef: inbound.numberRef || inbound.number_ref || "",
      inbox_id: inbound.inboxId || inbound.inbox_id || "",
      inboxId: inbound.inboxId || inbound.inbox_id || "",
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

async function pollCallEvents(callRef, eventType, options = {}) {
  const safeCallRef = encodeURIComponent(String(callRef || ""));
  const safeEventType = encodeURIComponent(String(eventType || ""));
  const params = new URLSearchParams();

  if (options.sinceId) params.set("since_id", String(options.sinceId));
  if (options.accountId) params.set("account_id", String(options.accountId));
  params.set("limit", String(options.limit || 20));
  params.set("timeout_ms", String(options.timeoutMs || 5000));

  return await getJson(
    `/telephony/calls/${safeCallRef}/events/${safeEventType}/poll?${params}`,
    {
      accountId: options.accountId,
      requestId: options.requestId,
      timeoutMs: Number(options.timeoutMs || 5000) + 2000
    }
  );
}

async function emitVoiceEvent(event, options = {}) {
  const eventScope =
    event.bridge_call_ref ||
    event.bridgeCallRef ||
    event.provider_call_id ||
    event.providerCallId ||
    event.call_ref ||
    event.callRef ||
    event.media_session_ref ||
    event.mediaSessionRef ||
    "";
  const eventId =
    options.eventId ||
    event.event_id ||
    event.eventId ||
    (event.eventType || event.event_type
      ? `evt_${String(event.eventType || event.event_type).replace(/[^a-z0-9_]+/gi, "_").toLowerCase()}_${randomUUID()}`
      : "");
  const eventSeq = event.event_seq || event.eventSeq || nextEventSeq(eventScope);
  const bridgeCallRef =
    event.bridge_call_ref ||
    event.bridgeCallRef ||
    event.parent_call_ref ||
    event.parentCallRef ||
    event.provider_call_id ||
    event.providerCallId ||
    event.call_ref ||
    event.callRef ||
    "";
  const runtimeCallRef =
    event.runtime_call_ref ||
    event.runtimeCallRef ||
    event.child_call_ref ||
    event.childCallRef ||
    "";
  const body = {
    ...event,
    ...(bridgeCallRef
      ? {
          ...(event.call_ref && event.call_ref !== bridgeCallRef
            ? { legacy_call_ref: event.call_ref, legacyCallRef: event.call_ref }
            : {}),
          call_ref: bridgeCallRef,
          callRef: bridgeCallRef,
          bridge_call_ref: bridgeCallRef,
          bridgeCallRef,
          parent_call_ref: event.parent_call_ref || bridgeCallRef,
          parentCallRef: event.parentCallRef || bridgeCallRef,
          provider_call_id: event.provider_call_id || bridgeCallRef,
          providerCallId: event.providerCallId || bridgeCallRef
        }
      : {}),
    ...(runtimeCallRef
      ? {
          runtime_call_ref: runtimeCallRef,
          runtimeCallRef,
          child_call_ref: event.child_call_ref || runtimeCallRef,
          childCallRef: event.childCallRef || runtimeCallRef
        }
      : {}),
    ...(eventId ? { event_id: eventId, eventId } : {}),
    event_seq: eventSeq,
    eventSeq,
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
      eventId ||
      ""
  };
  const accountId = options.accountId || body.account_id || "";
  const requestId = options.requestId || body.request_id || "";
  const idempotencyKey = options.idempotencyKey || body.idempotency_key || "";

  return await postJson("/internal/voice/inbound/event", body, {
    accountId,
    requestId,
    idempotencyKey,
    eventId
  });
}

module.exports = { fetchInboundDecision, emitVoiceEvent, pollCallEvents };
