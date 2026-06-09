const express = require("express");
const { randomUUID } = require("node:crypto");
const WebSocket = require("ws");
const { config } = require("./config");
const { logger } = require("./logger");
const { withSdkRetry } = require("./fonoster");
const onelink = require("./chatwoot");
const {
  buildInboundDecision,
  buildOutboundAppRefDecision,
  buildOutboundRuntimeDecision
} = require("./routeDecision");
const {
  getNumberRoute,
  updateNumberRouteInRoutr
} = require("./routrDb");
const {
  publishVoiceEvent,
  subscribeVoiceEvents,
  listRecentEvents,
  waitForMatchingEvent,
  getStreamState,
  buildSseStream,
  startHeartbeat
} = require("./voiceStreamBus");

function asyncRoute(handler) {
  return async function wrapped(req, res, next) {
    try {
      await handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

function verifySharedSecret(req, res, next) {
  if (!config.security?.requireInternalSecret) return next();
  if (!config.sharedSecret) {
    logger.error("missing TELEPHONY_BRIDGE_SHARED_SECRET for internal API", {
      path: req.path
    });
    return res.status(500).json({ error: "internal shared secret is not configured" });
  }

  const provided =
    req.get("x-bridge-secret") || req.get("x-bridge-shared-secret") || "";
  if (provided !== config.sharedSecret) {
    return res.status(401).json({ error: "invalid shared secret" });
  }
  return next();
}

function normalizePagination(query) {
  return {
    pageSize: query.page_size ? Number(query.page_size) : 20,
    pageToken: query.page_token || undefined
  };
}

function normalizeBody(body, aliases = {}) {
  if (!body || typeof body !== "object") {
    return {};
  }

  const normalized = { ...body };

  Object.entries(aliases).forEach(([target, candidates]) => {
    if (normalized[target] !== undefined) {
      return;
    }

    const aliasList = Array.isArray(candidates) ? candidates : [candidates];
    for (const alias of aliasList) {
      if (normalized[alias] === undefined) {
        continue;
      }

      normalized[target] = normalized[alias];
      break;
    }
  });

  return normalized;
}

function normalizeSipAor(value) {
  return String(value || "").trim().toLowerCase();
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== "string") return null;

  const [, payload] = token.split(".");
  if (!payload) return null;

  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch (error) {
    logger.warn("failed to decode webphone token payload", {
      error: error.message
    });
    return null;
  }
}

function buildWebphoneTokenDiagnostics(tokenResponse, expectedAor) {
  const payload = decodeJwtPayload(tokenResponse?.token);
  const identity = payload
    ? {
        ref: payload.ref || null,
        domainRef: payload.domainRef || null,
        username: payload.username || null,
        domain: payload.domain || null,
        targetAor: payload.targetAor || null,
        aor: payload.aor || null,
        aorLink: payload.aorLink || null,
        allowedMethods: Array.isArray(payload.allowedMethods)
          ? payload.allowedMethods
          : [],
        maxContacts: payload.maxContacts ?? null
      }
    : null;

  const expected = normalizeSipAor(expectedAor);
  const actual = normalizeSipAor(identity?.aor || identity?.targetAor);
  const aorLink = normalizeSipAor(identity?.aorLink);
  const registrationAllowed = Boolean(
    identity?.allowedMethods?.includes("REGISTER")
  );
  const inviteAllowed = Boolean(identity?.allowedMethods?.includes("INVITE"));
  const tokenIdentityMismatch = Boolean(expected && actual && actual !== expected);
  const usesTestIdentity =
    identity?.username === "internal" ||
    identity?.domain === "internal" ||
    actual === "sip:voice@default" ||
    aorLink === "sip:voice@default";
  const productionReady = Boolean(
    identity &&
      expected &&
      actual === expected &&
      registrationAllowed &&
      !usesTestIdentity
  );

  return {
    callingSupported: productionReady,
    productionReady,
    tokenIdentityMismatch,
    expectedAor: expectedAor || null,
    tokenIdentity: identity,
    browserTelephony: {
      status: productionReady
        ? "production_ready"
        : tokenIdentityMismatch || usesTestIdentity
          ? "token_identity_mismatch"
          : "not_ready",
      registrationAllowed,
      inviteAllowed
    }
  };
}

const ONELINK_DIAL_STATUS_MAP = {
  ANSWER: "answered",
  ANSWERED: "answered",
  IN_PROGRESS: "answered",
  NOANSWER: "no-answer",
  NO_ANSWER: "no-answer",
  BUSY: "busy",
  USER_BUSY: "busy",
  REJECTED: "rejected",
  DECLINED: "rejected",
  COMPLETED: "completed",
  COMPLETE: "completed",
  ENDED: "completed",
  NORMAL_CLEARING: "completed",
  NORMAL_CLEAR: "completed",
  NORMAL_CALL_CLEARING: "completed",
  FAILED: "failed",
  CANCEL: "cancelled",
  CANCELED: "cancelled",
  CANCELLED: "cancelled"
};

function normalizeOnelinkDialStatus(status) {
  const raw = String(status || "").trim();

  if (!raw) return "";

  const key = raw.toUpperCase().replace(/[\s-]+/g, "_");

  return ONELINK_DIAL_STATUS_MAP[key] || raw.toLowerCase().replace(/[\s_]+/g, "-");
}

const TERMINAL_CURRENT_STATUSES = new Set([
  "completed",
  "missed",
  "no_answer",
  "busy",
  "cancelled",
  "rejected",
  "failed"
]);

function addAlias(target, camelName, snakeName, value) {
  if (value === undefined || value === null || value === "") return;
  if (target[camelName] === undefined || target[camelName] === "") {
    target[camelName] = value;
  }
  if (target[snakeName] === undefined || target[snakeName] === "") {
    target[snakeName] = value;
  }
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeOptionalBoolean(value) {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value === "boolean") return value;

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "enabled"].includes(normalized)) return true;
  if (["0", "false", "no", "off", "disabled"].includes(normalized)) return false;
  return undefined;
}

function toPositiveNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function hasObservedAudioOut(event = {}) {
  const sawAudioOut = normalizeOptionalBoolean(
    event.sawAudioOut ?? event.saw_audio_out
  );
  const audioOutBytes =
    toPositiveNumber(event.audioOutBytesTotal ?? event.audio_out_bytes_total) ||
    toPositiveNumber(event.firstAudioOutBytes ?? event.first_audio_out_bytes);

  return sawAudioOut === true && audioOutBytes > 0;
}

function isBeforeAudioReason(value) {
  return (
    String(value || "")
      .trim()
      .toLowerCase()
      .replace(/-/g, "_") === "media_stream_closed_before_audio"
  );
}

function applyObservedMediaGuard(event = {}) {
  if (!hasObservedAudioOut(event)) return event;

  event.mediaEstablished = true;
  event.media_established = true;

  if (
    !event.mediaEstablishedReason ||
    isBeforeAudioReason(event.mediaEstablishedReason) ||
    event.mediaEstablishedReason === "app_answered_media_not_observed_by_bridge" ||
    event.mediaEstablishedReason === "app_media_not_established" ||
    !event.media_established_reason ||
    isBeforeAudioReason(event.media_established_reason) ||
    event.media_established_reason === "app_answered_media_not_observed_by_bridge" ||
    event.media_established_reason === "app_media_not_established"
  ) {
    event.mediaEstablishedReason = "audio_out_observed_by_bridge";
    event.media_established_reason = "audio_out_observed_by_bridge";
  }

  if (isBeforeAudioReason(event.endReason)) {
    event.endReason = "media_stream_closed_after_audio";
  }
  if (isBeforeAudioReason(event.end_reason)) {
    event.end_reason = "media_stream_closed_after_audio";
  }
  if (isBeforeAudioReason(event.outcome)) {
    event.outcome = "media_stream_closed_after_audio";
  }

  return event;
}

function buildRecordingMetadata(source = {}) {
  const contract = isPlainObject(source.recording_contract)
    ? source.recording_contract
    : isPlainObject(source.recordingContract)
      ? source.recordingContract
      : isPlainObject(source.recording)
        ? source.recording
        : null;
  const enabled = normalizeOptionalBoolean(
    source.recording_enabled ??
      source.recordingEnabled ??
      contract?.enabled
  );

  if (enabled === undefined && !contract) return {};

  const recordingContract = {
    ...(contract || {}),
    ...(enabled !== undefined ? { enabled } : {}),
    source: contract?.source || "onelink_runtime",
    storage_provider: contract?.storage_provider || contract?.storageProvider || "onelink_storage"
  };

  return {
    ...(enabled !== undefined ? { recording_enabled: enabled } : {}),
    recording_contract: recordingContract
  };
}

function normalizeRoutingMode(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "ai-agent") return "ai";
  if (normalized === "agent") return "operator";
  if (["app", "ai", "operator", "reject", "transfer"].includes(normalized)) {
    return normalized;
  }
  return normalized || "";
}

function normalizeCallDirection(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (["from_pstn", "inbound", "incoming"].includes(normalized)) return "inbound";
  if (["to_pstn", "outbound", "outgoing"].includes(normalized)) return "outbound";
  return normalized;
}

function normalizeTerminateReason(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  if (!normalized) return "operator_declined";
  if (normalized === "decline" || normalized === "declined") {
    return "operator_declined";
  }
  if (normalized === "reject" || normalized === "rejected") {
    return "operator_rejected";
  }
  if (normalized === "hangup" || normalized === "hungup") {
    return "operator_hangup";
  }
  if (normalized === "cancel" || normalized === "canceled") {
    return "operator_cancelled";
  }
  return normalized;
}

function operatorControlTerminateReason(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return normalized.startsWith("operator_");
}

function normalizeCurrentStatus(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "inprogress") return "in_progress";
  if (normalized === "noanswer") return "no_answer";
  if (normalized === "user_busy") return "busy";
  if (normalized === "no_answer") return "no_answer";
  return normalized;
}

function statusToCurrentStatus(status, eventType = "") {
  const normalized = normalizeCurrentStatus(status);
  const type = String(eventType || "").toLowerCase();

  if (!normalized) return "";
  if (normalized === "answered") return "in_progress";
  if (normalized === "ringing") {
    return type === "session_started" ? "ringing" : "connecting";
  }
  if (normalized === "no-answer") return "no_answer";
  if (normalized === "no_answer") return "no_answer";
  if (normalized === "cancel" || normalized === "canceled") return "cancelled";
  if (normalized === "rejected_without_answer") return "rejected";
  return normalized;
}

function reasonForCurrentStatus(status, event = {}) {
  const currentStatus = normalizeCurrentStatus(status);
  if (event.endReason || event.end_reason) return event.endReason || event.end_reason;

  switch (currentStatus) {
    case "completed":
      return "normal";
    case "missed":
      return "caller_cancelled";
    case "no_answer":
      return "no_answer";
    case "busy":
      return "busy";
    case "cancelled":
      return "caller_cancelled";
    case "rejected":
      return "rejected_by_policy";
    case "failed":
      return "provider_error";
    default:
      return "";
  }
}

function humanReadableReasonFor(reason) {
  const normalized = String(reason || "").trim();
  if (!normalized) return "";
  return normalized.replace(/[_-]+/g, " ");
}

function normalizeHangupInitiator(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "operator_device" || normalized === "agent") return "operator";
  if (["caller", "operator", "system", "timeout", "bridge", "provider", "runtime", "ai", "app", "unknown"].includes(normalized)) {
    return normalized;
  }
  return normalized;
}

function inferLegType(event = {}) {
  const explicit = event.legType || event.leg_type || event.leg || event.callLeg || event.call_leg;
  if (explicit) return normalizeRoutingMode(explicit) || String(explicit).trim().toLowerCase();

  const eventType = String(event.eventType || event.event_type || "").toLowerCase();
  const routingMode = normalizeRoutingMode(event.routingMode || event.routing_mode || event.action);

  if (eventType.includes("operator")) return "operator";
  if (eventType.includes("ai")) return "ai";
  if (eventType.includes("app")) return "app";
  if (eventType === "answered" && (event.answeredBy || event.answered_by) === "bridge") return "caller";
  return routingMode || "";
}

function inferHangupInitiator(event = {}, currentStatus = "", endedBy = "") {
  const explicit =
    event.hangupInitiator ||
    event.hangup_initiator ||
    event.terminationInitiator ||
    event.termination_initiator ||
    "";
  if (explicit) return normalizeHangupInitiator(explicit);

  const source = String(event.terminalSource || event.terminal_source || "").toLowerCase();
  const reason = String(event.endReason || event.end_reason || event.outcome || "").toLowerCase();
  const normalizedEndedBy = normalizeHangupInitiator(endedBy);

  if (source.includes("timeout") || reason.includes("timeout")) return "timeout";
  if (source === "voice_end" || reason.includes("caller_hangup")) return "caller";
  if (source === "operator_control" || reason.includes("operator_hangup")) return "operator";
  if (source === "voice_error" || source === "dial_error") return "system";
  if (normalizedEndedBy && normalizedEndedBy !== "unknown") return normalizedEndedBy;

  switch (normalizeCurrentStatus(currentStatus)) {
    case "busy":
    case "no_answer":
    case "failed":
    case "cancelled":
      return "provider";
    case "completed":
      return "unknown";
    default:
      return "";
  }
}

function inferCurrentStatus(event = {}) {
  const eventType = String(event.eventType || event.event_type || "").toLowerCase();
  const explicit =
    event.currentStatus ||
    event.current_status ||
    event.crmStatus ||
    event.crm_status ||
    "";

  if (explicit) return normalizeCurrentStatus(explicit);

  if (eventType === "call_created") return "created";
  if (eventType === "session_started") return "ringing";
  if (eventType === "route_decision" || eventType === "decision_received") {
    const action = normalizeRoutingMode(event.action || event?.decision?.action);
    return action === "reject" ? "rejected" : "connecting";
  }
  if (
    eventType === "operator_ringing" ||
    eventType === "app_ringing" ||
    eventType === "ai_ringing" ||
    eventType === "transfer_started" ||
    eventType === "transfer_ringing"
  ) {
    return "connecting";
  }
  if (
    eventType === "operator_answered" ||
    eventType === "app_answered" ||
    eventType === "ai_answered" ||
    eventType === "transfer_answered"
  ) {
    return "in_progress";
  }
  if (eventType === "answered") {
    if (
      !hasObservedAudioOut(event) &&
      (event.mediaEstablished === false || event.media_established === false)
    ) {
      return "connecting";
    }
    return "in_progress";
  }
  if (eventType === "dial_status" || eventType === "call_status") {
    return statusToCurrentStatus(event.status, eventType);
  }
  if (eventType === "rejected") return "rejected";
  if (eventType === "session_failed" || eventType === "transfer_failed") return "failed";
  if (eventType === "session_completed" || eventType === "transfer_completed") {
    return statusToCurrentStatus(event.outcome || event.status || "completed", eventType);
  }

  return "";
}

function inferAnsweredBy(event = {}) {
  if (event.answeredBy || event.answered_by) return event.answeredBy || event.answered_by;

  const eventType = String(event.eventType || event.event_type || "").toLowerCase();
  const action = normalizeRoutingMode(event.routingMode || event.routing_mode || event.action);

  if (eventType === "operator_answered") return "operator_device";
  if (eventType === "app_answered") return "app";
  if (eventType === "ai_answered") return "ai";
  if (eventType === "transfer_answered") return "operator_device";
  if (eventType === "answered" && (event.leg === "caller" || event.callLeg === "caller")) {
    return "bridge";
  }
  if (eventType === "answered") {
    if (action === "operator") return "operator_device";
    if (action === "ai") return "ai";
    if (action === "app") return "app";
  }

  return "";
}

function inferEndedBy(event = {}, currentStatus = "") {
  if (event.endedBy || event.ended_by) return event.endedBy || event.ended_by;

  const eventType = String(event.eventType || event.event_type || "").toLowerCase();
  if (eventType === "rejected") return "system";
  if (eventType !== "session_completed" && eventType !== "session_failed") return "";

  switch (normalizeCurrentStatus(currentStatus)) {
    case "rejected":
      return "system";
    case "failed":
    case "busy":
    case "no_answer":
    case "cancelled":
      return "provider";
    case "completed":
      return "unknown";
    default:
      return "";
  }
}

function enrichLifecycleEvent(event = {}) {
  const enriched = applyObservedMediaGuard({ ...event });
  const bridgeCallRef =
    enriched.bridgeCallRef ||
    enriched.bridge_call_ref ||
    enriched.parentCallRef ||
    enriched.parent_call_ref ||
    enriched.providerCallId ||
    enriched.provider_call_id ||
    enriched.callRef ||
    enriched.call_ref ||
    "";
  const runtimeCallRef =
    enriched.runtimeCallRef ||
    enriched.runtime_call_ref ||
    enriched.childCallRef ||
    enriched.child_call_ref ||
    "";
  const routingMode = normalizeRoutingMode(
    enriched.routingMode ||
      enriched.routing_mode ||
      enriched.action ||
      enriched?.decision?.action ||
      ""
  );
  const callDirection = normalizeCallDirection(
    enriched.callDirection || enriched.call_direction || enriched.direction || ""
  );
  const currentStatus = inferCurrentStatus(enriched);
  const answeredBy = inferAnsweredBy(enriched);
  const endedBy = inferEndedBy(enriched, currentStatus);
  const endReason = reasonForCurrentStatus(currentStatus, enriched);
  const legType = inferLegType(enriched);
  const hangupInitiator = inferHangupInitiator(enriched, currentStatus, endedBy);
  const humanReadableReason =
    enriched.humanReadableReason ||
    enriched.human_readable_reason ||
    humanReadableReasonFor(endReason);

  addAlias(enriched, "routingMode", "routing_mode", routingMode);
  addAlias(enriched, "callRef", "call_ref", bridgeCallRef);
  addAlias(enriched, "bridgeCallRef", "bridge_call_ref", bridgeCallRef);
  addAlias(enriched, "parentCallRef", "parent_call_ref", bridgeCallRef);
  addAlias(enriched, "providerCallId", "provider_call_id", bridgeCallRef);
  addAlias(enriched, "runtimeCallRef", "runtime_call_ref", runtimeCallRef);
  addAlias(enriched, "childCallRef", "child_call_ref", runtimeCallRef);
  addAlias(enriched, "callDirection", "call_direction", callDirection);
  addAlias(enriched, "currentStatus", "current_status", currentStatus);
  addAlias(enriched, "answeredBy", "answered_by", answeredBy);
  addAlias(enriched, "endedBy", "ended_by", endedBy);
  addAlias(enriched, "endReason", "end_reason", endReason);
  addAlias(enriched, "legType", "leg_type", legType);
  addAlias(enriched, "hangupInitiator", "hangup_initiator", hangupInitiator);
  addAlias(enriched, "sipStatus", "sip_status", enriched.sipStatus || enriched.sip_status);
  addAlias(enriched, "q850Cause", "q850_cause", enriched.q850Cause || enriched.q850_cause);
  addAlias(enriched, "humanReadableReason", "human_readable_reason", humanReadableReason);

  if (currentStatus) {
    enriched.terminal = TERMINAL_CURRENT_STATUSES.has(currentStatus);
  }

  return enriched;
}

function normalizeEventStatusField(normalized, field) {
  if (normalized[field] === undefined || normalized[field] === null) {
    return;
  }

  const raw = normalized[field];
  const status = normalizeOnelinkDialStatus(raw);

  if (!status || status === raw) {
    return;
  }

  if (normalized.rawStatus === undefined) {
    normalized.rawStatus = raw;
  }

  if (normalized.raw_status === undefined) {
    normalized.raw_status = raw;
  }

  normalized[field] = status;
}

function parseCsvList(value) {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) {
    return value
      .filter((entry) => entry !== undefined && entry !== null)
      .map((entry) => String(entry).trim())
      .filter(Boolean);
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => String(entry).trim())
      .filter(Boolean);
  }

  return [];
}

function parseEventFilters(query = {}) {
  const callRef =
    query.callRef ||
    query.call_ref ||
    query.callRefs ||
    query.call_refs ||
    [];
  const eventType =
    query.eventType ||
    query.event_type ||
    query.eventTypes ||
    query.event_types ||
    query.type ||
    [];
  const numberRef =
    query.numberRef ||
    query.number_ref ||
    query.numberRefs ||
    query.number_refs ||
    [];
  const mediaSessionRef =
    query.mediaSessionRef ||
    query.media_session_ref ||
    query.mediaSessionRefs ||
    query.media_session_refs ||
    [];
  const accountId =
    query.accountId ||
    query.account_id ||
    query.accountIds ||
    query.account_ids ||
    [];
  const eventId =
    query.eventId ||
    query.event_id ||
    query.eventIds ||
    query.event_ids ||
    [];

  return {
    callRef: parseCsvList(callRef),
    eventType: parseCsvList(eventType),
    numberRef: parseCsvList(numberRef),
    mediaSessionRef: parseCsvList(mediaSessionRef),
    accountId: parseCsvList(accountId),
    eventId: parseCsvList(eventId)
  };
}

function parseSinceMs(query = {}) {
  const fromQuery = query.since || query.sinceMs || query.since_ms;
  if (!fromQuery) {
    return 0;
  }

  const parsed = Number(fromQuery);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseSinceSeq(query = {}) {
  const fromQuery = query.since_id || query.sinceId || query.since_seq || query.seq;
  if (!fromQuery) {
    return 0;
  }

  const parsed = Number(fromQuery);
  return Number.isFinite(parsed) ? parsed : 0;
}

function resolveAccountFromRequest(req, path) {
  const accountFromHeader =
    req.get("x-account-id") ||
    req.get("x-accountId") ||
    req.get("x-fonoster-account-id") ||
    "";
  const accountFromQuery =
    req.query.accountId ||
    req.query.account_id ||
    "";
  return accountFromHeader || accountFromQuery || "";
}

function attachRequestContext(req, resolvedPath) {
  const pathPrefixMatch =
    resolvedPath.match(/^\/api\/v1\/accounts\/([^/]+)\/telephony(?:$|\/)/) ||
    [];
  const fromPath = pathPrefixMatch[1];

  let accountId = resolveAccountFromRequest(req, resolvedPath) || "";

  if (fromPath) {
    try {
      accountId = decodeURIComponent(fromPath);
    } catch (_error) {
      accountId = fromPath;
    }
  }

  req.accountId = accountId || "";
  req.requestId = req.get("x-request-id") || randomUUID();

  if (accountId) {
    req.query = req.query || {};
    req.query.account_id = accountId;
  }

  return req;
}

function parseLimit(query = {}) {
  const parsed = Number(query.limit);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.min(200, Math.floor(parsed));
}

function parseLongPollMs(query = {}) {
  const fromQuery =
    query.block_ms ||
    query.blockMs ||
    query.timeout_ms ||
    query.timeoutMs ||
    query.wait;
  if (!fromQuery) {
    return 0;
  }

  const parsed = Number(fromQuery);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  const maxLongPollMs = config.stream?.maxLongPollMs || 30000;
  return Math.max(
    250,
    Math.min(maxLongPollMs, parsed)
  );
}

function parseStreamMode(query = {}, headers = {}, fallback = false) {
  const headerStream = String(
    headers["x-stream"] || headers["x-telephony-stream"] || ""
  )
    .toLowerCase()
    .trim();
  const streamQuery =
    query.stream ||
    query.stream_mode ||
    query.mode ||
    query.streamMode ||
    query.stream_ms;

  if (["1", "true", "yes", "sse", "stream"].includes(headerStream)) {
    return true;
  }

  return (
    fallback ||
    String(streamQuery).toLowerCase() === "1" ||
    String(streamQuery).toLowerCase() === "true" ||
    String(streamQuery).toLowerCase() === "stream"
  );
}

function setupSseResponse(res) {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.write("event: open\ndata: {\"status\":\"connected\"}\n\n");
}

function sendHistoryToStream(res, items) {
  if (!Array.isArray(items) || items.length === 0) return;
  for (const event of items) {
    buildSseStream(res, event.eventType || "history", event);
  }
}

async function startSseRoute(res, filters = {}, sinceMs = 0) {
  setupSseResponse(res);

  const history = await listRecentEvents({
    sinceMs,
    sinceId: filters.sinceId || 0,
    callRef: filters.callRef || "",
    eventType: filters.eventType || "",
    numberRef: filters.numberRef || "",
    mediaSessionRef: filters.mediaSessionRef || "",
    accountId: filters.accountId || ""
  });
  sendHistoryToStream(res, history);

  const unsubscribe = subscribeVoiceEvents((event) => {
    buildSseStream(res, event.eventType || "voice_event", event);
  }, filters);

  const heartbeat = startHeartbeat(res);

  res.on("close", () => {
    if (heartbeat) {
      clearInterval(heartbeat);
    }
    unsubscribe();
  });

  return { heartbeat, unsubscribe };
}

function outboundStatusUpdateEnded(update = {}) {
  if (!update || typeof update !== "object") return false;

  return Boolean(
    update.endedAt ||
      update.ended_at ||
      update.finishedAt ||
      update.finished_at ||
      update.completedAt ||
      update.completed_at ||
      update.endTime ||
      update.end_time
  );
}

function outboundStatusDurationSeconds(update = {}) {
  const value =
    update.durationSeconds ??
    update.duration_seconds ??
    update.duration ??
    update.billsec ??
    update.billSec ??
    0;
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function outboundStatusUpdateAnswered(update = {}) {
  if (!update || typeof update !== "object") return false;

  return Boolean(
    update.answeredAt ||
      update.answered_at ||
      update.answerTime ||
      update.answer_time ||
      update.answeredBy ||
      update.answered_by ||
      outboundStatusDurationSeconds(update) > 0
  );
}

function terminalUnknownOutboundStatus(rawStatus, update = {}) {
  const normalized = String(rawStatus || "").trim().toUpperCase();
  if (normalized !== "UNKNOWN" || !outboundStatusUpdateEnded(update)) return rawStatus;

  return outboundStatusUpdateAnswered(update) ? "COMPLETED" : "FAILED";
}

function unknownOutboundTerminalReason(rawStatus, update = {}) {
  const normalized = String(rawStatus || "").trim().toUpperCase();
  if (normalized !== "UNKNOWN" || !outboundStatusUpdateEnded(update)) return "";

  return "provider_unknown_terminal";
}

function outboundOperatorUnknownGraceMs() {
  const value = Number(
    process.env.TELEPHONY_OUTBOUND_OPERATOR_UNKNOWN_GRACE_MS || 35000
  );
  return Number.isFinite(value) && value > 0 ? value : 35000;
}

function requestContextStartedAtMs(requestContext = {}) {
  const explicit = Number(
    requestContext.startedAtMs ||
      requestContext.createdAtMs ||
      requestContext.started_at_ms ||
      requestContext.created_at_ms ||
      0
  );
  if (Number.isFinite(explicit) && explicit > 0) return explicit;

  const value =
    requestContext.startedAt ||
    requestContext.createdAt ||
    requestContext.started_at ||
    requestContext.created_at ||
    "";
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function routingModeIsOperator(requestContext = {}) {
  const routingMode = String(
    requestContext.routingMode || requestContext.routing_mode || ""
  )
    .trim()
    .toLowerCase();
  return routingMode === "operator";
}

function runtimeMediaSessionActiveForCall(callRef) {
  if (!callRef) return false;

  for (const entry of activeRuntimeMediaSessionWatchers.values()) {
    if (entry.callRef === callRef && !entry.stopped && !entry.terminalPublished) {
      return true;
    }
  }

  return false;
}

function shouldDeferOperatorUnknownTerminal(
  rawStatus,
  update = {},
  requestContext = {},
  callRef = ""
) {
  const normalized = String(rawStatus || "").trim().toUpperCase();
  if (normalized !== "UNKNOWN") return false;
  if (!outboundStatusUpdateEnded(update)) return false;
  if (outboundStatusUpdateAnswered(update)) return false;
  if (!routingModeIsOperator(requestContext)) return false;

  if (runtimeMediaSessionActiveForCall(callRef)) return true;

  const startedAtMs = requestContextStartedAtMs(requestContext);
  if (!startedAtMs) return false;

  return Date.now() - startedAtMs < outboundOperatorUnknownGraceMs();
}

function buildOutboundStatusEvent(callRef, statusUpdate, requestContext = {}) {
  const update = statusUpdate && typeof statusUpdate === "object" ? statusUpdate : {};
  const rawStatus =
    update && typeof update === "object"
      ? update.status || update.state || update.type || ""
      : statusUpdate;
  const effectiveRawStatus = terminalUnknownOutboundStatus(rawStatus, update);
  const unknownTerminalReason = unknownOutboundTerminalReason(rawStatus, update);
  const status = normalizeOnelinkDialStatus(effectiveRawStatus);

  return enrichLifecycleEvent({
    eventType: "call_status",
    callRef,
    source: "bridge.api",
    accountId: requestContext.accountId || "",
    requestId: requestContext.requestId || "",
    idempotencyKey: requestContext.idempotencyKey || "",
    routingMode: requestContext.routingMode || "",
    callDirection: "outbound",
    direction: "outbound",
    status,
    rawStatus,
    raw_status: rawStatus,
    reason: update.reason || unknownTerminalReason || "",
    endReason: update.endReason || update.end_reason || update.reason || unknownTerminalReason || "",
    end_reason: update.endReason || update.end_reason || update.reason || unknownTerminalReason || "",
    endedBy: update.endedBy || update.ended_by || "",
    ended_by: update.endedBy || update.ended_by || "",
    hangupInitiator: update.hangupInitiator || update.hangup_initiator || "",
    hangup_initiator: update.hangupInitiator || update.hangup_initiator || "",
    terminalSource: update.terminalSource || update.terminal_source || (unknownTerminalReason ? "provider_cdr" : ""),
    terminal_source: update.terminalSource || update.terminal_source || (unknownTerminalReason ? "provider_cdr" : ""),
    providerPayload: update && typeof update === "object" ? update : undefined
  });
}

async function publishOutboundStatusEvent(callRef, statusUpdate, requestContext = {}) {
  const event = buildOutboundStatusEvent(callRef, statusUpdate, requestContext);
  return publishAndForwardOutboundStatusEvent(event, requestContext);
}

function outboundStatusForwardOptions(event, requestContext = {}) {
  return {
    idempotencyKey:
      requestContext.idempotencyKey ||
      event.idempotencyKey ||
      event.idempotency_key ||
      "",
    accountId: requestContext.accountId || event.accountId || event.account_id || "",
    requestId: requestContext.requestId || event.requestId || event.request_id || ""
  };
}

function forwardOutboundStatusEventToOnelink(event, requestContext = {}) {
  void enqueueOnelinkForward(
    event,
    outboundStatusForwardOptions(event, requestContext),
    {
      message: "failed to forward outbound status event to onelink",
      eventType: event.eventType || event.event_type || null,
      callRef: event.callRef || event.call_ref || null,
      accountId: requestContext.accountId || event.accountId || event.account_id || null
    }
  );
}

async function publishAndForwardOutboundStatusEvent(event, requestContext = {}) {
  const published = await publishVoiceEvent(event);
  rememberLifecycleEventState(event);
  if (staleNonTerminalLifecycleEvent(event)) {
    logger.info("skipped stale non-terminal outbound status after terminal", {
      callRef: outboundLifecycleCallRef(event),
      eventType: event.eventType || event.event_type || null
    });
  } else {
    forwardOutboundStatusEventToOnelink(event, requestContext);
  }
  if (outboundLifecycleTerminal(event)) {
    stopOutboundStatusPollerForCall(outboundLifecycleCallRef(event));
    stopRuntimeMediaSessionWatchersForCall(outboundLifecycleCallRef(event));
  }
  return published;
}

function outboundStatusPollIntervalMs() {
  const value = Number(process.env.TELEPHONY_OUTBOUND_STATUS_POLL_INTERVAL_MS || 2000);
  return Number.isFinite(value) && value > 0 ? value : 2000;
}

function outboundStatusPollTimeoutMs() {
  const value = Number(process.env.TELEPHONY_OUTBOUND_STATUS_POLL_TIMEOUT_MS || 120000);
  return Number.isFinite(value) && value > 0 ? value : 120000;
}

function uninformativeOutboundStatus(
  value,
  update = {},
  requestContext = {},
  callRef = ""
) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!normalized || normalized === "UNSPECIFIED") return true;
  if (shouldDeferOperatorUnknownTerminal(normalized, update, requestContext, callRef)) {
    logger.info("deferred operator outbound UNKNOWN terminal while runtime route can still start", {
      callRef,
      elapsedMs: requestContextStartedAtMs(requestContext)
        ? Date.now() - requestContextStartedAtMs(requestContext)
        : null,
      graceMs: outboundOperatorUnknownGraceMs(),
      runtimeMediaSessionActive: runtimeMediaSessionActiveForCall(callRef)
    });
    return true;
  }
  if (normalized === "UNKNOWN") return !outboundStatusUpdateEnded(update);

  return false;
}

const activeOutboundStatusPollers = new Set();
const activeRuntimeMediaSessionWatchers = new Map();
const outboundLifecycleCallRefs = new Map();
const terminalLifecycleCallRefs = new Map();
const operatorControlCallRefs = new Map();
const asteriskAriManagedCallRefs = new Map();
const onelinkForwardQueues = new Map();

function stopOutboundStatusPollerForCall(callRef) {
  if (!callRef) return;
  activeOutboundStatusPollers.delete(callRef);
}

function outboundStatusResumeWindowMs() {
  const value = Number(process.env.TELEPHONY_OUTBOUND_STATUS_RESUME_WINDOW_MS || 0);
  if (Number.isFinite(value) && value > 0) return value;
  return Math.max(outboundStatusPollTimeoutMs() * 2, 30 * 60 * 1000);
}

function lifecycleValue(event = {}, ...keys) {
  const data = event.data && typeof event.data === "object" ? event.data : {};
  for (const key of keys) {
    if (event[key] !== undefined && event[key] !== null && event[key] !== "") {
      return event[key];
    }
    if (data[key] !== undefined && data[key] !== null && data[key] !== "") {
      return data[key];
    }
  }
  return "";
}

function outboundLifecycleCallRef(event = {}) {
  return String(
    lifecycleValue(
      event,
      "callRef",
      "call_ref",
      "bridgeCallRef",
      "bridge_call_ref",
      "providerCallId",
      "provider_call_id"
    ) || ""
  ).trim();
}

function isOutboundLifecycleEvent(event = {}) {
  const direction = String(
    lifecycleValue(event, "callDirection", "call_direction", "direction") || ""
  ).trim().toLowerCase();
  return direction === "outbound";
}

function outboundLifecycleStatusKey(event = {}) {
  return normalizeCurrentStatus(
    lifecycleValue(event, "currentStatus", "current_status", "status") || ""
  );
}

function outboundLifecycleTerminal(event = {}) {
  if (event.terminal === true || event.data?.terminal === true) return true;
  const statusKey = outboundLifecycleStatusKey(event);
  return TERMINAL_CURRENT_STATUSES.has(statusKey);
}

function lifecycleCallRefMemoryMs() {
  const value = Number(
    process.env.TELEPHONY_BRIDGE_LIFECYCLE_CALL_REF_MEMORY_MS || 21600000
  );
  return Number.isFinite(value) && value > 0 ? value : 21600000;
}

function pruneLifecycleCallRefMap(map, now = Date.now()) {
  for (const [callRef, expiresAt] of map.entries()) {
    if (!callRef || expiresAt <= now) {
      map.delete(callRef);
    }
  }
}

function rememberLifecycleCallRef(map, callRef, ttlMs = lifecycleCallRefMemoryMs()) {
  const normalizedCallRef = String(callRef || "").trim();
  if (!normalizedCallRef) return;

  const now = Date.now();
  pruneLifecycleCallRefMap(map, now);
  map.set(normalizedCallRef, now + ttlMs);
}

function lifecycleCallRefKnown(map, callRef) {
  const normalizedCallRef = String(callRef || "").trim();
  if (!normalizedCallRef) return false;

  const expiresAt = map.get(normalizedCallRef);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    map.delete(normalizedCallRef);
    return false;
  }

  return true;
}

function rememberOutboundLifecycleCallRef(callRef) {
  rememberLifecycleCallRef(outboundLifecycleCallRefs, callRef);
}

function rememberTerminalLifecycleCallRef(callRef) {
  rememberLifecycleCallRef(terminalLifecycleCallRefs, callRef);
}

function outboundLifecycleCallRefKnown(callRef) {
  return lifecycleCallRefKnown(outboundLifecycleCallRefs, callRef);
}

function terminalLifecycleCallRefKnown(callRef) {
  return lifecycleCallRefKnown(terminalLifecycleCallRefs, callRef);
}

function rememberOperatorControlCallRef(callRef) {
  rememberLifecycleCallRef(operatorControlCallRefs, callRef, 2 * 60 * 1000);
}

function operatorControlCallRefKnown(callRef) {
  return lifecycleCallRefKnown(operatorControlCallRefs, callRef);
}

function rememberAsteriskAriManagedCallRef(callRef) {
  rememberLifecycleCallRef(asteriskAriManagedCallRefs, callRef);
}

function asteriskAriManagedCallRefKnown(callRef) {
  return lifecycleCallRefKnown(asteriskAriManagedCallRefs, callRef);
}

function rememberLifecycleEventState(event = {}) {
  const callRef = outboundLifecycleCallRef(event);
  if (!callRef) return;

  if (isOutboundLifecycleEvent(event)) {
    rememberOutboundLifecycleCallRef(callRef);
  }

  if (outboundLifecycleTerminal(event)) {
    rememberTerminalLifecycleCallRef(callRef);
  }
}

function outboundRuntimeLifecycleEvent(event = {}) {
  const callRef = outboundLifecycleCallRef(event);
  if (!callRef || !outboundLifecycleCallRefKnown(callRef)) return event;

  return enrichLifecycleEvent({
    ...event,
    callDirection: "outbound",
    call_direction: "outbound"
  });
}

function staleNonTerminalLifecycleEvent(event = {}) {
  const callRef = outboundLifecycleCallRef(event);
  return Boolean(
    callRef &&
      terminalLifecycleCallRefKnown(callRef) &&
      !outboundLifecycleTerminal(event)
  );
}

function outboundLifecycleRequestContext(event = {}) {
  return {
    accountId: String(lifecycleValue(event, "accountId", "account_id") || ""),
    requestId: String(lifecycleValue(event, "requestId", "request_id") || ""),
    idempotencyKey: String(lifecycleValue(event, "idempotencyKey", "idempotency_key") || ""),
    routingMode: String(lifecycleValue(event, "routingMode", "routing_mode") || "")
  };
}

function onelinkForwardQueueKey(event = {}, options = {}) {
  const callRef = outboundLifecycleCallRef(event);
  const accountId = String(options.accountId || lifecycleValue(event, "accountId", "account_id") || "");
  return callRef ? `${accountId}:${callRef}` : `${accountId}:unscoped`;
}

function enqueueOnelinkForward(event, options = {}, logContext = {}) {
  const key = onelinkForwardQueueKey(event, options);
  const previous = onelinkForwardQueues.get(key) || Promise.resolve();
  const queued = previous
    .catch(() => {})
    .then(() => onelink.forwardInboundEvent(event, options))
    .catch((error) => {
      logger.warn(logContext.message || "failed to forward event to onelink", {
        ...logContext,
        message: error.message,
        type: error.type || "unknown"
      });
    })
    .finally(() => {
      if (onelinkForwardQueues.get(key) === queued) {
        onelinkForwardQueues.delete(key);
      }
    });

  onelinkForwardQueues.set(key, queued);
  return queued;
}

function outboundLifecycleProvider(event = {}) {
  return String(
    lifecycleValue(event, "provider", "statusProvider", "status_provider") || ""
  ).trim().toLowerCase();
}

function runtimeMediaSessionWatchIntervalMs() {
  const value = Number(
    process.env.TELEPHONY_BRIDGE_RUNTIME_MEDIA_SESSION_POLL_INTERVAL_MS || 1000
  );
  return Number.isFinite(value) && value > 0 ? value : 1000;
}

function runtimeMediaSessionMaxDurationMs() {
  const value = Number(
    process.env.TELEPHONY_BRIDGE_RUNTIME_MEDIA_SESSION_MAX_DURATION_MS || 21600000
  );
  return Number.isFinite(value) && value > 0 ? value : 21600000;
}

function runtimeMediaSessionUnobservedGraceMs() {
  const value = Number(
    process.env.TELEPHONY_BRIDGE_RUNTIME_MEDIA_SESSION_UNOBSERVED_GRACE_MS || 15000
  );
  return Number.isFinite(value) && value > 0 ? value : 15000;
}

function asteriskAriEventsEnabled() {
  const value = process.env.TELEPHONY_BRIDGE_ASTERISK_ARI_EVENTS_ENABLED;
  if (value === undefined || value === null || value === "") return true;
  return ["1", "true", "yes", "on", "enabled"].includes(
    String(value).trim().toLowerCase()
  );
}

function asteriskAriEventsApp() {
  return (
    process.env.TELEPHONY_BRIDGE_ASTERISK_ARI_EVENTS_APP ||
    "onelink-telephony-bridge"
  );
}

function asteriskAriReconnectMinMs() {
  const value = Number(
    process.env.TELEPHONY_BRIDGE_ASTERISK_ARI_EVENTS_RECONNECT_MIN_MS || 1000
  );
  return Number.isFinite(value) && value > 0 ? value : 1000;
}

function asteriskAriReconnectMaxMs() {
  const value = Number(
    process.env.TELEPHONY_BRIDGE_ASTERISK_ARI_EVENTS_RECONNECT_MAX_MS || 30000
  );
  return Number.isFinite(value) && value > 0 ? value : 30000;
}

function asteriskAriHeartbeatMs() {
  const value = Number(
    process.env.TELEPHONY_BRIDGE_ASTERISK_ARI_EVENTS_HEARTBEAT_MS || 25000
  );
  return Number.isFinite(value) && value > 0 ? value : 25000;
}

function asteriskAriEventsUrl() {
  const url = new URL(asteriskAriBaseUrl());
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/events`;
  url.searchParams.set("app", asteriskAriEventsApp());
  url.searchParams.set("subscribeAll", "true");
  return url.toString();
}

function runtimeMediaSessionWatcherKey(callRef, mediaSessionRef) {
  return `${callRef}:${mediaSessionRef}`;
}

function runtimeMediaSessionRef(event = {}) {
  return String(
    lifecycleValue(event, "mediaSessionRef", "media_session_ref") || ""
  ).trim();
}

function runtimeMediaSessionEventType(event = {}) {
  return String(lifecycleValue(event, "eventType", "event_type") || "")
    .trim()
    .toLowerCase();
}

function isRuntimeMediaSessionOutboundStart(event = {}) {
  if (runtimeMediaSessionEventType(event) !== "session_started") return false;
  return isOutboundLifecycleEvent(event);
}

function isRuntimeMediaSessionAnsweredEvent(event = {}) {
  const eventType = runtimeMediaSessionEventType(event);
  if (eventType === "answered" || eventType === "operator_answered") return true;

  const status = normalizeCurrentStatus(
    lifecycleValue(event, "currentStatus", "current_status", "status") || ""
  );
  return status === "in_progress";
}

function runtimeMediaSessionRequestContext(event = {}, requestContext = {}) {
  const lifecycleContext = outboundLifecycleRequestContext(event);
  return {
    ...requestContext,
    accountId: requestContext.accountId || lifecycleContext.accountId,
    requestId: requestContext.requestId || lifecycleContext.requestId,
    routingMode:
      requestContext.routingMode ||
      lifecycleContext.routingMode ||
      String(lifecycleValue(event, "routingMode", "routing_mode") || "")
  };
}

function markRuntimeMediaSessionAnswered(callRef) {
  if (!callRef) return;

  for (const entry of activeRuntimeMediaSessionWatchers.values()) {
    if (entry.callRef === callRef) {
      entry.answered = true;
    }
  }
}

function stopRuntimeMediaSessionWatchersForCall(callRef) {
  if (!callRef) return;

  for (const [key, entry] of activeRuntimeMediaSessionWatchers.entries()) {
    if (entry.callRef !== callRef) continue;
    entry.terminalPublished = true;
    entry.stopped = true;
    activeRuntimeMediaSessionWatchers.delete(key);
  }
}

function handleRuntimeMediaSessionLifecycle(event = {}, requestContext = {}) {
  const callRef = outboundLifecycleCallRef(event);
  if (!callRef) return;

  if (outboundLifecycleTerminal(event)) {
    stopOutboundStatusPollerForCall(callRef);
    stopRuntimeMediaSessionWatchersForCall(callRef);
    return;
  }

  if (isRuntimeMediaSessionAnsweredEvent(event)) {
    markRuntimeMediaSessionAnswered(callRef);
  }

  if (!isRuntimeMediaSessionOutboundStart(event)) return;

  const mediaSessionRef = runtimeMediaSessionRef(event);
  if (!mediaSessionRef) return;

  startRuntimeMediaSessionWatcher({
    callRef,
    mediaSessionRef,
    requestContext: runtimeMediaSessionRequestContext(event, requestContext)
  });
}

function runtimeMediaSessionTerminalReason(entry, fallbackReason = "") {
  if (operatorControlCallRefKnown(entry.callRef)) return "operator_hangup";
  if (entry.answered) return "remote_hangup";
  return fallbackReason;
}

function runtimeMediaSessionTerminalMetadata(entry, reason = "") {
  const normalizedReason = String(reason || "").toLowerCase();
  if (normalizedReason.includes("operator")) {
    return {
      endedBy: "operator",
      ended_by: "operator",
      hangupInitiator: "operator",
      hangup_initiator: "operator",
      terminalSource: "operator_control",
      terminal_source: "operator_control"
    };
  }

  if (normalizedReason.includes("remote") || normalizedReason.includes("caller")) {
    return {
      endedBy: "caller",
      ended_by: "caller",
      hangupInitiator: "caller",
      hangup_initiator: "caller",
      terminalSource: "ari_runtime_media",
      terminal_source: "ari_runtime_media"
    };
  }

  return {
    terminalSource: "ari_runtime_media",
    terminal_source: "ari_runtime_media"
  };
}

function runtimeMediaSessionBridgeExitControlGraceMs() {
  const value = Number(
    process.env.TELEPHONY_BRIDGE_RUNTIME_MEDIA_SESSION_BRIDGE_EXIT_CONTROL_GRACE_MS || 300
  );
  return Number.isFinite(value) && value >= 0 ? value : 300;
}

async function publishRuntimeMediaSessionTerminal(entry, status, channel = {}, reason = "", metadata = {}) {
  if (entry.stopped || entry.terminalPublished) return;
  entry.terminalPublished = true;

  const idempotencyKey = `runtime_media_session:${status}:${entry.callRef}:${entry.mediaSessionRef}`;
  const terminalAt = new Date().toISOString();
  await publishOutboundStatusEvent(
    entry.callRef,
    {
      ...sipuniAriStatusPayload(status, channel, reason),
      provider: "fonoster_runtime_media",
      mediaSessionRef: entry.mediaSessionRef,
      media_session_ref: entry.mediaSessionRef,
      occurredAt: terminalAt,
      occurred_at: terminalAt,
      endedAt: terminalAt,
      ended_at: terminalAt,
      ...metadata
    },
    {
      ...entry.requestContext,
      idempotencyKey
    }
  );

  logger.info("published runtime media session terminal status", {
    callRef: entry.callRef,
    mediaSessionRef: entry.mediaSessionRef,
    status,
    reason,
    answered: entry.answered
  });
}

function addAriChannelCandidate(target, value) {
  if (value === undefined || value === null || value === "") return;
  target.add(String(value));
}

function collectAriChannelCandidates(target, value) {
  if (!value) return;

  if (typeof value === "string") {
    addAriChannelCandidate(target, value);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectAriChannelCandidates(target, item);
    }
    return;
  }

  if (typeof value !== "object") return;

  addAriChannelCandidate(target, value.id);
  addAriChannelCandidate(target, value.linkedid);
  addAriChannelCandidate(target, value.uniqueid);
  addAriChannelCandidate(target, value.name);
}

function ariEventChannelCandidates(event = {}) {
  const candidates = new Set();
  collectAriChannelCandidates(candidates, event.channel);
  collectAriChannelCandidates(candidates, event.peer);
  collectAriChannelCandidates(candidates, event.forwarded);
  collectAriChannelCandidates(candidates, event.originator);
  collectAriChannelCandidates(candidates, event.target);
  collectAriChannelCandidates(candidates, event.bridge?.channels);
  return candidates;
}

function runtimeMediaSessionEntriesForAriEvent(event = {}) {
  const candidates = ariEventChannelCandidates(event);
  if (!candidates.size) return [];

  return [...activeRuntimeMediaSessionWatchers.values()].filter((entry) =>
    candidates.has(entry.mediaSessionRef)
  );
}

function normalizeAriEventType(event = {}) {
  return String(event.type || event.eventType || event.event_type || "").trim();
}

function normalizeAriDialStatus(event = {}) {
  return String(
    event.dialstatus ||
      event.dialStatus ||
      event.dial_status ||
      event.status ||
      ""
  ).trim();
}

function ariChannelState(event = {}) {
  return String(
    event.channel?.state ||
      event.peer?.state ||
      event.forwarded?.state ||
      ""
  ).trim();
}

function ariEventCause(event = {}) {
  return String(
    event.cause_txt ||
      event.causeText ||
      event.cause_text ||
      event.cause ||
      event.hangupcause ||
      event.hangupCause ||
      ""
  ).trim();
}

function ariEventIndicatesAnswered(event = {}) {
  const type = normalizeAriEventType(event);
  const dialStatus = normalizeOnelinkDialStatus(normalizeAriDialStatus(event));
  const channelState = ariChannelState(event).toLowerCase();

  if (dialStatus === "answered") return true;
  if (type === "ChannelStateChange" && channelState === "up") return true;
  if (type === "ChannelEnteredBridge" && channelState === "up") return true;
  return false;
}

function ariEventIsTerminal(entry, event = {}) {
  const type = normalizeAriEventType(event);
  if (
    type === "ChannelHangupRequest" ||
    type === "ChannelDestroyed" ||
    type === "StasisEnd"
  ) {
    return true;
  }

  if (type === "ChannelLeftBridge" && entry?.answered) return true;

  if (type !== "Dial" && type !== "DialEnd") return false;

  const status = statusToCurrentStatus(
    normalizeOnelinkDialStatus(normalizeAriDialStatus(event)),
    "call_status"
  );
  return TERMINAL_CURRENT_STATUSES.has(status);
}

function ariTerminalStatusForEvent(entry, event = {}) {
  const type = normalizeAriEventType(event);
  if (type === "ChannelLeftBridge" && entry.answered) return "COMPLETED";

  const rawDialStatus = normalizeAriDialStatus(event);
  if (rawDialStatus) {
    const normalizedDialStatus = normalizeOnelinkDialStatus(rawDialStatus);
    const currentStatus = statusToCurrentStatus(normalizedDialStatus, "call_status");
    if (TERMINAL_CURRENT_STATUSES.has(currentStatus)) {
      if (currentStatus === "no_answer") return "NO_ANSWER";
      return currentStatus.toUpperCase();
    }
  }

  const cause = ariEventCause(event).toLowerCase();
  if (cause.includes("busy")) return "BUSY";
  if (cause.includes("no answer") || cause.includes("no_answer")) return "NO_ANSWER";
  if (cause.includes("cancel")) return "CANCELLED";
  if (cause.includes("reject") || cause.includes("decline")) return "REJECTED";
  if (cause.includes("fail")) return "FAILED";

  return entry.answered ? "COMPLETED" : "NO_ANSWER";
}

function ariTerminalReasonForEvent(entry, event = {}) {
  const type = normalizeAriEventType(event) || "unknown";
  if (type === "ChannelLeftBridge" && entry.answered) {
    return operatorControlCallRefKnown(entry.callRef)
      ? "operator_hangup"
      : "remote_hangup";
  }

  const cause = ariEventCause(event)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  const suffix = cause || (entry.answered ? "after_answer" : "before_answer");
  return `ari_${type.toLowerCase()}_${suffix}`;
}

async function publishAriRuntimeMediaSessionTerminal(entry, event = {}) {
  const reason = ariTerminalReasonForEvent(entry, event);
  await publishRuntimeMediaSessionTerminal(
    entry,
    ariTerminalStatusForEvent(entry, event),
    event.channel || event.peer || {},
    reason,
    runtimeMediaSessionTerminalMetadata(entry, reason)
  );
}

function scheduleAriRuntimeMediaSessionTerminal(entry, event = {}) {
  const type = normalizeAriEventType(event);
  const publish = () => {
    void publishAriRuntimeMediaSessionTerminal(entry, event).catch((error) => {
      logger.warn("failed to publish ARI runtime media terminal", {
        callRef: entry.callRef,
        mediaSessionRef: entry.mediaSessionRef,
        eventType: type,
        message: error.message
      });
    });
  };

  if (type === "ChannelLeftBridge" && entry.answered) {
    publish();
    return;
  }

  publish();
}

function handleAriRuntimeMediaSessionEvent(event = {}) {
  const entries = runtimeMediaSessionEntriesForAriEvent(event);
  if (!entries.length) return;

  const type = normalizeAriEventType(event);
  const dialStatus = normalizeAriDialStatus(event);
  const channelState = ariChannelState(event);

  for (const entry of entries) {
    if (entry.terminalPublished) continue;

    if (ariEventIndicatesAnswered(event)) {
      entry.answered = true;
    }

    logger.info("runtime media session ARI event observed", {
      callRef: entry.callRef,
      mediaSessionRef: entry.mediaSessionRef,
      eventType: type,
      dialStatus: dialStatus || null,
      channelState: channelState || null,
      answered: entry.answered
    });

    if (!ariEventIsTerminal(entry, event)) continue;

    scheduleAriRuntimeMediaSessionTerminal(entry, event);
  }
}

async function watchRuntimeMediaSession(entry) {
  const startedAt = Date.now();
  const intervalMs = runtimeMediaSessionWatchIntervalMs();
  const maxDurationMs = runtimeMediaSessionMaxDurationMs();
  const unobservedGraceMs = runtimeMediaSessionUnobservedGraceMs();
  let observedChannel = false;
  let lastChannel = {};
  let lastStatus = "";

  try {
    while (!entry.stopped && Date.now() - startedAt < maxDurationMs) {
      await sleep(intervalMs);

      let channel;
      try {
        channel = await fetchAsteriskAriChannel(entry.mediaSessionRef);
      } catch (error) {
        logger.warn("runtime media session ARI poll failed", {
          callRef: entry.callRef,
          mediaSessionRef: entry.mediaSessionRef,
          message: error.message
        });
        continue;
      }

      if (!channel) {
        if (!observedChannel && !entry.answered) {
          if (Date.now() - startedAt < unobservedGraceMs) continue;

          logger.warn("runtime media session was not observable in ARI", {
            callRef: entry.callRef,
            mediaSessionRef: entry.mediaSessionRef,
            unobservedGraceMs
          });
          return;
        }

        const terminalStatus = entry.answered ? "COMPLETED" : "NO_ANSWER";
        const terminalReason = runtimeMediaSessionTerminalReason(
          entry,
          entry.answered
            ? "runtime_media_session_ended_after_answer"
            : "runtime_media_session_ended_before_answer"
        );
        await publishRuntimeMediaSessionTerminal(
          entry,
          terminalStatus,
          lastChannel,
          terminalReason,
          runtimeMediaSessionTerminalMetadata(entry, terminalReason)
        );
        return;
      }

      observedChannel = true;
      lastChannel = channel;
      const status = sipuniAriStatusForChannel(channel);
      if (status === "ANSWER") {
        entry.answered = true;
      }

      if (status && status !== lastStatus) {
        lastStatus = status;
        logger.info("runtime media session state observed", {
          callRef: entry.callRef,
          mediaSessionRef: entry.mediaSessionRef,
          status,
          asteriskState: channel.state || ""
        });
      }
    }

    if (!entry.stopped) {
      logger.warn("runtime media session watcher reached max duration", {
        callRef: entry.callRef,
        mediaSessionRef: entry.mediaSessionRef,
        maxDurationMs,
        answered: entry.answered
      });
    }
  } finally {
    const key = runtimeMediaSessionWatcherKey(entry.callRef, entry.mediaSessionRef);
    if (activeRuntimeMediaSessionWatchers.get(key) === entry) {
      activeRuntimeMediaSessionWatchers.delete(key);
    }
  }
}

function startRuntimeMediaSessionWatcher({ callRef, mediaSessionRef, requestContext = {} }) {
  const key = runtimeMediaSessionWatcherKey(callRef, mediaSessionRef);
  if (activeRuntimeMediaSessionWatchers.has(key)) return;

  const entry = {
    callRef,
    mediaSessionRef,
    requestContext,
    answered: false,
    terminalPublished: false,
    stopped: false
  };

  activeRuntimeMediaSessionWatchers.set(key, entry);
  logger.info("started runtime media session watcher", {
    callRef,
    mediaSessionRef,
    accountId: requestContext.accountId || null
  });

  void watchRuntimeMediaSession(entry).catch((error) => {
    logger.warn("runtime media session watcher stopped", {
      callRef,
      mediaSessionRef,
      message: error.message
    });
  });
}

let asteriskAriEventSocket = null;
let asteriskAriEventReconnectTimer = null;
let asteriskAriEventReconnectAttempt = 0;
let asteriskAriEventHeartbeatTimer = null;

function clearAsteriskAriEventHeartbeat() {
  if (!asteriskAriEventHeartbeatTimer) return;
  clearInterval(asteriskAriEventHeartbeatTimer);
  asteriskAriEventHeartbeatTimer = null;
}

function startAsteriskAriEventHeartbeat(socket) {
  clearAsteriskAriEventHeartbeat();

  const intervalMs = asteriskAriHeartbeatMs();
  let healthy = true;

  socket.on("pong", () => {
    healthy = true;
  });

  asteriskAriEventHeartbeatTimer = setInterval(() => {
    if (socket.readyState !== WebSocket.OPEN) return;

    if (!healthy) {
      logger.warn("Asterisk ARI event websocket heartbeat missed");
      socket.terminate();
      return;
    }

    healthy = false;
    try {
      socket.ping();
    } catch (error) {
      logger.warn("failed to ping Asterisk ARI event websocket", {
        message: error.message
      });
      socket.terminate();
    }
  }, intervalMs);
}

function asteriskAriReconnectDelayMs() {
  const minMs = asteriskAriReconnectMinMs();
  const maxMs = asteriskAriReconnectMaxMs();
  const exponential = minMs * (2 ** Math.min(asteriskAriEventReconnectAttempt, 5));
  return Math.min(maxMs, exponential);
}

function scheduleAsteriskAriEventReconnect() {
  if (!asteriskAriEventsEnabled()) return;
  if (asteriskAriEventReconnectTimer) return;

  const delayMs = asteriskAriReconnectDelayMs();
  asteriskAriEventReconnectAttempt += 1;
  asteriskAriEventReconnectTimer = setTimeout(() => {
    asteriskAriEventReconnectTimer = null;
    connectAsteriskAriEventSocket();
  }, delayMs);

  logger.warn("scheduled Asterisk ARI event websocket reconnect", {
    delayMs,
    attempt: asteriskAriEventReconnectAttempt
  });
}

function connectAsteriskAriEventSocket() {
  if (!asteriskAriEventsEnabled()) {
    logger.info("Asterisk ARI event websocket disabled");
    return;
  }

  if (
    asteriskAriEventSocket &&
    (
      asteriskAriEventSocket.readyState === WebSocket.OPEN ||
      asteriskAriEventSocket.readyState === WebSocket.CONNECTING
    )
  ) {
    return;
  }

  let url;
  let headers;
  try {
    url = asteriskAriEventsUrl();
    headers = { Authorization: asteriskAriAuthHeader() };
  } catch (error) {
    logger.warn("Asterisk ARI event websocket is not configured", {
      message: error.message
    });
    return;
  }

  const socket = new WebSocket(url, { headers });
  asteriskAriEventSocket = socket;

  socket.on("open", () => {
    asteriskAriEventReconnectAttempt = 0;
    logger.info("Asterisk ARI event websocket connected", {
      app: asteriskAriEventsApp(),
      subscribeAll: true
    });
    startAsteriskAriEventHeartbeat(socket);
  });

  socket.on("message", (data) => {
    let event;
    try {
      event = JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : String(data));
    } catch (error) {
      logger.warn("failed to parse Asterisk ARI event", {
        message: error.message
      });
      return;
    }

    handleAriRuntimeMediaSessionEvent(event);
  });

  socket.on("error", (error) => {
    logger.warn("Asterisk ARI event websocket error", {
      message: error.message
    });
  });

  socket.on("close", (code, reason) => {
    if (asteriskAriEventSocket === socket) {
      asteriskAriEventSocket = null;
    }
    clearAsteriskAriEventHeartbeat();

    logger.warn("Asterisk ARI event websocket closed", {
      code,
      reason: reason ? reason.toString() : ""
    });
    scheduleAsteriskAriEventReconnect();
  });
}

function startAsteriskAriEventListener({ delayMs = 0 } = {}) {
  if (delayMs > 0) {
    setTimeout(connectAsteriskAriEventSocket, delayMs);
    return;
  }

  connectAsteriskAriEventSocket();
}

function startResumedOutboundStatusPoller(callRef, createdEvent = {}) {
  const context = outboundLifecycleRequestContext(createdEvent);
  if (outboundLifecycleProvider(createdEvent) === "asterisk_sipuni") {
    rememberAsteriskAriManagedCallRef(callRef);
    startOutboundStatusStreamPoller(
      callRef,
      createSipuniAsteriskStatusStream(callRef),
      context
    );
    return;
  }

  startOutboundStatusPoller(callRef, context);
}

async function resumeOutboundStatusPollers({ delayMs = 0 } = {}) {
  if (delayMs > 0) {
    await sleep(delayMs);
  }

  const sinceMs = Date.now() - outboundStatusResumeWindowMs();
  const events = await listRecentEvents({
    sinceMs,
    eventType:
      "call_created,call_status,session_completed,session_failed,transfer_completed,transfer_failed,rejected",
    limit: 1000
  });
  const byCallRef = new Map();

  for (const event of events) {
    const callRef = outboundLifecycleCallRef(event);
    if (!callRef) continue;

    const current = byCallRef.get(callRef) || { created: null, terminal: false, latestSeq: 0 };
    const seq = Number(event.seq || event.id || 0) || 0;

    if (
      isOutboundLifecycleEvent(event) &&
      (event.eventType === "call_created" || event.event_type === "call_created")
    ) {
      current.created = event;
      rememberOutboundLifecycleCallRef(callRef);
    }

    if (outboundLifecycleTerminal(event)) {
      current.terminal = true;
      rememberTerminalLifecycleCallRef(callRef);
    }

    current.latestSeq = Math.max(current.latestSeq, seq);
    byCallRef.set(callRef, current);
  }

  let resumed = 0;
  for (const [callRef, state] of byCallRef.entries()) {
    if (!state.created || state.terminal) continue;
    startResumedOutboundStatusPoller(callRef, state.created);
    resumed += 1;
  }

  if (resumed > 0) {
    logger.info("resumed outbound status pollers", {
      resumed,
      windowMs: outboundStatusResumeWindowMs()
    });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function outboundProviderStatus(callRecord = {}) {
  if (!callRecord || typeof callRecord !== "object") return "";

  return (
    callRecord.status ||
    callRecord.state ||
    callRecord.callStatus ||
    callRecord.call_status ||
    callRecord.currentStatus ||
    callRecord.current_status ||
    ""
  );
}

function outboundStatusKey(event = {}) {
  return String(event.currentStatus || event.current_status || event.status || "").trim();
}

function isSdkNotFoundError(error = {}) {
  const code = Number(error.code);
  const message = String(error.message || error.details || "").toLowerCase();

  return code === 5 || message.includes("not_found") || message.includes("not found");
}

function outboundStatusNotFoundGraceMs() {
  const value = Number(config.outbound?.statusNotFoundGraceMs || 15000);
  return Number.isFinite(value) && value > 0 ? value : 15000;
}

async function publishOutboundNotFoundTerminal(callRef, error, requestContext = {}) {
  const event = buildOutboundStatusEvent(
    callRef,
    {
      status: "no-answer",
      reason: "provider_call_not_found",
      error: error.message || "call resource was not found",
      notFound: true,
      not_found: true
    },
    {
      ...requestContext,
      idempotencyKey:
        requestContext.idempotencyKey || `outbound_status:not_found:${callRef}`
    }
  );

  await publishAndForwardOutboundStatusEvent(event, requestContext);
  logger.info("published outbound not-found terminal status", {
    callRef,
    currentStatus: event.currentStatus || event.current_status || null,
    reason: event.endReason || event.end_reason || null,
    terminal: Boolean(event.terminal)
  });
}

async function pollOutboundStatus(callRef, requestContext = {}) {
  const startedAt = Date.now();
  const intervalMs = outboundStatusPollIntervalMs();
  const timeoutMs = outboundStatusPollTimeoutMs();
  let lastStatusKey = "created";
  let notFoundCount = 0;

  while (activeOutboundStatusPollers.has(callRef) && Date.now() - startedAt < timeoutMs) {
    await sleep(intervalMs);

    let callRecord;
    try {
      callRecord = await withSdkRetry((sdk) => sdk.calls.getCall(callRef));
      notFoundCount = 0;
    } catch (error) {
      if (isSdkNotFoundError(error)) {
        notFoundCount += 1;
        const elapsedMs = Date.now() - startedAt;
        const graceMs = Math.max(outboundStatusNotFoundGraceMs(), intervalMs * 3);
        if (elapsedMs >= graceMs && notFoundCount >= 3) {
          await publishOutboundNotFoundTerminal(callRef, error, requestContext);
          return;
        }

        logger.info("outbound status poll not-found within grace window", {
          callRef,
          elapsedMs,
          graceMs,
          notFoundCount
        });
        continue;
      }

      logger.warn("outbound status poll failed", {
        callRef,
        message: error.message,
        notFoundCount
      });
      continue;
    }

    const rawStatus = outboundProviderStatus(callRecord);
    if (uninformativeOutboundStatus(rawStatus, callRecord, requestContext, callRef)) {
      continue;
    }

    const event = buildOutboundStatusEvent(
      callRef,
      { ...(callRecord || {}), status: rawStatus },
      requestContext
    );
    const statusKey = outboundStatusKey(event);
    if (!statusKey || statusKey === lastStatusKey) {
      if (event.terminal) return;
      continue;
    }

    await publishAndForwardOutboundStatusEvent(event, requestContext);
    logger.info("published polled outbound status", {
      callRef,
      rawStatus,
      currentStatus: event.currentStatus || event.current_status || null,
      terminal: Boolean(event.terminal)
    });
    lastStatusKey = statusKey;

    if (event.terminal) {
      return;
    }
  }

  if (!activeOutboundStatusPollers.has(callRef)) {
    logger.info("outbound status poller stopped by lifecycle terminal", {
      callRef
    });
    return;
  }

  logger.warn("outbound status poll timed out", {
    callRef,
    timeoutMs
  });
}

function startOutboundStatusPoller(callRef, requestContext = {}) {
  const normalizedCallRef = String(callRef || "").trim();
  if (!normalizedCallRef) return;
  if (activeOutboundStatusPollers.has(normalizedCallRef)) return;

  activeOutboundStatusPollers.add(normalizedCallRef);
  void pollOutboundStatus(normalizedCallRef, requestContext)
    .catch((error) => {
      logger.warn("outbound status poller stopped", {
        callRef: normalizedCallRef,
        message: error.message
      });
    })
    .finally(() => {
      activeOutboundStatusPollers.delete(normalizedCallRef);
    });
}

function startOutboundStatusStreamPoller(callRef, statusStream, requestContext = {}) {
  const normalizedCallRef = String(callRef || "").trim();
  if (!normalizedCallRef) return;
  if (!statusStream || typeof statusStream[Symbol.asyncIterator] !== "function") {
    startOutboundStatusPoller(normalizedCallRef, requestContext);
    return;
  }
  if (activeOutboundStatusPollers.has(normalizedCallRef)) return;

  activeOutboundStatusPollers.add(normalizedCallRef);
  let terminalObserved = false;
  void (async () => {
    for await (const statusUpdate of statusStream) {
      const rawStatus =
        statusUpdate && typeof statusUpdate === "object"
          ? statusUpdate.status || statusUpdate.state || statusUpdate.type || ""
          : statusUpdate;
      if (
        uninformativeOutboundStatus(
          rawStatus,
          statusUpdate,
          requestContext,
          normalizedCallRef
        )
      ) continue;

      const event = buildOutboundStatusEvent(normalizedCallRef, statusUpdate, requestContext);
      await publishAndForwardOutboundStatusEvent(event, requestContext);
      if (event.terminal) {
        terminalObserved = true;
        return;
      }
    }
  })()
    .catch((error) => {
      logger.warn("outbound status stream failed", {
        callRef: normalizedCallRef,
        message: error.message
      });
    })
    .finally(() => {
      activeOutboundStatusPollers.delete(normalizedCallRef);
      if (!terminalObserved && !terminalLifecycleCallRefKnown(normalizedCallRef)) {
        logger.info("outbound status stream ended before terminal; starting CDR fallback poller", {
          callRef: normalizedCallRef
        });
        startOutboundStatusPoller(normalizedCallRef, requestContext);
      }
    });
}

function watchOutboundStatusStream(callRef, statusStream, requestContext = {}) {
  startOutboundStatusStreamPoller(callRef, statusStream, requestContext);
}

function startCallOutboundStream(res, callRef, statusStream, requestContext = {}) {
  setupSseResponse(res);
  let closed = false;
  const heartbeat = startHeartbeat(res);

  const close = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
    }
  };

  res.on("close", close);

  buildSseStream(res, "call_created", enrichLifecycleEvent({
    callRef,
    createdAt: new Date().toISOString(),
    direction: "outbound",
    callDirection: "outbound",
    currentStatus: "created",
    ...requestContext
  }));

  (async () => {
    let lastTerminal = false;
    try {
      for await (const statusUpdate of statusStream) {
        if (closed) {
          break;
        }

        const rawStatus =
          statusUpdate && typeof statusUpdate === "object"
            ? statusUpdate.status || statusUpdate.state || statusUpdate.type || ""
            : statusUpdate;
        if (uninformativeOutboundStatus(rawStatus, statusUpdate, requestContext, callRef)) continue;

        const event = buildOutboundStatusEvent(callRef, statusUpdate, requestContext);
        lastTerminal = Boolean(event.terminal);
        await publishAndForwardOutboundStatusEvent(event, requestContext);
        buildSseStream(res, "call_status", {
          ...event,
          streamState: getStreamState()
        });
      }

      if (!closed && !lastTerminal) {
        buildSseStream(res, "call_status_stream_closed", {
          callRef,
          eventType: "call_status_stream_closed",
          source: "bridge.api",
          currentStatus: "created",
          current_status: "created",
          terminal: false,
          streamState: getStreamState()
        });
      }
    } catch (error) {
      if (!closed) {
        buildSseStream(res, "call_status_error", {
          callRef,
          error: error?.message || "call_status_failed"
        });
      }
    } finally {
      close();
    }
  })().finally(() => {
    if (!res.writableEnded) {
      res.end();
    }
  });
}

function buildEventsPollPayload({
  res,
  items,
  sinceId,
  sinceMs,
  path,
  callRef
}) {
  const nextSinceId = items.length > 0 ? items[items.length - 1].seq : sinceId;
  const payload = {
    path,
    callRef,
    items,
    queryState: {
      nextSinceId,
      sinceMs,
      remaining: items.length,
      hasMore: false
    },
    streamState: getStreamState()
  };

  if (!callRef) {
    delete payload.callRef;
  }

  res.json(payload);
}

function normalizeInboundEvent(payload = {}) {
  const normalized = normalizeBody(payload, {
    callRef: ["call_ref", "callReference"],
    bridgeCallRef: ["bridge_call_ref", "parent_call_ref", "parentCallRef"],
    runtimeCallRef: ["runtime_call_ref", "child_call_ref", "childCallRef"],
    providerCallId: ["provider_call_id", "providerCallId"],
    mediaSessionRef: ["media_session_ref", "mediaSessionReference"],
    numberRef: ["number_ref", "numberRef", "ingressNumberRef", "ingress_number_ref"],
    ingressNumber: ["ingress_number", "ingressNumber"],
    callerNumber: ["caller_number", "callerNumber"],
    eventType: ["event", "event_type", "type"],
    appRef: ["app_ref", "application_ref", "applicationRef"],
    providerEventType: ["provider_event_type", "providerEventType"],
    providerStatus: ["provider_status", "providerStatus"],
    providerLegRef: ["provider_leg_ref", "providerLegRef"],
    providerReason: ["provider_reason", "providerReason"],
    providerError: ["provider_error", "providerError"],
    accountId: ["account_id", "accountId", "x-account-id"],
    idempotencyKey: ["idempotency_key", "idempotencyKey"]
  });
  const bridgeCallRef =
    normalized.bridgeCallRef ||
    normalized.callRef ||
    normalized.providerCallId ||
    "";
  if (bridgeCallRef) {
    if (normalized.callRef && normalized.callRef !== bridgeCallRef) {
      normalized.legacy_call_ref = normalized.callRef;
      normalized.legacyCallRef = normalized.callRef;
    }
    normalized.callRef = bridgeCallRef;
    normalized.call_ref = bridgeCallRef;
    normalized.bridgeCallRef = bridgeCallRef;
    normalized.bridge_call_ref = normalized.bridge_call_ref || bridgeCallRef;
    normalized.parentCallRef = normalized.parentCallRef || bridgeCallRef;
    normalized.parent_call_ref = normalized.parent_call_ref || bridgeCallRef;
    normalized.providerCallId = normalized.providerCallId || bridgeCallRef;
    normalized.provider_call_id = normalized.provider_call_id || bridgeCallRef;
  }
  if (normalized.runtimeCallRef) {
    normalized.runtime_call_ref = normalized.runtime_call_ref || normalized.runtimeCallRef;
    normalized.childCallRef = normalized.childCallRef || normalized.runtimeCallRef;
    normalized.child_call_ref = normalized.child_call_ref || normalized.runtimeCallRef;
  }

  const eventType = String(normalized.eventType || "").toLowerCase();

  if (eventType === "dial_status") {
    normalizeEventStatusField(normalized, "status");
  }

  if (eventType === "session_completed") {
    normalizeEventStatusField(normalized, "outcome");
  }

  return enrichLifecycleEvent(normalized);
}

function isSsePreferred(req) {
  const accept = req.get("accept") || "";
  return accept.includes("text/event-stream");
}

function extractIngressNumber(number) {
  return number?.telUrl ? String(number.telUrl).replace(/^tel:/, "") : "";
}

function normalizeDialableNumber(value) {
  return String(value || "").trim().replace(/^tel:/i, "");
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }

  return "";
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function resolveSipuniAsteriskNumberRef(payload = {}, metadata = {}) {
  return firstNonEmpty(
    payload.fromNumberRef,
    payload.from_number_ref,
    metadata.from_number_ref,
    metadata.fromNumberRef,
    metadata.number_ref,
    metadata.numberRef
  );
}

function isSipuniOutboundNumberRef(payload = {}, metadata = {}) {
  const numberRef = resolveSipuniAsteriskNumberRef(payload, metadata);
  return Boolean(
    numberRef &&
      Array.isArray(config.asterisk?.sipuniOutboundNumberRefs) &&
      config.asterisk.sipuniOutboundNumberRefs.includes(numberRef)
  );
}

function optInFlagEnabled(...values) {
  return values.some((value) =>
    ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase())
  );
}

function sipuniDirectAsteriskOutboundEnabled(metadata = {}) {
  return optInFlagEnabled(
    metadata.sipuni_direct_asterisk_outbound,
    metadata.sipuniDirectAsteriskOutbound,
    process.env.TELEPHONY_BRIDGE_SIPUNI_DIRECT_ASTERISK_OUTBOUND_ENABLED
  );
}

function isSipuniAsteriskOutbound(payload = {}, metadata = {}) {
  return isSipuniOutboundNumberRef(payload, metadata) &&
    sipuniDirectAsteriskOutboundEnabled(metadata);
}

function operatorFirstOutboundEnabled(metadata = {}) {
  return optInFlagEnabled(
    metadata.allow_operator_first_outbound,
    metadata.allowOperatorFirstOutbound,
    process.env.TELEPHONY_BRIDGE_OPERATOR_FIRST_OUTBOUND_ENABLED
  );
}

function sipuniProviderFirstMetadata(payload = {}, metadata = {}) {
  if (!isSipuniOutboundNumberRef(payload, metadata)) return {};

  const numberRef = resolveSipuniAsteriskNumberRef(payload, metadata);
  return {
    source: "sipuni_provider_first_outbound",
    provider_path: "fonoster_sipuni_provider_first",
    providerPath: "fonoster_sipuni_provider_first",
    sipuni_internal_outbound: true,
    sipuni_original_number_ref: numberRef,
    sipuniOriginalNumberRef: numberRef,
    sipuni_ingress_number: config.asterisk?.sipuniOutboundIngressNumber || "",
    sipuniIngressNumber: config.asterisk?.sipuniOutboundIngressNumber || "",
    sipuni_internal_number: config.asterisk?.sipuniOutboundCallerId || "",
    sipuniInternalNumber: config.asterisk?.sipuniOutboundCallerId || ""
  };
}

function sipuniRuntimeNumberRef(metadata = {}) {
  return firstNonEmpty(
    metadata.sipuni_outbound_runtime_number_ref,
    metadata.sipuniOutboundRuntimeNumberRef,
    config.asterisk?.sipuniOutboundRuntimeNumberRef
  );
}

function sipuniRuntimeOutboundPayload(payload = {}, metadata = {}) {
  const sourceNumberRef = resolveSipuniAsteriskNumberRef(payload, metadata);
  const runtimeNumberRef = sipuniRuntimeNumberRef(metadata);

  return {
    ...payload,
    fromNumberRef: sourceNumberRef || payload.fromNumberRef,
    from_number_ref: sourceNumberRef || payload.from_number_ref,
    metadata: {
      ...metadata,
      source: "sipuni_local_asterisk_outbound",
      provider_path: "asterisk_sipuni",
      providerPath: "asterisk_sipuni",
      sipuni_internal_outbound: true,
      sipuni_original_number_ref: sourceNumberRef,
      sipuniOriginalNumberRef: sourceNumberRef,
      sipuni_runtime_number_ref: runtimeNumberRef || "",
      sipuniRuntimeNumberRef: runtimeNumberRef || "",
      sipuni_ingress_number: config.asterisk?.sipuniOutboundIngressNumber || "",
      sipuniIngressNumber: config.asterisk?.sipuniOutboundIngressNumber || "",
      sipuni_internal_number: config.asterisk?.sipuniOutboundCallerId || "",
      sipuniInternalNumber: config.asterisk?.sipuniOutboundCallerId || ""
    }
  };
}

function normalizeSipuniOutboundDestination(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("8")) {
    digits = `7${digits.slice(1)}`;
  }
  return digits.length >= 3 ? digits : "";
}

function asteriskAriAuthHeader() {
  const username = config.asterisk?.ariUsername || "";
  const secret = config.asterisk?.ariSecret || "";
  if (!username || !secret) {
    throw new Error("Asterisk ARI credentials are not configured");
  }

  return `Basic ${Buffer.from(`${username}:${secret}`).toString("base64")}`;
}

function asteriskAriBaseUrl() {
  const ariBaseUrl = String(config.asterisk?.ariBaseUrl || "").replace(/\/+$/, "");
  if (!ariBaseUrl) {
    throw new Error("Asterisk ARI base URL is not configured");
  }
  return ariBaseUrl;
}

function sipuniAriStatusPollIntervalMs() {
  const value = Number(
    process.env.TELEPHONY_BRIDGE_SIPUNI_ARI_STATUS_POLL_INTERVAL_MS || 1000
  );
  return Number.isFinite(value) && value > 0 ? value : 1000;
}

function sipuniAriStatusPollTimeoutMs() {
  const value = Number(
    process.env.TELEPHONY_BRIDGE_SIPUNI_ARI_STATUS_POLL_TIMEOUT_MS || 120000
  );
  return Number.isFinite(value) && value > 0 ? value : 120000;
}

function sipuniAriStatusMaxDurationMs() {
  const value = Number(
    process.env.TELEPHONY_BRIDGE_SIPUNI_ARI_STATUS_MAX_DURATION_MS || 21600000
  );
  return Number.isFinite(value) && value > 0 ? value : 21600000;
}

async function fetchAsteriskAriChannel(callRef) {
  const url = `${asteriskAriBaseUrl()}/channels/${encodeURIComponent(callRef)}`;
  const response = await fetch(url, {
    headers: {
      Authorization: asteriskAriAuthHeader()
    }
  });
  const bodyText = await response.text();
  let body = {};
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch (_error) {
    body = { raw: bodyText };
  }

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const message = body?.message || body?.error || bodyText || response.statusText;
    throw new Error(`Asterisk ARI channel status failed: HTTP ${response.status} ${message}`);
  }

  return body;
}

async function hangupAsteriskAriChannel(callRef) {
  const url = `${asteriskAriBaseUrl()}/channels/${encodeURIComponent(callRef)}`;
  const response = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: asteriskAriAuthHeader()
    }
  });
  const bodyText = await response.text();

  if (response.status === 404) {
    return { attempted: true, found: false, status: response.status };
  }

  if (!response.ok && response.status !== 204) {
    let body = {};
    try {
      body = bodyText ? JSON.parse(bodyText) : {};
    } catch (_error) {
      body = { raw: bodyText };
    }
    const message = body?.message || body?.error || bodyText || response.statusText;
    throw new Error(`Asterisk ARI channel hangup failed: HTTP ${response.status} ${message}`);
  }

  return { attempted: true, found: true, status: response.status };
}

function sipuniAriStatusForChannel(channel = {}) {
  const state = String(channel.state || "").trim().toLowerCase();
  if (state === "up") return "ANSWER";
  if (state === "busy") return "BUSY";
  if (state === "ring" || state === "ringing" || state === "dialing") {
    return "RINGING";
  }
  return state ? "RINGING" : "";
}

function sipuniAriStatusPayload(status, channel = {}, reason = "") {
  return {
    status,
    reason,
    provider: "asterisk_sipuni",
    asteriskChannelId: channel.id || "",
    asterisk_channel_id: channel.id || "",
    asteriskChannelName: channel.name || "",
    asterisk_channel_name: channel.name || "",
    asteriskState: channel.state || "",
    asterisk_state: channel.state || ""
  };
}

async function* createSipuniAsteriskStatusStream(callRef) {
  const startedAt = Date.now();
  const intervalMs = sipuniAriStatusPollIntervalMs();
  const answerTimeoutMs = sipuniAriStatusPollTimeoutMs();
  const maxDurationMs = sipuniAriStatusMaxDurationMs();
  let answered = false;
  let lastStatus = "";
  let lastChannel = {};

  while (Date.now() - startedAt < maxDurationMs) {
    await sleep(intervalMs);

    let channel;
    try {
      channel = await fetchAsteriskAriChannel(callRef);
    } catch (error) {
      logger.warn("Sipuni ARI status poll failed", {
        callRef,
        message: error.message
      });
      continue;
    }

    if (!channel) {
      const terminalStatus = answered ? "COMPLETED" : "NO_ANSWER";
      if (lastStatus !== terminalStatus) {
        yield sipuniAriStatusPayload(
          terminalStatus,
          lastChannel,
          answered ? "asterisk_channel_ended_after_answer" : "asterisk_channel_ended_before_answer"
        );
      }
      return;
    }

    lastChannel = channel;
    const status = sipuniAriStatusForChannel(channel);
    if (!status) {
      continue;
    }

    if (status === "ANSWER") {
      answered = true;
    }

    if (status === lastStatus) {
      if (!answered && Date.now() - startedAt >= answerTimeoutMs) {
        yield sipuniAriStatusPayload(
          "NO_ANSWER",
          channel,
          "asterisk_status_poll_timeout_before_answer"
        );
        return;
      }
      continue;
    }

    lastStatus = status;
    yield sipuniAriStatusPayload(status, channel, "asterisk_channel_state");

    if (!answered && Date.now() - startedAt >= answerTimeoutMs) {
      yield sipuniAriStatusPayload(
        "NO_ANSWER",
        channel,
        "asterisk_status_poll_timeout_before_answer"
      );
      return;
    }
  }

  const terminalStatus = answered ? "COMPLETED" : "NO_ANSWER";
  yield sipuniAriStatusPayload(
    terminalStatus,
    lastChannel,
    answered ? "asterisk_status_poll_max_duration_after_answer" : "asterisk_status_poll_timeout_before_answer"
  );
}

async function createSipuniAsteriskOutboundCall({
  payload,
  payloadMetadata,
  appDecision,
  outboundMetadata,
  routingMode,
  accountId,
  requestId,
  idempotencyKey
}) {
  const destination = normalizeSipuniOutboundDestination(payload.to);
  if (!destination) {
    throw new Error("to is required");
  }

  const endpointName = config.asterisk?.sipuniOutboundEndpoint || "";
  if (!endpointName) {
    throw new Error("Sipuni outbound endpoint is not configured");
  }

  const numberRef = resolveSipuniAsteriskNumberRef(payload, payloadMetadata);
  const callRef = randomUUID();
  const callerId = config.asterisk?.sipuniOutboundCallerId || "207";
  const ariBaseUrl = asteriskAriBaseUrl();

  const url = new URL(`${ariBaseUrl}/channels`);
  url.searchParams.set("endpoint", `PJSIP/${destination}@${endpointName}`);
  url.searchParams.set("app", "mediacontroller");
  url.searchParams.set("callerId", callerId);
  url.searchParams.set("timeout", String(payload.timeout || 60));
  url.searchParams.set("channelId", callRef);

  const metadata = {
    ...outboundMetadata,
    source: "sipuni_local_asterisk_outbound",
    provider: "sipuni",
    number_ref: numberRef,
    numberRef,
    sipuni_endpoint: endpointName,
    sipuni_internal_number: callerId,
    destination,
    original_to: payload.to
  };

  const variables = {
    APP_REF: appDecision.appRef || "",
    CALL_REF: callRef,
    CALL_DIRECTION: "outbound",
    INGRESS_NUMBER: config.asterisk?.sipuniOutboundIngressNumber || "",
    ONELINK_ACCOUNT_ID: accountId || "",
    ONELINK_MODE: routingMode || "operator",
    ONELINK_NUMBER_REF: numberRef || "",
    FONOSTER_RECORDING: outboundMetadata.recording_enabled === false ? "off" : "on",
    METADATA: JSON.stringify(metadata)
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: asteriskAriAuthHeader(),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ variables })
  });
  const bodyText = await response.text();
  let body = {};
  try {
    body = bodyText ? JSON.parse(bodyText) : {};
  } catch (_error) {
    body = { raw: bodyText };
  }

  if (!response.ok) {
    const message = body?.message || body?.error || bodyText || response.statusText;
    throw new Error(`Asterisk ARI originate failed: HTTP ${response.status} ${message}`);
  }

  rememberAsteriskAriManagedCallRef(callRef);

  logger.info("created Sipuni outbound call via local Asterisk", {
    callRef,
    endpoint: endpointName,
    destination,
    callerId,
    numberRef,
    requestId,
    accountId,
    idempotencyKey
  });

  return {
    ref: callRef,
    statusStream: createSipuniAsteriskStatusStream(callRef),
    provider: "asterisk_sipuni",
    asteriskChannel: body
  };
}

async function invalidateRouteCacheForNumber(numberRef) {
  try {
    const number = await withSdkRetry((sdk) => sdk.numbers.getNumber(numberRef));
    return onelink.invalidateRouteCache({
      numberRef,
      ingressNumber: extractIngressNumber(number)
    });
  } catch (_error) {
    return onelink.invalidateRouteCache({ numberRef });
  }
}

async function resolveFromNumber(sdk, body) {
  if (body.from) return normalizeDialableNumber(body.from);
  const numberRef = body.fromNumberRef || body.from_number_ref;
  if (!numberRef) return null;
  const number = await sdk.numbers.getNumber(numberRef);
  return normalizeDialableNumber(number?.telUrl);
}

async function updateNumberRoute(sdk, params) {
  const mode = params.mode;
  if (
    mode !== "ai" &&
    mode !== "app" &&
    mode !== "agent" &&
    mode !== "ai-agent" &&
    mode !== "operator" &&
    mode !== "clear"
  ) {
    throw new Error("unsupported mode");
  }

  return await updateNumberRouteInRoutr({
    numberRef: params.numberRef,
    mode,
    appRef: params.appRef,
    agentAor: params.agentAor,
    accessKeyId: config.fonoster.accessKeyId
  });
}

const app = express();
app.use(express.json({ limit: "1mb" }));
app.set("trust proxy", config.security?.trustProxy || false);

app.use((req, _res, next) => {
  req.requestId = req.get("x-request-id") || randomUUID();

  const path = req.url.split("?")[0];
  const query = req.url.slice(path.length);

  if (path === "/api/telephony" || path.startsWith("/api/telephony/")) {
    req.url = path.replace(/^\/api/, "") + query;
  } else if (
    path === "/api/v1/telephony" ||
    path.startsWith("/api/v1/telephony/")
  ) {
    req.url = path.replace(/^\/api\/v1/, "") + query;
  } else if (
    path.match(/^\/api\/v1\/accounts\/[^/]+\/telephony(?:$|\/)/)
  ) {
    req.url = path.replace(
      /^\/api\/v1\/accounts\/[^/]+\/telephony/,
      "/telephony"
    ) + query;
  }

  attachRequestContext(req, path);
  next();
});

app.use((req, res, next) => {
  res.setHeader("x-request-id", req.requestId);
  const startTs = Date.now();
  res.on("finish", () => {
    if (!config.security?.logHttpRequests) return;
    logger.info("http request", {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      status: res.statusCode,
      durationMs: Date.now() - startTs,
      accountId: req.accountId || null
    });
  });
  next();
});

app.get(
  "/healthz",
  asyncRoute(async (_req, res) => {
    const applications = await withSdkRetry((sdk) =>
      sdk.applications.listApplications({ pageSize: 1 })
    );

    res.json({
      ok: true,
      service: "telephony-bridge",
      contractMarker: {
        version: "operator-observability-v1",
        fields: [
          "operatorObservabilityKey",
          "operatorSlaClass",
          "recordingImportContract",
          "transcriptContract"
        ],
        classes: [
          "first_class_runtime",
          "degraded_direct_bridge",
          "blocked_recursive_handoff"
        ],
        recordingContracts: [
          "runtime_owned_no_fonoster_import",
          "fonoster_pull_recording_ready_required"
        ]
      },
      fonoster: {
        endpoint: config.fonoster.endpoint,
        accessKeyId: config.fonoster.accessKeyId,
        applicationsReachable: Array.isArray(applications.items)
      },
      onelink: onelink.getStatus(),
      legacyChatwootCompatibility: {
        configured: onelink.isConfigured()
      }
    });
  })
);

app.get(
  "/telephony/capabilities",
  asyncRoute(async (_req, res) => {
    res.json({
      bridgeSurface: {
        implemented: [
        "healthz",
        "telephony/calls",
        "telephony/calls/:callRef",
        "telephony/calls/outbound",
        "telephony/calls/outbound/stream",
        "telephony/calls/:callRef/events",
        "telephony/calls/:callRef/events/poll",
        "telephony/calls/:callRef/events/stream",
        "telephony/calls/:callRef/events/:eventType/stream",
        "telephony/calls/:callRef/events/:eventType/poll",
        "telephony/calls/:callRef/stream",
        "telephony/calls/:callRef/poll",
        "telephony/calls/:callRef/events/:eventType",
        "telephony/calls/:callRef/terminate",
        "telephony/calls/:callRef/reject",
        "telephony/calls/:callRef/hangup",
        "telephony/calls/:callRef/end",
        "telephony/calls/:callRef/cancel",
        "telephony/webphone/calls/:callRef/terminate",
        "telephony/webphone/calls/:callRef/reject",
        "telephony/webphone/calls/:callRef/hangup",
        "telephony/webphone/calls/:callRef/end",
        "telephony/webphone/calls/:callRef/cancel",
        "telephony/events/:eventType/stream",
        "telephony/events/:eventType/poll",
        "telephony/resources/summary",
          "telephony/events",
          "telephony/events/:callRef",
          "telephony/events/stream",
          "telephony/events/stream/:callRef",
          "telephony/events/poll",
          "telephony/events/:callRef/poll",
          "telephony/events/:callRef/stream",
          "telephony/events/state",
          "telephony/applications",
          "telephony/applications/:applicationRef",
          "telephony/applications/:applicationRef/intelligence",
          "telephony/numbers",
          "telephony/numbers/:numberRef",
          "telephony/trunks",
          "telephony/trunks/:trunkRef",
          "telephony/agents",
          "telephony/agents/:agentRef/enabled",
          "telephony/agents/:agentRef",
          "telephony/domains",
          "telephony/domains/:domainRef",
          "telephony/credentials",
          "telephony/credentials/:credentialRef",
          "telephony/secrets",
          "telephony/secrets/:secretRef",
          "telephony/numbers/:numberRef/route",
          "telephony/ai/toggle",
          "telephony/webphone/token",
          "internal/voice/inbound/route",
          "internal/voice/inbound/event"
        ],
        intendedForBridge: [
          "business-level telephony commands",
          "chatwoot-facing orchestration",
          "inbound route decisions",
          "ai on/off routing",
          "operator availability",
          "call history aggregation",
          "future chatwoot mappings and events"
        ]
      },
      browserTelephony: {
        status: "production_ready",
        productionReady: true,
        notes: [
          "telephony/webphone/token is expected to return a signed operator browser token",
          "the token payload must allow REGISTER and match TELEPHONY_BRIDGE_DEFAULT_OPERATOR_AGENT_AOR"
        ]
      },
      nativeFonosterSurface: {
        useDirectlyOrThroughSdk: [
          "applications CRUD",
          "numbers CRUD",
          "trunks CRUD",
          "domains CRUD",
          "credentials CRUD",
          "secrets CRUD",
          "full agent management",
          "raw resource administration"
        ]
      }
    });
  })
);

app.get(
  "/telephony/resources/summary",
  asyncRoute(async (_req, res) => {
    const [applications, numbers, trunks, agents, domains] = await withSdkRetry(
      async (sdk) =>
        await Promise.all([
          sdk.applications.listApplications({ pageSize: 100 }),
          sdk.numbers.listNumbers({ pageSize: 100 }),
          sdk.trunks.listTrunks({ pageSize: 100 }),
          sdk.agents.listAgents({ pageSize: 100 }),
          sdk.domains.listDomains({ pageSize: 100 })
        ])
    );

    res.json({
      counts: {
        applications: applications.items.length,
        numbers: numbers.items.length,
        trunks: trunks.items.length,
        agents: agents.items.length,
        domains: domains.items.length
      },
      firsts: {
        application: applications.items[0] || null,
        number: numbers.items[0] || null,
        trunk: trunks.items[0] || null,
        agent: agents.items[0] || null,
        domain: domains.items[0] || null
      }
    });
  })
);

app.get(
  "/telephony/events",
  asyncRoute(async (req, res) => {
    const isStreaming = isSsePreferred(req) || String(req.query.mode || "").toLowerCase() === "stream";
    const filters = parseEventFilters(req.query);
    const since = parseSinceMs(req.query);
    const sinceId = parseSinceSeq(req.query);
    const limit = parseLimit(req.query);

    if (isStreaming) {
      await startSseRoute(res, { ...filters, sinceId }, since);
      return;
    }

    if (parseLongPollMs(req.query) > 0) {
      res.redirect(307, `/telephony/events/poll?${req.url.split("?")[1] || ""}`);
      return;
    }

    const events = await listRecentEvents({
      sinceMs: since,
      sinceId,
      callRef: filters.callRef,
      eventType: filters.eventType,
      numberRef: filters.numberRef,
      mediaSessionRef: filters.mediaSessionRef,
      accountId: filters.accountId,
      limit
    });
    buildEventsPollPayload({
      res,
      items: events,
      sinceId,
      sinceMs: since,
      path: "telephony/events"
    });
  })
);

app.get(
  "/telephony/calls/:callRef/events",
  asyncRoute(async (req, res) => {
    const isStreaming =
      isSsePreferred(req) ||
      parseStreamMode(req.query, req.headers, String(req.query.mode || "").toLowerCase() === "stream");

    if (isStreaming) {
      const filters = parseEventFilters(req.query);
      const since = parseSinceMs(req.query);
      const sinceId = parseSinceSeq(req.query);
      await startSseRoute(
        res,
        {
          ...filters,
          callRef: [req.params.callRef],
          sinceId
        },
        since
      );
      return;
    }

    const filters = parseEventFilters(req.query);
    const limit = parseLimit(req.query);
    const sinceId = parseSinceSeq(req.query);
    const sinceMs = parseSinceMs(req.query);

    const items = await listRecentEvents({
      sinceMs,
      sinceId,
      callRef: [req.params.callRef],
      eventType: filters.eventType,
      numberRef: filters.numberRef,
      mediaSessionRef: filters.mediaSessionRef,
      accountId: filters.accountId,
      limit
    });
    buildEventsPollPayload({
      res,
      callRef: req.params.callRef,
      items,
      sinceId,
      sinceMs,
      path: "telephony/calls/:callRef/events"
    });
  })
);

app.get(
  "/telephony/events/stream",
  asyncRoute(async (req, res) => {
    const filters = parseEventFilters(req.query);
    const since = parseSinceMs(req.query);
    const sinceId = parseSinceSeq(req.query);
    await startSseRoute(res, { ...filters, sinceId }, since);
  })
);

app.get(
  "/telephony/events/stream/:callRef",
  asyncRoute(async (req, res) => {
    const filters = parseEventFilters(req.query);
    const since = parseSinceMs(req.query);
    const sinceId = parseSinceSeq(req.query);
    await startSseRoute(res, {
      ...filters,
      callRef: [req.params.callRef],
      sinceId
    }, since);
  })
);

app.get(
  "/telephony/events/poll",
  asyncRoute(async (req, res) => {
    const filters = parseEventFilters(req.query);
    const since = parseSinceMs(req.query);
    const sinceId = parseSinceSeq(req.query);
    const limit = parseLimit(req.query);
    const timeoutMs = parseLongPollMs(req.query);

    const readyEvents = await listRecentEvents({
      sinceMs: since,
      sinceId,
      callRef: filters.callRef,
      eventType: filters.eventType,
      numberRef: filters.numberRef,
      mediaSessionRef: filters.mediaSessionRef,
      accountId: filters.accountId,
      limit
    });

    if (readyEvents.length > 0) {
      return buildEventsPollPayload({
        res,
        items: readyEvents,
        sinceId,
        sinceMs: since,
        path: "telephony/events/poll"
      });
    }

    if (timeoutMs <= 0) {
      return buildEventsPollPayload({
        res,
        items: [],
        sinceId,
        sinceMs: since,
        path: "telephony/events/poll"
      });
    }

    const waited = await waitForMatchingEvent(filters, { timeoutMs });
    buildEventsPollPayload({
      res,
      items: waited,
      sinceId,
      sinceMs: since,
      path: "telephony/events/poll"
    });
  })
);

app.get(
  "/telephony/events/state",
  (req, res) => {
    res.json({
      streamState: getStreamState()
    });
  }
);

app.get(
  "/telephony/calls/:callRef/events/stream",
  asyncRoute(async (req, res) => {
    const filters = parseEventFilters(req.query);
    const since = parseSinceMs(req.query);
    const sinceId = parseSinceSeq(req.query);
    await startSseRoute(
      res,
      {
        ...filters,
        callRef: [req.params.callRef],
        sinceId
      },
      since
    );
  })
);

app.get(
  "/telephony/events/:callRef/stream",
  asyncRoute(async (req, res) => {
    const filters = parseEventFilters(req.query);
    const since = parseSinceMs(req.query);
    const sinceId = parseSinceSeq(req.query);
    await startSseRoute(
      res,
      {
        ...filters,
        callRef: [req.params.callRef],
        sinceId
      },
      since
    );
  })
);

app.get(
  "/telephony/calls/:callRef/stream",
  (req, res) => {
    const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    res.redirect(
      307,
      `/telephony/events/${req.params.callRef}/stream${query}`
    );
  }
);

app.get(
  "/telephony/events/:callRef/poll",
  asyncRoute(async (req, res) => {
    const filters = parseEventFilters(req.query);
    const since = parseSinceMs(req.query);
    const sinceId = parseSinceSeq(req.query);
    const limit = parseLimit(req.query);
    const timeoutMs = parseLongPollMs(req.query);

    const readyEvents = await listRecentEvents({
      sinceMs: since,
      sinceId,
      callRef: [req.params.callRef],
      eventType: filters.eventType,
      numberRef: filters.numberRef,
      mediaSessionRef: filters.mediaSessionRef,
      accountId: filters.accountId,
      limit
    });

    if (readyEvents.length > 0) {
      return buildEventsPollPayload({
        res,
        callRef: req.params.callRef,
        items: readyEvents,
        sinceId,
        sinceMs: since,
        path: "telephony/events/:callRef/poll"
      });
    }

    if (timeoutMs <= 0) {
      return buildEventsPollPayload({
        res,
        callRef: req.params.callRef,
        items: [],
        sinceId,
        sinceMs: since,
        path: "telephony/events/:callRef/poll"
      });
    }

    const waited = await waitForMatchingEvent(
      {
        ...filters,
        callRef: [req.params.callRef]
      },
      { timeoutMs }
    );
    buildEventsPollPayload({
      res,
      callRef: req.params.callRef,
      items: waited,
      sinceId,
      sinceMs: since,
      path: "telephony/events/:callRef/poll"
    });
  })
);

app.get(
  "/telephony/calls/:callRef/poll",
  (req, res) => {
    const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    res.redirect(
      307,
      `/telephony/calls/${req.params.callRef}/events/poll${query}`
    );
  }
);

app.get(
  "/telephony/events/:callRef",
  asyncRoute(async (req, res) => {
    const isStreaming =
      isSsePreferred(req) ||
      String(req.query.mode || "").toLowerCase() === "stream";
    if (isStreaming) {
      await startSseRoute(
        res,
        { callRef: [req.params.callRef], sinceId: parseSinceSeq(req.query) },
        parseSinceMs(req.query)
      );
      return;
    }

    const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    res.redirect(
      307,
      `/telephony/calls/${req.params.callRef}/events/poll${query}`
    );
  })
);

app.get(
  "/telephony/calls/:callRef/events/poll",
  asyncRoute(async (req, res) => {
    const filters = parseEventFilters(req.query);
    const since = parseSinceMs(req.query);
    const sinceId = parseSinceSeq(req.query);
    const limit = parseLimit(req.query);
    const timeoutMs = parseLongPollMs(req.query);

    const readyEvents = await listRecentEvents({
      sinceMs: since,
      sinceId,
      callRef: [req.params.callRef],
      eventType: filters.eventType,
      numberRef: filters.numberRef,
      mediaSessionRef: filters.mediaSessionRef,
      accountId: filters.accountId,
      limit
    });

    if (readyEvents.length > 0) {
      return buildEventsPollPayload({
        res,
        items: readyEvents,
        sinceId,
        sinceMs: since,
        path: "telephony/calls/:callRef/events/poll"
      });
    }

    if (timeoutMs <= 0) {
      return buildEventsPollPayload({
        res,
        items: [],
        sinceId,
        sinceMs: since,
        path: "telephony/calls/:callRef/events/poll"
      });
    }

    const waited = await waitForMatchingEvent(
      {
        ...filters,
        callRef: [req.params.callRef]
      },
      { timeoutMs }
    );
    buildEventsPollPayload({
      res,
      items: waited,
      sinceId,
      sinceMs: since,
      path: "telephony/calls/:callRef/events/poll"
    });
  })
);

app.get(
  "/telephony/calls/:callRef/events/:eventType",
  asyncRoute(async (req, res) => {
    const eventType = [String(req.params.eventType)];
    const isStreaming =
      isSsePreferred(req) ||
      parseStreamMode(req.query, req.headers, String(req.query.mode || "").toLowerCase() === "stream");

    if (isStreaming) {
      const since = parseSinceMs(req.query);
      const sinceId = parseSinceSeq(req.query);
      const filters = parseEventFilters(req.query);
      await startSseRoute(
        res,
        {
          ...filters,
          callRef: [req.params.callRef],
          eventType,
          sinceId
        },
        since
      );
      return;
    }

    const filters = {
      ...parseEventFilters(req.query),
      eventType
    };
    const limit = parseLimit(req.query);
    const sinceId = parseSinceSeq(req.query);
    const sinceMs = parseSinceMs(req.query);
    const timeoutMs = parseLongPollMs(req.query);

    const readyEvents = await listRecentEvents({
      sinceMs,
      sinceId,
      callRef: [req.params.callRef],
      eventType: filters.eventType,
      numberRef: filters.numberRef,
      mediaSessionRef: filters.mediaSessionRef,
      accountId: filters.accountId,
      limit
    });

    if (readyEvents.length > 0 || timeoutMs <= 0) {
      return buildEventsPollPayload({
        res,
        items: readyEvents,
        sinceId,
        sinceMs,
        path: "telephony/calls/:callRef/events/:eventType",
        callRef: req.params.callRef
      });
    }

    const waited = await waitForMatchingEvent(
      {
        ...filters,
        callRef: [req.params.callRef],
        eventType
      },
      { timeoutMs }
    );
    buildEventsPollPayload({
      res,
      items: waited,
      sinceId,
      sinceMs,
      path: "telephony/calls/:callRef/events/:eventType",
      callRef: req.params.callRef
    });
  })
);

app.get(
  "/telephony/calls/:callRef/events/:eventType/stream",
  (req, res) => {
    const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?") + 1) : "";
    const safeCallRef = encodeURIComponent(req.params.callRef || "");
    const safeEventType = encodeURIComponent(req.params.eventType || "");
    res.redirect(
      307,
      `/telephony/calls/${safeCallRef}/events/${safeEventType}?${query}${query ? "&" : ""}mode=stream`
    );
  }
);

app.get(
  "/telephony/calls/:callRef/events/:eventType/poll",
  (req, res) => {
    const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    const safeCallRef = encodeURIComponent(req.params.callRef || "");
    const safeEventType = encodeURIComponent(req.params.eventType || "");
    res.redirect(
      307,
      `/telephony/calls/${safeCallRef}/events/${safeEventType}${query}`
    );
  }
);

app.get(
  "/telephony/events/:eventType/stream",
  (req, res) => {
    const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    const eventType = encodeURIComponent(req.params.eventType || "");
    const separator = query ? `${query}&` : "?";
    res.redirect(
      307,
      `/telephony/events/stream${separator}event_type=${eventType}`
    );
  }
);

app.get(
  "/telephony/events/:eventType/poll",
  (req, res) => {
    const query = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
    const eventType = encodeURIComponent(req.params.eventType || "");
    const separator = query ? `${query}&` : "?";
    res.redirect(
      307,
      `/telephony/events/poll${separator}event_type=${eventType}`
    );
  }
);

app.get(
  "/telephony/applications",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.applications.listApplications(normalizePagination(req.query))
    );
    res.json(response);
  })
);

app.post(
  "/telephony/applications",
  asyncRoute(async (req, res) => {
    const payload = normalizeBody(req.body, {
      speechToText: ["speech_to_text", "stt"],
      textToSpeech: ["text_to_speech", "tts"]
    });
    const response = await withSdkRetry((sdk) =>
      sdk.applications.createApplication(payload)
    );
    res.status(201).json(response);
  })
);

app.get(
  "/telephony/applications/:applicationRef",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.applications.getApplication(req.params.applicationRef)
    );
    res.json(response);
  })
);

app.put(
  "/telephony/applications/:applicationRef",
  asyncRoute(async (req, res) => {
    const payload = normalizeBody(req.body, {
      speechToText: ["speech_to_text", "stt"],
      textToSpeech: ["text_to_speech", "tts"]
    });
    const response = await withSdkRetry((sdk) =>
      sdk.applications.updateApplication({ ...payload, ref: req.params.applicationRef })
    );
    res.json(response);
  })
);

app.patch(
  "/telephony/applications/:applicationRef",
  asyncRoute(async (req, res) => {
    const payload = normalizeBody(req.body, {
      speechToText: ["speech_to_text", "stt"],
      textToSpeech: ["text_to_speech", "tts"]
    });
    const response = await withSdkRetry((sdk) =>
      sdk.applications.updateApplication({ ...payload, ref: req.params.applicationRef })
    );
    res.json(response);
  })
);

app.delete(
  "/telephony/applications/:applicationRef",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.applications.deleteApplication(req.params.applicationRef)
    );
    res.json(response || { deleted: req.params.applicationRef });
  })
);

app.post(
  "/telephony/applications/:applicationRef/intelligence",
  asyncRoute(async (req, res) => {
    const payload = normalizeBody(req.body, {
      appRef: ["app_ref"],
      callRef: ["call_ref"],
      mediaSessionRef: ["media_session_ref"],
      languageCode: ["language_code"]
    });
    const response = await withSdkRetry((sdk) => {
      if (typeof sdk.applications.evaluateIntelligence !== "function") {
        throw new Error("evaluateIntelligence unavailable in this SDK runtime");
      }
      return sdk.applications.evaluateIntelligence({
        ...payload,
        appRef: req.params.applicationRef
      });
    });
    res.json(response);
  })
);

app.get(
  "/telephony/trunks",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.trunks.listTrunks(normalizePagination(req.query))
    );
    res.json(response);
  })
);

app.post(
  "/telephony/trunks",
  asyncRoute(async (req, res) => {
    const payload = normalizeBody(req.body, {
      transportUser: ["transport_user", "username"],
      inboundUri: ["inbound_uri", "inboundUri"]
    });
    const response = await withSdkRetry((sdk) =>
      sdk.trunks.createTrunk(payload)
    );
    res.status(201).json(response);
  })
);

app.get(
  "/telephony/trunks/:trunkRef",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.trunks.getTrunk(req.params.trunkRef)
    );
    res.json(response);
  })
);

app.put(
  "/telephony/trunks/:trunkRef",
  asyncRoute(async (req, res) => {
    const payload = normalizeBody(req.body, {
      transportUser: ["transport_user", "username"],
      inboundUri: ["inbound_uri", "inboundUri"]
    });
    const response = await withSdkRetry((sdk) =>
      sdk.trunks.updateTrunk({ ...payload, ref: req.params.trunkRef })
    );
    res.json(response);
  })
);

app.patch(
  "/telephony/trunks/:trunkRef",
  asyncRoute(async (req, res) => {
    const payload = normalizeBody(req.body, {
      transportUser: ["transport_user", "username"],
      inboundUri: ["inbound_uri", "inboundUri"]
    });
    const response = await withSdkRetry((sdk) =>
      sdk.trunks.updateTrunk({ ...payload, ref: req.params.trunkRef })
    );
    res.json(response);
  })
);

app.delete(
  "/telephony/trunks/:trunkRef",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.trunks.deleteTrunk(req.params.trunkRef)
    );
    res.json(response || { deleted: req.params.trunkRef });
  })
);

app.get(
  "/telephony/domains",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.domains.listDomains(normalizePagination(req.query))
    );
    res.json(response);
  })
);

app.post(
  "/telephony/domains",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.domains.createDomain(req.body || {})
    );
    res.status(201).json(response);
  })
);

app.get(
  "/telephony/domains/:domainRef",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.domains.getDomain(req.params.domainRef)
    );
    res.json(response);
  })
);

app.put(
  "/telephony/domains/:domainRef",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.domains.updateDomain({ ...req.body, ref: req.params.domainRef })
    );
    res.json(response);
  })
);

app.patch(
  "/telephony/domains/:domainRef",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.domains.updateDomain({ ...req.body, ref: req.params.domainRef })
    );
    res.json(response);
  })
);

app.delete(
  "/telephony/domains/:domainRef",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.domains.deleteDomain(req.params.domainRef)
    );
    res.json(response || { deleted: req.params.domainRef });
  })
);

app.get(
  "/telephony/credentials",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.credentials.listCredentials(normalizePagination(req.query))
    );
    res.json(response);
  })
);

app.post(
  "/telephony/credentials",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.credentials.createCredentials(req.body || {})
    );
    res.status(201).json(response);
  })
);

app.get(
  "/telephony/credentials/:credentialRef",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.credentials.getCredentials(req.params.credentialRef)
    );
    res.json(response);
  })
);

app.put(
  "/telephony/credentials/:credentialRef",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.credentials.updateCredentials({
        ...req.body,
        ref: req.params.credentialRef
      })
    );
    res.json(response);
  })
);

app.patch(
  "/telephony/credentials/:credentialRef",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.credentials.updateCredentials({
        ...req.body,
        ref: req.params.credentialRef
      })
    );
    res.json(response);
  })
);

app.delete(
  "/telephony/credentials/:credentialRef",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.credentials.deleteCredentials(req.params.credentialRef)
    );
    res.json(response || { deleted: req.params.credentialRef });
  })
);

app.get(
  "/telephony/secrets",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.secrets.listSecrets(normalizePagination(req.query))
    );
    res.json(response);
  })
);

app.post(
  "/telephony/secrets",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.secrets.createSecret(req.body || {})
    );
    res.status(201).json(response);
  })
);

app.get(
  "/telephony/secrets/:secretRef",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.secrets.getSecret(req.params.secretRef)
    );
    res.json(response);
  })
);

app.put(
  "/telephony/secrets/:secretRef",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.secrets.updateSecret({
        ...req.body,
        ref: req.params.secretRef
      })
    );
    res.json(response);
  })
);

app.patch(
  "/telephony/secrets/:secretRef",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.secrets.updateSecret({
        ...req.body,
        ref: req.params.secretRef
      })
    );
    res.json(response);
  })
);

app.delete(
  "/telephony/secrets/:secretRef",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.secrets.deleteSecret(req.params.secretRef)
    );
    res.json(response || { deleted: req.params.secretRef });
  })
);

app.get(
  "/telephony/numbers",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.numbers.listNumbers(normalizePagination(req.query))
    );
    res.json(response);
  })
);

app.post(
  "/telephony/numbers",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.numbers.createNumber(req.body || {})
    );
    res.status(201).json(response);
  })
);

app.get(
  "/telephony/numbers/:numberRef",
  asyncRoute(async (req, res) => {
    const [response, routeRow] = await Promise.all([
      withSdkRetry((sdk) => sdk.numbers.getNumber(req.params.numberRef)),
      getNumberRoute(req.params.numberRef)
    ]);
    res.json({ ...response, routeState: routeRow });
  })
);

app.put(
  "/telephony/numbers/:numberRef",
  asyncRoute(async (req, res) => {
    const payload = normalizeBody(req.body, {
      appRef: ["app_ref"],
      agentAor: ["agent_aor"],
      trunkRef: ["trunk_ref"],
      countryIsoCode: ["country_iso_code", "country_isocode"],
      telUrl: ["tel", "phone_number"]
    });
    const response = await withSdkRetry((sdk) =>
      sdk.numbers.updateNumber({ ...payload, ref: req.params.numberRef })
    );
    res.json(response);
  })
);

app.patch(
  "/telephony/numbers/:numberRef",
  asyncRoute(async (req, res) => {
    const payload = normalizeBody(req.body, {
      appRef: ["app_ref"],
      agentAor: ["agent_aor"],
      trunkRef: ["trunk_ref"],
      countryIsoCode: ["country_iso_code", "country_isocode"],
      telUrl: ["tel", "phone_number"]
    });
    const response = await withSdkRetry((sdk) =>
      sdk.numbers.updateNumber({ ...payload, ref: req.params.numberRef })
    );
    res.json(response);
  })
);

app.delete(
  "/telephony/numbers/:numberRef",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.numbers.deleteNumber(req.params.numberRef)
    );
    res.json(response || { deleted: req.params.numberRef });
  })
);

app.get(
  "/telephony/agents",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.agents.listAgents(normalizePagination(req.query))
    );
    res.json(response);
  })
);

app.post(
  "/telephony/agents",
  asyncRoute(async (req, res) => {
    const payload = normalizeBody(req.body, {
      domainRef: ["domain_ref"],
      credentialsRef: ["credentials_ref"]
    });
    const response = await withSdkRetry((sdk) =>
      sdk.agents.createAgent(payload)
    );
    res.status(201).json(response);
  })
);

app.get(
  "/telephony/agents/:agentRef",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.agents.getAgent(req.params.agentRef)
    );
    res.json(response);
  })
);

app.put(
  "/telephony/agents/:agentRef",
  asyncRoute(async (req, res) => {
    const payload = normalizeBody(req.body, {
      domainRef: ["domain_ref"],
      credentialsRef: ["credentials_ref"]
    });
    const response = await withSdkRetry((sdk) =>
      sdk.agents.updateAgent({ ...payload, ref: req.params.agentRef })
    );
    res.json(response);
  })
);

app.patch(
  "/telephony/agents/:agentRef",
  asyncRoute(async (req, res) => {
    const payload = normalizeBody(req.body, {
      domainRef: ["domain_ref"],
      credentialsRef: ["credentials_ref"]
    });
    const response = await withSdkRetry((sdk) =>
      sdk.agents.updateAgent({ ...payload, ref: req.params.agentRef })
    );
    res.json(response);
  })
);

app.delete(
  "/telephony/agents/:agentRef",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.agents.deleteAgent(req.params.agentRef)
    );
    res.json(response || { deleted: req.params.agentRef });
  })
);

async function buildOutboundCallResponse(req) {
  const statusWatcherStartedAtMs = Date.now();
  const payload = normalizeBody(req.body, {
    from: ["from_number"],
    fromNumberRef: ["from_number_ref"],
    appRef: ["app_ref", "application_ref", "applicationRef"],
    aiEnabled: ["ai_enabled"],
    aiAppRef: ["ai_app_ref"],
    routingMode: ["routing_mode", "mode"],
    aiMode: ["ai_mode", "aiMode"],
    operatorAgentAor: ["operator_agent_aor", "agent_aor"],
    targetMetadata: ["target_metadata", "targetMetadata"],
    recordingEnabled: ["recording_enabled"],
    recordingContract: ["recording_contract"],
    metadata: ["meta"]
  });
  const accountId = req.accountId || req.body.account_id || req.body.accountId || "";
  const requestId = req.requestId || randomUUID();
  const idempotencyKey =
    req.get("x-idempotency-key") ||
    req.body.idempotency_key ||
    req.body.idempotencyKey ||
    "";

  if (!payload.to) {
    throw new Error("to is required");
  }

  const appDecision = buildOutboundAppRefDecision(payload);
  if (!appDecision.appRef) {
    throw new Error("app_ref or appRef is required");
  }
  const payloadMetadata = plainObject(payload.metadata);
  const sipuniRuntimeOutbound = isSipuniAsteriskOutbound(payload, payloadMetadata);
  const sipuniProviderFirstOutbound =
    !sipuniRuntimeOutbound && isSipuniOutboundNumberRef(payload, payloadMetadata);
  const callPayload = sipuniRuntimeOutbound
    ? sipuniRuntimeOutboundPayload(payload, payloadMetadata)
    : payload;
  const callPayloadMetadata = plainObject(callPayload.metadata);
  const explicitOperatorAgentAor = firstNonEmpty(
    payload.operatorAgentAor,
    callPayloadMetadata.operator_agent_aor,
    callPayloadMetadata.operatorAgentAor,
    callPayloadMetadata.agent_aor,
    callPayloadMetadata.agentAor
  );
  const operatorAgentRef = firstNonEmpty(
    payload.operatorAgentRef,
    payload.operator_agent_ref,
    callPayloadMetadata.operator_agent_ref,
    callPayloadMetadata.operatorAgentRef,
    callPayloadMetadata.fonoster_agent_ref,
    callPayloadMetadata.fonosterAgentRef
  );
  const hasOperatorHint = Boolean(explicitOperatorAgentAor || operatorAgentRef);
  const routingMode =
    normalizeRoutingMode(payload.routingMode || appDecision.routingMode) ||
    (hasOperatorHint ? "operator" : payload.aiEnabled === true ? "ai" : "app");
  const operatorAgentAor = firstNonEmpty(explicitOperatorAgentAor, config.defaults.operatorAgentAor);
  const aiMode = appDecision.aiMode || payload.aiMode || "";
  const outboundMetadata = {
    ...(callPayload.metadata || {}),
    ...(payload.targetMetadata ? { target_metadata: payload.targetMetadata } : {}),
    ...buildRecordingMetadata({ ...(callPayload.metadata || {}), ...payload }),
    request_id: requestId,
    account_id: accountId,
    idempotency_key: idempotencyKey,
    direction: "outbound",
    call_direction: "outbound",
    mode: routingMode,
    routing_mode: routingMode,
    ...(routingMode === "operator" && operatorAgentAor
      ? {
          operator_agent_aor: operatorAgentAor,
          operatorAgentAor,
          agent_aor: operatorAgentAor,
          agentAor: operatorAgentAor
        }
      : {}),
    ...(routingMode === "operator" && operatorAgentRef
      ? {
          operator_agent_ref: operatorAgentRef,
          operatorAgentRef,
          fonoster_agent_ref: operatorAgentRef,
          fonosterAgentRef: operatorAgentRef
        }
      : {})
  };

  let from = null;
  let created = null;

  const operatorFirstOutbound =
    operatorFirstOutboundEnabled(payloadMetadata) &&
    !sipuniRuntimeOutbound &&
    routingMode === "operator" &&
    Boolean(operatorAgentAor);
  const providerCallTarget = operatorFirstOutbound ? operatorAgentAor : payload.to;
  const providerPath = sipuniRuntimeOutbound
    ? "asterisk_sipuni"
    : sipuniProviderFirstOutbound
      ? "fonoster_sipuni_provider_first"
    : operatorFirstOutbound
      ? "fonoster_operator_first"
      : "fonoster_direct";
  const providerFirstMetadata = sipuniProviderFirstMetadata(payload, payloadMetadata);
  const createCallMetadata = operatorFirstOutbound
    ? {
        ...outboundMetadata,
        operator_first_outbound: true,
        operatorFirstOutbound: true,
        outbound_target_number: payload.to,
        outboundTargetNumber: payload.to,
        target_number: payload.to,
        targetNumber: payload.to,
        customer_number: payload.to,
        customerNumber: payload.to,
        original_to: payload.to,
        originalTo: payload.to,
        provider_to: providerCallTarget,
        providerTo: providerCallTarget,
        entry_leg: "operator",
        entryLeg: "operator",
        provider_path: providerPath,
        providerPath
      }
    : {
        ...outboundMetadata,
        ...providerFirstMetadata,
        provider_path: providerPath,
        providerPath
      };

  logger.info("outbound call provider path selected", {
    requestId,
    accountId,
    routingMode,
    providerPath,
    fromNumberRef: resolveSipuniAsteriskNumberRef(payload, payloadMetadata) || payload.fromNumberRef || payload.from_number_ref || null,
    to: payload.to,
    providerTo: providerCallTarget,
    operatorFirstOutbound,
    sipuniRuntimeOutbound,
    sipuniProviderFirstOutbound,
    operatorAgentAor: operatorAgentAor || null
  });

  if (sipuniRuntimeOutbound) {
    created = await createSipuniAsteriskOutboundCall({
      payload: callPayload,
      payloadMetadata: callPayloadMetadata,
      appDecision,
      outboundMetadata,
      routingMode,
      accountId,
      requestId,
      idempotencyKey
    });
    from =
      config.asterisk?.sipuniOutboundCallerId ||
      normalizeDialableNumber(callPayload.from) ||
      normalizeDialableNumber(payload.from);
  } else {
    from = await withSdkRetry((sdk) => resolveFromNumber(sdk, callPayload));
    if (!from) {
      throw new Error("from or from_number_ref is required");
    }

    created = await withSdkRetry((sdk) =>
      sdk.createCallWithSafeTracking({
        from,
        to: providerCallTarget,
        appRef: appDecision.appRef || undefined,
        timeout: payload.timeout || undefined,
        metadata: createCallMetadata
      })
    );
  }

  const statusProvider = created.provider || "fonoster";
  const published = await publishVoiceEvent(enrichLifecycleEvent({
    eventType: "call_created",
    callRef: created.ref,
    bridgeCallRef: created.ref,
    providerCallId: created.ref,
    accountId,
    requestId,
    idempotencyKey,
    source: "bridge.api",
    provider: statusProvider,
    statusProvider,
    status_provider: statusProvider,
    direction: "outbound",
    callDirection: "outbound",
    routingMode,
    aiMode,
    ai_mode: aiMode,
    currentStatus: "created",
    data: {
      from,
      to: payload.to,
      providerTo: providerCallTarget,
      provider_to: providerCallTarget,
      operatorFirstOutbound,
      operator_first_outbound: operatorFirstOutbound,
      appRef: appDecision.appRef || "",
      call_ref: created.ref,
      bridge_call_ref: created.ref,
      provider_call_id: created.ref,
      provider: statusProvider,
      statusProvider,
      status_provider: statusProvider,
      routingMode,
      aiMode,
      ai_mode: aiMode,
      currentStatus: "created",
      requestId,
      accountId,
      idempotencyKey,
      outboundMeta: {
        requestedAt: new Date().toISOString(),
        requestType: "outbound"
      }
    }
  }));
  rememberOutboundLifecycleCallRef(created.ref);

  return {
    response: created,
    statusStream: created.statusStream,
    published,
    request: {
      from,
      to: payload.to,
      providerTo: providerCallTarget,
      provider_to: providerCallTarget,
      operatorFirstOutbound,
      operator_first_outbound: operatorFirstOutbound,
      appRef: appDecision.appRef || "",
      routingMode,
      aiMode,
      accountId,
      requestId,
      idempotencyKey,
      startedAtMs: statusWatcherStartedAtMs,
      createdAtMs: statusWatcherStartedAtMs
    }
  };
}

function buildOutboundStreamEnabled(req) {
  return (
    isSsePreferred(req) ||
    parseStreamMode(req.query, req.headers) ||
    String(req.query.mode || "").toLowerCase() === "stream"
  );
}

async function handleOutboundCallCreate(req, res) {
  try {
    const { response, published, request } = await buildOutboundCallResponse(req);

    if (buildOutboundStreamEnabled(req)) {
      startCallOutboundStream(
        res,
        response.ref,
        response.statusStream,
        {
          requestId: request.requestId,
          accountId: request.accountId,
          idempotencyKey: request.idempotencyKey || null,
          routingMode: request.routingMode,
          startedAtMs: request.startedAtMs,
          createdAtMs: request.createdAtMs
        }
      );
      return;
    }

    watchOutboundStatusStream(response.ref, response.statusStream, request);

    res.status(201).json({
      ref: response.ref,
      status: "created",
      callRef: response.ref,
      call_ref: response.ref,
      bridgeCallRef: response.ref,
      bridge_call_ref: response.ref,
      providerCallId: response.ref,
      provider_call_id: response.ref,
      from: request.from,
      to: request.to,
      appRef: request.appRef,
      provider: response.provider || "fonoster",
      statusProvider: response.provider || "fonoster",
      routingMode: request.routingMode,
      aiMode: request.aiMode || null,
      currentStatus: "created",
      requestId: request.requestId || null,
      accountId: request.accountId || null,
      idempotencyKey: request.idempotencyKey || null,
      stream: {
        id: published.id,
        seq: published.seq
      }
    });
  } catch (error) {
    if (
      error?.message === "from or from_number_ref is required" ||
      error?.message === "to is required" ||
      error?.message === "app_ref or appRef is required"
    ) {
      return res.status(400).json({ error: error.message });
    }

    throw error;
  }
}

app.get(
  "/telephony/calls",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.calls.listCalls({
        ...normalizePagination(req.query),
        from: req.query.from || undefined,
        to: req.query.to || undefined,
        status: req.query.status || undefined,
        type: req.query.type || undefined,
        after: req.query.after || undefined,
        before: req.query.before || undefined
      })
    );

    res.json(response);
  })
);

app.get(
  "/telephony/calls/:callRef",
  asyncRoute(async (req, res) => {
    const response = await withSdkRetry((sdk) =>
      sdk.calls.getCall(req.params.callRef)
    );
    res.json(response);
  })
);

app.post(
  "/telephony/calls/outbound",
  asyncRoute((req, res) => {
    return handleOutboundCallCreate(req, res);
  })
);

app.post(
  "/telephony/calls/outbound/stream",
  asyncRoute((req, res) => {
    req.query.stream = "true";
    req.query.mode = "stream";
    return handleOutboundCallCreate(req, res);
  })
);

async function handleCallTerminateRequest(req, res) {
  const callRef = String(req.params.callRef || "").trim();
  if (!callRef) {
    return res.status(400).json({ error: "callRef is required" });
  }

  const payload = normalizeBody(req.body, {
    agentAor: ["agent_aor", "target_aor", "targetAor"],
    reason: ["end_reason", "endReason", "release_reason", "releaseReason"],
    actor: ["ended_by", "endedBy"]
  });
  const reason = normalizeTerminateReason(payload.reason);
  const actor = String(payload.actor || "operator").trim() || "operator";
  const eventId =
    req.get("x-event-id") ||
    payload.event_id ||
    payload.eventId ||
    `evt_terminate_requested_${callRef}_${randomUUID()}`;
  const idempotencyKey =
    req.get("x-idempotency-key") ||
    payload.idempotency_key ||
    payload.idempotencyKey ||
    eventId;

  if (terminalLifecycleCallRefKnown(callRef)) {
    logger.info("ignored late call terminate request after terminal", {
      callRef,
      reason,
      actor,
      requestId: req.requestId,
      accountId: req.accountId || payload.account_id || payload.accountId || null
    });

    return res.status(202).json({
      ok: true,
      accepted: false,
      ignored: true,
      callRef,
      eventType: "terminate_requested",
      reason,
      eventId
    });
  }

  const requestedAt = new Date().toISOString();
  const event = enrichLifecycleEvent({
    source: "bridge.api",
    eventType: "terminate_requested",
    callRef,
    accountId: req.accountId || payload.account_id || payload.accountId || "",
    requestId: req.requestId,
    idempotencyKey,
    eventId,
    event_id: eventId,
    occurredAt: requestedAt,
    occurred_at: requestedAt,
    action: payload.action || "operator",
    routingMode: payload.routingMode || payload.routing_mode || "operator",
    callDirection: payload.callDirection || payload.call_direction || "inbound",
    currentStatus: "cancelling",
    controlAction: "terminate_call",
    control_action: "terminate_call",
    reason,
    endReason: reason,
    endedBy: actor,
    agentAor: payload.agentAor || "",
    agent_aor: payload.agentAor || "",
    operatorRef: payload.operatorRef || payload.operator_ref || "",
    operator_ref: payload.operatorRef || payload.operator_ref || "",
    metadata: payload.metadata || {}
  });

  if (operatorControlTerminateReason(reason)) {
    rememberOperatorControlCallRef(callRef);
  }

  const published = await publishVoiceEvent(event);

  if (asteriskAriManagedCallRefKnown(callRef)) {
    try {
      const providerHangup = await hangupAsteriskAriChannel(callRef);
      logger.info("processed Asterisk ARI hangup for managed outbound call", {
        callRef,
        reason,
        actor,
        requestId: req.requestId,
        found: providerHangup.found,
        status: providerHangup.status
      });
    } catch (error) {
      logger.warn("failed to hang up managed Asterisk ARI outbound call", {
        callRef,
        reason,
        actor,
        requestId: req.requestId,
        message: error.message
      });
    }
  }

  logger.info("accepted call terminate request", {
    callRef,
    reason,
    actor,
    requestId: req.requestId,
    accountId: event.accountId || null,
    agentAor: event.agentAor || null,
    eventSeq: published.seq
  });

  res.status(202).json({
    ok: true,
    accepted: true,
    callRef,
    eventType: "terminate_requested",
    reason,
    eventSeq: published.seq,
    eventId
  });
}

app.post(
  "/telephony/calls/:callRef/terminate",
  asyncRoute(handleCallTerminateRequest)
);

app.delete(
  "/telephony/calls/:callRef/terminate",
  asyncRoute(handleCallTerminateRequest)
);

app.post(
  "/telephony/calls/:callRef/reject",
  asyncRoute(handleCallTerminateRequest)
);

app.delete(
  "/telephony/calls/:callRef/reject",
  asyncRoute(handleCallTerminateRequest)
);

app.post(
  "/telephony/calls/:callRef/hangup",
  asyncRoute(handleCallTerminateRequest)
);

app.delete(
  "/telephony/calls/:callRef/hangup",
  asyncRoute(handleCallTerminateRequest)
);

app.post(
  "/telephony/calls/:callRef/end",
  asyncRoute(handleCallTerminateRequest)
);

app.delete(
  "/telephony/calls/:callRef/end",
  asyncRoute(handleCallTerminateRequest)
);

app.post(
  "/telephony/calls/:callRef/cancel",
  asyncRoute(handleCallTerminateRequest)
);

app.delete(
  "/telephony/calls/:callRef/cancel",
  asyncRoute(handleCallTerminateRequest)
);

app.post(
  "/telephony/webphone/calls/:callRef/terminate",
  asyncRoute(handleCallTerminateRequest)
);

app.delete(
  "/telephony/webphone/calls/:callRef/terminate",
  asyncRoute(handleCallTerminateRequest)
);

app.post(
  "/telephony/webphone/calls/:callRef/reject",
  asyncRoute(handleCallTerminateRequest)
);

app.delete(
  "/telephony/webphone/calls/:callRef/reject",
  asyncRoute(handleCallTerminateRequest)
);

app.post(
  "/telephony/webphone/calls/:callRef/hangup",
  asyncRoute(handleCallTerminateRequest)
);

app.delete(
  "/telephony/webphone/calls/:callRef/hangup",
  asyncRoute(handleCallTerminateRequest)
);

app.post(
  "/telephony/webphone/calls/:callRef/end",
  asyncRoute(handleCallTerminateRequest)
);

app.delete(
  "/telephony/webphone/calls/:callRef/end",
  asyncRoute(handleCallTerminateRequest)
);

app.post(
  "/telephony/webphone/calls/:callRef/cancel",
  asyncRoute(handleCallTerminateRequest)
);

app.delete(
  "/telephony/webphone/calls/:callRef/cancel",
  asyncRoute(handleCallTerminateRequest)
);

app.post(
  "/telephony/numbers/:numberRef/route",
  asyncRoute(async (req, res) => {
    const payload = normalizeBody(req.body, {
      numberRef: ["number_ref"],
      appRef: ["app_ref"],
      agentAor: ["agent_aor"]
    });

    if (!payload.mode) {
      return res.status(400).json({ error: "mode is required" });
    }

    try {
      const response = await updateNumberRoute(null, {
        numberRef: req.params.numberRef,
        mode: payload.mode,
        appRef: payload.appRef || "",
        agentAor: payload.agentAor || ""
      });

      await publishVoiceEvent({
        source: "bridge.api",
        eventType: "number_route_updated",
        numberRef: req.params.numberRef,
        data: {
          mode: payload.mode,
          appRef: payload.appRef || "",
          agentAor: payload.agentAor || ""
        }
      });

      return res.json({
        ref: req.params.numberRef,
        mode: payload.mode,
        routeState: response
      });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    } finally {
      await invalidateRouteCacheForNumber(req.params.numberRef);
    }
  })
);

app.post(
  "/telephony/ai/toggle",
  asyncRoute(async (req, res) => {
    const payload = normalizeBody(req.body, {
      numberRef: ["number_ref"],
      aiAppRef: ["ai_app_ref"],
      fallbackMode: ["fallback_mode"],
      fallbackAppRef: ["fallback_app_ref"],
      fallbackAgentAor: ["fallback_agent_aor"],
      enabled: ["active"]
    });

    if (!payload.numberRef) {
      return res.status(400).json({ error: "number_ref is required" });
    }

    if (typeof payload.enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be boolean" });
    }

    const numberRef = payload.numberRef;
    const aiAppRef = payload.aiAppRef || "";
    const fallbackMode = payload.fallbackMode || "clear";
    const fallbackAppRef =
      payload.fallbackAppRef || "";
    const fallbackAgentAor =
      payload.fallbackAgentAor || "";

    try {
      let response;
      const appliedMode = payload.enabled ? "ai" : fallbackMode;

      if (payload.enabled) {
        response = await updateNumberRoute(null, {
          numberRef,
          mode: "ai",
          appRef: aiAppRef
        });
      } else if (fallbackMode === "operator") {
        response = await updateNumberRoute(null, {
          numberRef,
          mode: "operator",
          agentAor: fallbackAgentAor
        });
      } else if (fallbackMode === "app") {
        response = await updateNumberRoute(null, {
          numberRef,
          mode: "app",
          appRef: fallbackAppRef
        });
      } else {
        response = await updateNumberRoute(null, {
          numberRef,
          mode: "clear"
        });
      }

      await publishVoiceEvent({
        source: "bridge.api",
        eventType: "ai_toggle",
        callRef: "",
        numberRef,
        data: {
          enabled: payload.enabled,
          appliedMode,
          routeState: response
        }
      });

      res.json({
        numberRef,
        enabled: payload.enabled,
        appliedMode,
        routeState: response
      });
    } catch (error) {
      res.status(400).json({ error: error.message });
    } finally {
      await invalidateRouteCacheForNumber(numberRef);
    }
  })
);

app.post(
  "/telephony/agents/:agentRef/enabled",
  asyncRoute(async (req, res) => {
    if (typeof req.body.enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be boolean" });
    }

    const response = await withSdkRetry((sdk) =>
      sdk.agents.updateAgent({
        ref: req.params.agentRef,
        enabled: req.body.enabled
      })
    );

    onelink.invalidateRouteCache();

    res.json({ ...response, enabled: req.body.enabled });
  })
);

app.post(
  "/telephony/webphone/token",
  asyncRoute(async (req, res) => {
    const token = await withSdkRetry((sdk) =>
      sdk.applications.createTestToken()
    );

    const expectedAor =
      req.body?.agent_aor ||
      req.body?.agentAor ||
      req.body?.target_aor ||
      req.body?.targetAor ||
      config.defaults.operatorAgentAor ||
      token.targetAor;

    res.json({
      ...token,
      ...buildWebphoneTokenDiagnostics(token, expectedAor)
    });
  })
);

app.post(
  "/internal/voice/inbound/route",
  verifySharedSecret,
  asyncRoute(async (req, res) => {
    const bridgeCallRef =
      req.body.bridge_call_ref ||
      req.body.bridgeCallRef ||
      req.body.parent_call_ref ||
      req.body.parentCallRef ||
      req.body.provider_call_id ||
      req.body.providerCallId ||
      req.body.call_ref ||
      req.body.callRef ||
      null;
    const runtimeCallRef =
      req.body.runtime_call_ref ||
      req.body.runtimeCallRef ||
      req.body.child_call_ref ||
      req.body.childCallRef ||
      null;
    const inboundMetadata = req.body.metadata && typeof req.body.metadata === "object" ? req.body.metadata : {};
    const inbound = {
      callRef: bridgeCallRef,
      bridgeCallRef,
      runtimeCallRef,
      appRef: req.body.app_ref || req.body.appRef || null,
      mediaSessionRef:
        req.body.media_session_ref || req.body.mediaSessionRef || null,
      ingressNumber: req.body.ingress_number || req.body.ingressNumber || null,
      callerNumber: req.body.caller_number || req.body.callerNumber || null,
      numberRef: req.body.number_ref || req.body.numberRef || inboundMetadata.number_ref || inboundMetadata.numberRef || null,
      inboxId: req.body.inbox_id || req.body.inboxId || inboundMetadata.inbox_id || inboundMetadata.inboxId || inboundMetadata.chatwoot_inbox_id || inboundMetadata.chatwootInboxId || null,
      direction:
        req.body.direction ||
        req.body.call_direction ||
        req.body.callDirection ||
        inboundMetadata.call_direction ||
        inboundMetadata.callDirection ||
        inboundMetadata.direction ||
        null,
      receivedAt: req.body.received_at || req.body.receivedAt || null,
      metadata: inboundMetadata,
      accountId: req.accountId || req.body.account_id || req.body.accountId || req.get("x-account-id") || null
    };

    const outboundRuntimeDecision = buildOutboundRuntimeDecision(inbound);
    if (outboundRuntimeDecision) {
      rememberOutboundLifecycleCallRef(inbound.callRef);
    }
    const chatwootContext = outboundRuntimeDecision
      ? {
          configured: true,
          degraded: false,
          source: "local_outbound_runtime",
          decision: outboundRuntimeDecision,
          inbound
        }
      : await onelink.lookupInboundContext(inbound, {
          accountId: req.accountId,
          requestId: req.requestId
        });
    const decision = outboundRuntimeDecision || await buildInboundDecision({ inbound, chatwootContext });
    const decisionAgentAor = decision.agentAor || decision.agent_aor || "";
    const decisionAppRef = decision.appRef || decision.app_ref || "";
    const selectedAppRef =
      decision.selectedAppRef || decision.selected_app_ref || decisionAppRef || "";
    const selectedEndpoint =
      decision.selectedEndpoint || decision.selected_endpoint || decision.endpoint || "";
    const topology = decision.topology || "";
    const operatorFirstClassProductionPath =
      decision.operatorFirstClassProductionPath ??
      decision.operator_first_class_production_path;
    const operatorExecutionMode =
      decision.operatorExecutionMode || decision.operator_execution_mode || "";
    const operatorDirectBridgeDegraded =
      decision.operatorDirectBridgeDegraded ?? decision.operator_direct_bridge_degraded;
    const mediaOwnership = decision.mediaOwnership || decision.media_ownership || "";
    const recordingOwnership =
      decision.recordingOwnership || decision.recording_ownership || "";
    const transcriptOwnership =
      decision.transcriptOwnership || decision.transcript_ownership || "";
    const operatorObservabilityKey =
      decision.operatorObservabilityKey || decision.operator_observability_key || "";
    const operatorSlaClass = decision.operatorSlaClass || decision.operator_sla_class || "";
    const recordingImportContract =
      decision.recordingImportContract || decision.recording_import_contract || "";
    const transcriptContract = decision.transcriptContract || decision.transcript_contract || "";
    const decisionDestination =
      decision.destination || decision.phoneNumber || decision.phone_number || "";

    const routeDecisionEvent = enrichLifecycleEvent({
      source: "bridge.route",
      eventType: "route_decision",
      callRef: inbound.callRef || null,
      bridgeCallRef: inbound.bridgeCallRef || null,
      runtimeCallRef: inbound.runtimeCallRef || null,
      providerCallId: inbound.bridgeCallRef || null,
      mediaSessionRef: inbound.mediaSessionRef || null,
      accountId: inbound.accountId,
      requestId: req.requestId,
      inbound,
      action: decision.action,
      routingMode: decision.action,
      callDirection: outboundRuntimeDecision
        ? "outbound"
        : normalizeCallDirection(inbound.direction) || "inbound",
      currentStatus: decision.action === "reject" ? "rejected" : "connecting",
      appRef: decisionAppRef,
      app_ref: decisionAppRef,
      selectedAppRef,
      selected_app_ref: selectedAppRef,
      endpoint: selectedEndpoint,
      selectedEndpoint,
      selected_endpoint: selectedEndpoint,
      topology,
      operatorFirstClassProductionPath,
      operator_first_class_production_path: operatorFirstClassProductionPath,
      operatorExecutionMode,
      operator_execution_mode: operatorExecutionMode,
      operatorDirectBridgeDegraded,
      operator_direct_bridge_degraded: operatorDirectBridgeDegraded,
      mediaOwnership,
      media_ownership: mediaOwnership,
      recordingOwnership,
      recording_ownership: recordingOwnership,
      transcriptOwnership,
      transcript_ownership: transcriptOwnership,
      operatorObservabilityKey,
      operator_observability_key: operatorObservabilityKey,
      operatorSlaClass,
      operator_sla_class: operatorSlaClass,
      recordingImportContract,
      recording_import_contract: recordingImportContract,
      transcriptContract,
      transcript_contract: transcriptContract,
      agentAor: decisionAgentAor,
      agent_aor: decisionAgentAor,
      destination: decisionDestination,
      reason: decision.reason || null,
      sourcePolicy: decision.source || null
    });

    void publishVoiceEvent(routeDecisionEvent).catch((error) => {
      logger.warn("failed to publish inbound route decision event", {
        requestId: req.requestId,
        callRef: inbound.callRef || null,
        action: decision.action || null,
        type: error.type || "unknown",
        message: error.message,
        accountId: inbound.accountId || null
      });
    });

    logger.info("resolved inbound decision", {
      callRef: inbound.callRef,
      ingressNumber: inbound.ingressNumber,
      action: decision.action,
      source: decision.source,
      requestId: req.requestId,
      accountId: inbound.accountId || null,
      agentAor: decisionAgentAor || null,
      appRef: decisionAppRef || null,
      selectedAppRef: selectedAppRef || null,
      endpoint: selectedEndpoint || null,
      topology: topology || null,
      operatorFirstClassProductionPath: operatorFirstClassProductionPath ?? null,
      operatorExecutionMode: operatorExecutionMode || null,
      operatorDirectBridgeDegraded: operatorDirectBridgeDegraded ?? null,
      mediaOwnership: mediaOwnership || null,
      recordingOwnership: recordingOwnership || null,
      transcriptOwnership: transcriptOwnership || null,
      operatorObservabilityKey: operatorObservabilityKey || null,
      operatorSlaClass: operatorSlaClass || null,
      recordingImportContract: recordingImportContract || null,
      transcriptContract: transcriptContract || null,
      destination: decisionDestination || null,
      reason: decision.reason
    });

    res.json({
      ...decision,
      call_ref: decision.call_ref || inbound.bridgeCallRef || inbound.callRef || "",
      callRef: decision.callRef || inbound.bridgeCallRef || inbound.callRef || "",
      bridge_call_ref: decision.bridge_call_ref || inbound.bridgeCallRef || inbound.callRef || "",
      bridgeCallRef: decision.bridgeCallRef || inbound.bridgeCallRef || inbound.callRef || "",
      provider_call_id: decision.provider_call_id || inbound.bridgeCallRef || inbound.callRef || "",
      providerCallId: decision.providerCallId || inbound.bridgeCallRef || inbound.callRef || "",
      ...(inbound.runtimeCallRef
        ? {
            runtime_call_ref: decision.runtime_call_ref || inbound.runtimeCallRef,
            runtimeCallRef: decision.runtimeCallRef || inbound.runtimeCallRef
          }
        : {})
    });
  })
);

app.post(
  "/internal/voice/inbound/event",
  verifySharedSecret,
  asyncRoute(async (req, res) => {
    const normalized = outboundRuntimeLifecycleEvent(normalizeInboundEvent(req.body || {}));
    const routeRef = normalized.callRef || normalized.call_ref || "";
    const accountId =
      req.accountId ||
      normalized.accountId ||
      req.body.account_id ||
      req.body.accountId ||
      "";
    const idempotencyKey =
      req.get("x-idempotency-key") ||
      req.body.idempotency_key ||
      req.body.idempotencyKey ||
      "";
    const runtimeEvent = outboundRuntimeLifecycleEvent({
      ...normalized,
      requestId: req.requestId,
      accountId,
      source: normalized.source || "voice-runtime",
      eventType: normalized.eventType || "voice_event"
    });

    const published = await publishVoiceEvent(runtimeEvent);
    rememberLifecycleEventState(runtimeEvent);

    logger.info("received voice runtime event", {
      requestId: req.requestId,
      eventType: req.body.eventType || req.body.event_type || null,
      callRef: routeRef || null,
      idempotencyKey: idempotencyKey || null,
      accountId
    });

    logger.debug("published inbound runtime event", {
      publishedId: published.id,
      publishedSeq: published.seq,
      eventType: published.eventType,
      callRef: published.callRef
    });

    handleRuntimeMediaSessionLifecycle(
      runtimeEvent,
      {
        accountId,
        requestId: req.requestId,
        idempotencyKey,
        routingMode: runtimeEvent.routingMode || runtimeEvent.routing_mode || ""
      }
    );

    if (staleNonTerminalLifecycleEvent(runtimeEvent)) {
      logger.info("skipped stale non-terminal runtime event after terminal", {
        requestId: req.requestId,
        eventType: runtimeEvent.eventType || runtimeEvent.event_type || null,
        callRef: routeRef || null,
        accountId
      });
    } else {
      void enqueueOnelinkForward(
        runtimeEvent,
        {
          idempotencyKey,
          accountId,
          requestId: req.requestId
        },
        {
          message: "failed to forward runtime event to onelink",
          requestId: req.requestId,
          eventType: runtimeEvent.eventType || runtimeEvent.event_type || null,
          callRef: routeRef || null,
          accountId
        }
      );
    }

    res.status(202).json({
      accepted: true,
      forwarded: false,
      skipped: false,
      forwarding: "async",
      stream: {
        id: published.id,
        seq: published.seq,
        eventType: published.eventType
      }
    });
  })
);

app.use((error, req, res, _next) => {
  logger.error("request failed", {
    message: error.message,
    stack: error.stack,
    requestId: req.requestId,
    method: req.method,
    path: req.originalUrl || req.url,
    accountId: req.accountId || null
  });

  res.status(500).json({
    error: error.message || "internal error"
  });
});

app.listen(config.port, () => {
  logger.info("telephony bridge started", {
    port: config.port,
    onelinkConfigured: onelink.isConfigured(),
    fonosterEndpoint: config.fonoster.endpoint,
    contractMarker: {
      version: "operator-observability-v1",
      fields: [
        "operatorObservabilityKey",
        "operatorSlaClass",
        "recordingImportContract",
        "transcriptContract"
      ],
      classes: [
        "first_class_runtime",
        "degraded_direct_bridge",
        "blocked_recursive_handoff"
      ],
      recordingContracts: [
        "runtime_owned_no_fonoster_import",
        "fonoster_pull_recording_ready_required"
      ]
    },
    stream: {
      ...(config.stream || {}),
      databaseUrl: config.stream?.databaseUrl ? "[configured]" : ""
    },
    security: {
      requireInternalSecret: config.security?.requireInternalSecret
    }
  });

  void resumeOutboundStatusPollers({ delayMs: 1500 }).catch((error) => {
    logger.warn("failed to resume outbound status pollers", {
      message: error.message
    });
  });

  startAsteriskAriEventListener({ delayMs: 1000 });
});
