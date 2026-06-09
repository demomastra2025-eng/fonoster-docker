const bridgeClient = require("./bridgeClient");
const { config } = require("./config");
const { logger } = require("./logger");
const { randomUUID } = require("node:crypto");

const VOICE_EVENT_END = "end";
const VOICE_EVENT_ERROR = "error";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildInbound(req) {
  const metadata = req.metadata && typeof req.metadata === "object" ? req.metadata : {};
  const callRef = req.callRef || metadata.call_ref || metadata.callRef || null;
  const bridgeCallRef =
    req.bridgeCallRef ||
    req.bridge_call_ref ||
    metadata.bridge_call_ref ||
    metadata.bridgeCallRef ||
    metadata.parent_call_ref ||
    metadata.parentCallRef ||
    callRef;
  const runtimeCallRef =
    req.runtimeCallRef ||
    req.runtime_call_ref ||
    metadata.runtime_call_ref ||
    metadata.runtimeCallRef ||
    metadata.child_call_ref ||
    metadata.childCallRef ||
    "";

  return {
    appRef: req.appRef || null,
    callRef,
    bridgeCallRef,
    runtimeCallRef,
    mediaSessionRef: req.mediaSessionRef || null,
    numberRef:
      req.numberRef ||
      req.number_ref ||
      metadata.number_ref ||
      metadata.numberRef ||
      metadata.onelink_number_ref ||
      metadata.onelinkNumberRef ||
      null,
    inboxId:
      req.inboxId ||
      req.inbox_id ||
      metadata.inbox_id ||
      metadata.inboxId ||
      metadata.chatwoot_inbox_id ||
      metadata.chatwootInboxId ||
      null,
    accountId:
      req.accountId ||
      req.account_id ||
      metadata.account_id ||
      metadata.accountId ||
      metadata.chatwoot_account_id ||
      metadata.chatwootAccountId ||
      null,
    ingressNumber: req.ingressNumber || null,
    callerNumber: req.callerNumber || null,
    callerName: req.callerName || null,
    direction:
      req.callDirection ||
      req.call_direction ||
      metadata.call_direction ||
      metadata.callDirection ||
      metadata.direction ||
      null,
    selfEndpoint: req.selfEndpoint || null,
    receivedAt: new Date().toISOString(),
    metadata
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

function normalizeAgentTarget(agentAor) {
  return agentAor ? String(agentAor).trim() : "";
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const stringValue = String(value).trim();
    if (stringValue) return stringValue;
  }
  return "";
}

function resolveDialCallerId({ inbound = {}, decision = {}, context = {} } = {}) {
  const metadata =
    inbound.metadata && typeof inbound.metadata === "object" ? inbound.metadata : {};

  return firstNonEmpty(
    decision.callerId,
    decision.caller_id,
    decision.egressNumber,
    decision.egress_number,
    decision.dodNumber,
    decision.dod_number,
    inbound.ingressNumber,
    inbound.ingress_number,
    metadata.ingressNumber,
    metadata.ingress_number,
    metadata.sipuniIngressNumber,
    metadata.sipuni_ingress_number,
    metadata.originalFrom,
    metadata.original_from,
    context.ingressNumber,
    context.ingress_number
  );
}

function resolveDialTarget(decision) {
  if (decision.destination) return String(decision.destination).trim();
  if (decision.phoneNumber) return String(decision.phoneNumber).trim();
  if (decision.agentAor) return normalizeAgentTarget(decision.agentAor);
  return "";
}

function resolveAppTarget(decision) {
  if (!decision.appRef) return "";
  return `app:${String(decision.appRef).trim()}`;
}

const DIAL_STATUS_MAP = {
  ANSWER: "answered",
  ANSWERED: "answered",
  IN_PROGRESS: "answered",
  TRYING: "ringing",
  PROGRESS: "ringing",
  RINGING: "ringing",
  NOANSWER: "no-answer",
  NO_ANSWER: "no-answer",
  BUSY: "busy",
  REJECT: "rejected",
  REJECTED: "rejected",
  DECLINE: "rejected",
  DECLINED: "rejected",
  TIMEOUT: "timeout",
  TIMED_OUT: "timeout",
  FAILED: "failed",
  CANCEL: "cancelled",
  CANCELED: "cancelled",
  CANCELLED: "cancelled",
  HANGUP: "hangup",
  HUNGUP: "hangup",
  COMPLETED: "completed"
};

const TERMINAL_DIAL_STATUSES = new Set([
  "busy",
  "cancelled",
  "hangup",
  "no-answer",
  "rejected",
  "timeout",
  "failed",
  "completed"
]);

function normalizeDialStatus(status) {
  const raw = String(status || "").trim();

  if (!raw) return "";

  const key = raw.toUpperCase().replace(/[\s-]+/g, "_");

  return DIAL_STATUS_MAP[key] || raw.toLowerCase().replace(/[\s_]+/g, "-");
}

const TERMINAL_CURRENT_STATUSES = new Set([
  "completed",
  "missed",
  "no_answer",
  "busy",
  "cancelled",
  "rejected",
  "timeout",
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

function addCorrelationFields(target, source = {}) {
  const bridgeCallRef =
    source.bridgeCallRef ||
    source.bridge_call_ref ||
    source.parentCallRef ||
    source.parent_call_ref ||
    source.callRef ||
    source.call_ref ||
    "";
  const runtimeCallRef =
    source.runtimeCallRef ||
    source.runtime_call_ref ||
    source.childCallRef ||
    source.child_call_ref ||
    "";

  if (bridgeCallRef) {
    addAlias(target, "callRef", "call_ref", bridgeCallRef);
    addAlias(target, "bridgeCallRef", "bridge_call_ref", bridgeCallRef);
    addAlias(target, "parentCallRef", "parent_call_ref", bridgeCallRef);
    addAlias(target, "providerCallId", "provider_call_id", bridgeCallRef);
  }

  if (runtimeCallRef) {
    addAlias(target, "runtimeCallRef", "runtime_call_ref", runtimeCallRef);
    addAlias(target, "childCallRef", "child_call_ref", runtimeCallRef);
  }

  const streamRef = source.streamRef || source.stream_ref || "";
  if (streamRef) {
    addAlias(target, "streamRef", "stream_ref", streamRef);
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

function normalizeUrlBase(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function buildAsteriskRecordingArtifact({ appRef, mediaSessionRef, callRef }) {
  if (!appRef || !mediaSessionRef) return null;

  const fileName = `${appRef}_${mediaSessionRef}.wav`;
  const recordingBaseUrl = normalizeUrlBase(config.recordingBaseUrl);

  return {
    recording_ref: `rec_${callRef}_${appRef}_${mediaSessionRef}`,
    recordingRef: `rec_${callRef}_${appRef}_${mediaSessionRef}`,
    file_name: fileName,
    fileName,
    storage_key: `fonoster-monitor/${fileName}`,
    storageKey: `fonoster-monitor/${fileName}`,
    recording_url: recordingBaseUrl
      ? `${recordingBaseUrl}/${encodeURIComponent(fileName)}`
      : "",
    recordingUrl: recordingBaseUrl
      ? `${recordingBaseUrl}/${encodeURIComponent(fileName)}`
      : "",
    format: "wav",
    channels: 1,
    channel_layout: "mixed_mono",
    channelLayout: "mixed_mono",
    source_app_ref: appRef,
    sourceAppRef: appRef
  };
}

function scheduleRecordingReadyEvent({
  bridge,
  inbound,
  decision,
  routingMode,
  appRefs,
  context
}) {
  const recordingOwnership = decision.recordingOwnership || decision.recording_ownership || "";
  const recordingImportContract =
    decision.recordingImportContract || decision.recording_import_contract || "";
  if (
    recordingOwnership === "onelink_runtime" ||
    recordingImportContract === "runtime_owned_no_fonoster_import" ||
    recordingImportContract === "fonoster_pull_recording_ready_required"
  ) {
    return;
  }

  const recordingBaseUrl = normalizeUrlBase(config.recordingBaseUrl);
  const callRef = inbound.bridgeCallRef || inbound.callRef || "";
  const mediaSessionRef = inbound.mediaSessionRef || "";
  if (!recordingBaseUrl || !callRef || !mediaSessionRef) return;

  const uniqueAppRefs = [...new Set(appRefs.filter(Boolean))];
  const artifacts = uniqueAppRefs
    .map((appRef) =>
      buildAsteriskRecordingArtifact({ appRef, mediaSessionRef, callRef })
    )
    .filter(Boolean);
  if (!artifacts.length) return;

  const primary = artifacts[0];
  const eventId = `evt_recording_ready_${callRef}_${mediaSessionRef}_${routingMode}`;

  setTimeout(() => {
    void emitBridgeEvent(bridge, withLifecycle({
      eventType: "recording_ready",
      event_id: eventId,
      eventId,
      callRef,
      bridgeCallRef: callRef,
      bridge_call_ref: callRef,
      parentCallRef: callRef,
      parent_call_ref: callRef,
      provider_call_id: callRef,
      providerCallId: callRef,
      runtimeCallRef: inbound.runtimeCallRef || "",
      runtime_call_ref: inbound.runtimeCallRef || "",
      childCallRef: inbound.runtimeCallRef || "",
      child_call_ref: inbound.runtimeCallRef || "",
      mediaSessionRef,
      mode: routingMode,
      routingMode,
      action: decision.action,
      appRef: decision.appRef || inbound.appRef || "",
      recording_ref: primary.recording_ref,
      recordingRef: primary.recordingRef,
      storage_key: primary.storage_key,
      storageKey: primary.storageKey,
      recording_url: primary.recording_url,
      recordingUrl: primary.recordingUrl,
      format: "wav",
      channels: primary.channels,
      channel_layout: primary.channel_layout,
      channelLayout: primary.channelLayout,
      is_complete_stereo: false,
      isCompleteStereo: false,
      recording_status: "incomplete",
      recordingStatus: "incomplete",
      degraded: true,
      missing_direction: "unknown",
      missingDirection: "unknown",
      source: "fonoster-asterisk",
      artifacts,
      ...context
    }));
  }, Math.max(0, config.recordingReadyDelayMs));
}

function normalizeRoutingMode(action) {
  const normalized = String(action || "").trim().toLowerCase().replace(/_/g, "-");
  if (normalized === "ai-agent") return "ai";
  if (normalized === "agent") return "operator";
  if (normalized === "outbound-target") return "outbound_target";
  if (["operator", "app", "ai", "reject", "transfer"].includes(normalized)) {
    return normalized;
  }
  return normalized || "";
}

function normalizeCallDirection(direction) {
  const normalized = String(direction || "").trim().toLowerCase();
  if (["from_pstn", "inbound", "incoming"].includes(normalized)) return "inbound";
  if (["to_pstn", "outbound", "outgoing"].includes(normalized)) return "outbound";
  return normalized || "";
}

function currentStatusForDialStatus(status) {
  switch (status) {
    case "answered":
      return "in_progress";
    case "ringing":
      return "connecting";
    case "no-answer":
      return "no_answer";
    case "busy":
      return "busy";
    case "rejected":
      return "rejected";
    case "timeout":
      return "timeout";
    case "cancelled":
      return "cancelled";
    case "completed":
    case "hangup":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "";
  }
}

function endReasonForStatus(status) {
  switch (status) {
    case "completed":
      return "completed";
    case "no-answer":
      return "no_answer";
    case "busy":
      return "busy";
    case "rejected":
      return "rejected";
    case "timeout":
      return "timeout";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "hangup":
      return "hangup";
    case "rejected":
    case "rejected_without_answer":
      return "rejected_by_policy";
    default:
      return "";
  }
}

function endedByForDialStatus(status, targetActor = "provider") {
  switch (status) {
    case "completed":
      return "unknown";
    case "hangup":
      return targetActor || "provider";
    case "busy":
    case "rejected":
    case "cancelled":
    case "failed":
    case "no-answer":
    case "timeout":
      return "provider";
    default:
      return "";
  }
}

function toPositiveNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function deltaMs(from, to) {
  const fromMs = Date.parse(String(from || ""));
  const toMs = Date.parse(String(to || ""));
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return undefined;
  return Math.max(0, toMs - fromMs);
}

function isTruthyFlag(value) {
  if (typeof value === "boolean") return value;
  if (value === undefined || value === null || value === "") return false;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function hasObservedAudioOut(media = {}) {
  const sawAudioOut = isTruthyFlag(media.sawAudioOut ?? media.saw_audio_out);
  const audioOutBytes =
    toPositiveNumber(media.audioOutBytesTotal ?? media.audio_out_bytes_total) ||
    toPositiveNumber(media.firstAudioOutBytes ?? media.first_audio_out_bytes);

  return sawAudioOut && audioOutBytes > 0;
}

function hasEstablishedAppMedia(media = {}) {
  if (media.mediaEstablished === true || media.media_established === true) {
    return true;
  }

  return hasObservedAudioOut(media);
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

function appTerminalOutcomeForDialStatus(status, appLegAnswered, media = {}) {
  if (status === "cancelled" && appLegAnswered && !hasObservedAudioOut(media)) {
    return "media_stream_closed_before_audio";
  }
  if (status === "cancelled" && appLegAnswered && hasObservedAudioOut(media)) {
    return "media_stream_closed_after_audio";
  }
  return status;
}

function currentStatusForAppDialStatus(status, appLegAnswered, media = {}) {
  if (status === "cancelled" && appLegAnswered && !hasObservedAudioOut(media)) {
    return "failed";
  }
  return currentStatusForDialStatus(status);
}

function endedByForAppDialStatus(status, targetActor, appLegAnswered) {
  if (status === "cancelled" && appLegAnswered) {
    return "provider";
  }

  return endedByForDialStatus(status, targetActor);
}

function endReasonForAppDialStatus(status, routingMode, appLegAnswered, media = {}) {
  if (status === "cancelled" && appLegAnswered && !hasObservedAudioOut(media)) {
    return "media_stream_closed_before_audio";
  }
  if (status === "cancelled" && appLegAnswered && hasObservedAudioOut(media)) {
    return "media_stream_closed_after_audio";
  }
  if (status === "hangup") return `${routingMode}_hangup`;
  return endReasonForStatus(status);
}

function actorToHangupInitiator(actor) {
  switch (actor) {
    case "operator_device":
      return "operator";
    case "callee_device":
      return "callee";
    case "ai":
    case "app":
    case "callee":
    case "caller":
    case "operator":
    case "system":
    case "timeout":
    case "bridge":
    case "provider":
    case "runtime":
    case "unknown":
      return actor;
    default:
      return actor || "";
  }
}

function hangupInitiatorForDialStatus(status, targetActor, legAnswered) {
  if (status === "hangup") return actorToHangupInitiator(targetActor) || "provider";
  if (status === "cancelled" && legAnswered) {
    return "provider";
  }
  if (status === "completed") return "unknown";
  if (["busy", "cancelled", "failed", "no-answer", "rejected", "timeout"].includes(status)) {
    return "provider";
  }
  return "";
}

function humanReadableReasonFor(reason) {
  const normalized = String(reason || "").trim();
  if (!normalized) return "";
  return normalized.replace(/[_-]+/g, " ");
}

function legAnsweredFields(legType, answered) {
  const normalizedLegType = normalizeRoutingMode(legType) || String(legType || "");
  if (!normalizedLegType) return {};

  const fields = {};
  if (normalizedLegType === "operator") {
    fields.operatorLegAnswered = answered;
    fields.operator_leg_answered = answered;
  } else if (normalizedLegType === "ai") {
    fields.aiLegAnswered = answered;
    fields.ai_leg_answered = answered;
  } else if (normalizedLegType === "app") {
    fields.appLegAnswered = answered;
    fields.app_leg_answered = answered;
  } else if (normalizedLegType === "caller") {
    fields.callerLegAnswered = answered;
    fields.caller_leg_answered = answered;
  } else if (normalizedLegType === "callee" || normalizedLegType === "target") {
    fields.calleeLegAnswered = answered;
    fields.callee_leg_answered = answered;
    fields.targetLegAnswered = answered;
    fields.target_leg_answered = answered;
  }

  return fields;
}

function terminationMetadata({
  legType,
  hangupInitiator,
  endReason,
  answered,
  sipStatus,
  q850Cause
}) {
  const normalizedLegType = normalizeRoutingMode(legType) || String(legType || "");
  const normalizedInitiator = actorToHangupInitiator(hangupInitiator);
  const humanReadableReason = humanReadableReasonFor(endReason);
  const fields = {
    ...(normalizedLegType
      ? {
          legType: normalizedLegType,
          leg_type: normalizedLegType
        }
      : {}),
    ...(normalizedInitiator
      ? {
          hangupInitiator: normalizedInitiator,
          hangup_initiator: normalizedInitiator
        }
      : {}),
    ...(endReason
      ? {
          humanReadableReason,
          human_readable_reason: humanReadableReason
        }
      : {}),
    ...(sipStatus
      ? {
          sipStatus,
          sip_status: sipStatus
        }
      : {}),
    ...(q850Cause
      ? {
          q850Cause,
          q850_cause: q850Cause
        }
      : {})
  };

  return {
    ...fields,
    ...(answered !== undefined ? legAnsweredFields(normalizedLegType, answered) : {})
  };
}

function appMediaFields(appLegAnswered, media = {}) {
  const mediaEstablished = hasEstablishedAppMedia(media);
  const mediaEstablishedReason = mediaEstablished
    ? "audio_out_observed_by_bridge"
    : appLegAnswered
      ? "app_answered_media_not_observed_by_bridge"
      : "app_media_not_established";

  return {
    appLegAnswered,
    app_leg_answered: appLegAnswered,
    mediaEstablished,
    media_established: mediaEstablished,
    mediaEstablishedReason: mediaEstablishedReason,
    media_established_reason: mediaEstablishedReason
  };
}

function addVoiceEndListener(voice, handler) {
  const emitter = resolveVoiceEmitter(voice);
  if (!emitter) return () => {};

  const onEnd = () => handler({ type: VOICE_EVENT_END });
  const onError = (error) => {
    handler({
      type: VOICE_EVENT_ERROR,
      error: error?.message || String(error || "unknown voice stream error")
    });
  };

  emitter.on(VOICE_EVENT_END, onEnd);
  emitter.on(VOICE_EVENT_ERROR, onError);

  return () => {
    if (typeof emitter.removeListener !== "function") return;
    emitter.removeListener(VOICE_EVENT_END, onEnd);
    emitter.removeListener(VOICE_EVENT_ERROR, onError);
  };
}

function resolveVoiceEmitter(voice) {
  if (voice?.voice && typeof voice.voice.on === "function") return voice.voice;
  if (voice && typeof voice.on === "function") return voice;
  return null;
}

function addVoiceDataListener(voice, handler) {
  const emitter = resolveVoiceEmitter(voice);
  if (!emitter) return () => {};

  emitter.on("data", handler);
  return () => {
    if (typeof emitter.removeListener === "function") {
      emitter.removeListener("data", handler);
    }
  };
}

function extractDialStatus(result) {
  if (!result || typeof result !== "object") return "";
  const dialStatus = result.dialStatus;
  if (dialStatus && typeof dialStatus === "object") {
    return dialStatus.status ?? "";
  }
  return dialStatus ?? result.dialResponse?.status ?? "";
}

function extractDialRuntimeCallRef(result) {
  if (!result || typeof result !== "object") return "";

  const candidates = [
    result.runtimeCallRef,
    result.runtime_call_ref,
    result.childCallRef,
    result.child_call_ref,
    result.callRef,
    result.call_ref,
    result.ref,
    result.dialStatus?.runtimeCallRef,
    result.dialStatus?.runtime_call_ref,
    result.dialStatus?.childCallRef,
    result.dialStatus?.child_call_ref,
    result.dialStatus?.callRef,
    result.dialStatus?.call_ref,
    result.dialStatus?.ref,
    result.dialResponse?.runtimeCallRef,
    result.dialResponse?.runtime_call_ref,
    result.dialResponse?.childCallRef,
    result.dialResponse?.child_call_ref,
    result.dialResponse?.callRef,
    result.dialResponse?.call_ref,
    result.dialResponse?.ref
  ];

  return String(candidates.find((value) => value !== undefined && value !== null && value !== "") || "");
}

function extractDialStreamRef(result) {
  if (!result || typeof result !== "object") return "";

  const candidates = [
    result.streamRef,
    result.stream_ref,
    result.dialStatus?.streamRef,
    result.dialStatus?.stream_ref,
    result.dialResponse?.streamRef,
    result.dialResponse?.stream_ref
  ];

  return String(candidates.find((value) => value !== undefined && value !== null && value !== "") || "");
}

function extractDialCloseSource(result) {
  if (!result || typeof result !== "object") return "";

  const candidates = [
    result.closeSource,
    result.close_source,
    result.dialStatus?.closeSource,
    result.dialStatus?.close_source,
    result.dialResponse?.closeSource,
    result.dialResponse?.close_source
  ];

  return String(candidates.find((value) => value !== undefined && value !== null && value !== "") || "");
}

function extractDialMediaAccounting(result) {
  if (!result || typeof result !== "object") return {};

  const source =
    result.dialStatus && typeof result.dialStatus === "object"
      ? result.dialStatus
      : result.dialResponse && typeof result.dialResponse === "object"
        ? result.dialResponse
        : result;

  const fields = {};
  const mappings = [
    ["sawAudioIn", "saw_audio_in"],
    ["sawAudioOut", "saw_audio_out"],
    ["firstAudioInAt", "first_audio_in_at"],
    ["firstAudioOutAt", "first_audio_out_at"],
    ["firstAudioInBytes", "first_audio_in_bytes"],
    ["firstAudioOutBytes", "first_audio_out_bytes"],
    ["audioInBytesTotal", "audio_in_bytes_total"],
    ["audioOutBytesTotal", "audio_out_bytes_total"],
    ["startStreamResponseAt", "start_stream_response_at"],
    ["firstAudioInDeltaMs", "first_audio_in_delta_ms"],
    ["firstAudioOutDeltaMs", "first_audio_out_delta_ms"],
    ["cancelDeltaMs", "cancel_delta_ms"],
    ["cancelAfterFirstAudioInDeltaMs", "cancel_after_first_audio_in_delta_ms"],
    ["cancelAfterFirstAudioOutDeltaMs", "cancel_after_first_audio_out_delta_ms"],
    ["cancelAt", "cancel_at"],
    ["closeReason", "close_reason"]
  ];

  for (const [camelName, snakeName] of mappings) {
    const value = source[camelName] ?? source[snakeName];
    if (value === undefined || value === null || value === "") continue;
    fields[camelName] = value;
    fields[snakeName] = value;
  }

  const cancelAt = fields.cancelAt || fields.cancel_at;
  const startStreamResponseAt =
    fields.startStreamResponseAt || fields.start_stream_response_at;
  const firstAudioInAt = fields.firstAudioInAt || fields.first_audio_in_at;
  const firstAudioOutAt = fields.firstAudioOutAt || fields.first_audio_out_at;
  const derivedDeltas = [
    ["cancelDeltaMs", "cancel_delta_ms", startStreamResponseAt],
    ["cancelAfterFirstAudioInDeltaMs", "cancel_after_first_audio_in_delta_ms", firstAudioInAt],
    ["cancelAfterFirstAudioOutDeltaMs", "cancel_after_first_audio_out_delta_ms", firstAudioOutAt]
  ];

  for (const [camelName, snakeName, from] of derivedDeltas) {
    if (fields[camelName] !== undefined || fields[snakeName] !== undefined) continue;
    const value = deltaMs(from, cancelAt);
    if (value === undefined) continue;
    fields[camelName] = value;
    fields[snakeName] = value;
  }

  return fields;
}

function writeDialRequest(voice, request) {
  const emitter = resolveVoiceEmitter(voice);
  if (!emitter || typeof emitter.write !== "function") return false;

  emitter.write({
    dialRequest: request
  });

  return true;
}

function detachEntryVoiceEndClosers(voice) {
  const emitter = resolveVoiceEmitter(voice);
  if (!emitter || typeof emitter.listeners !== "function") {
    return { detachedCount: 0 };
  }

  const listeners = emitter.listeners(VOICE_EVENT_END);
  for (const listener of listeners) {
    emitter.removeListener(VOICE_EVENT_END, listener);
  }

  return { detachedCount: listeners.length };
}

function actorForRoutingMode(routingMode) {
  switch (routingMode) {
    case "operator":
      return "operator_device";
    case "ai":
      return "ai";
    case "app":
      return "app";
    default:
      return "";
  }
}

function withLifecycle(event, fields = {}) {
  const enriched = applyObservedMediaGuard({ ...event, ...fields });
  addCorrelationFields(enriched, enriched);
  const routingMode = normalizeRoutingMode(
    enriched.routingMode || enriched.routing_mode || enriched.action
  );
  const callDirection = normalizeCallDirection(
    enriched.callDirection || enriched.call_direction || enriched.direction
  );
  const currentStatus =
    enriched.currentStatus ||
    enriched.current_status ||
    (enriched.status ? currentStatusForDialStatus(enriched.status) : "");
  const terminal = currentStatus
    ? TERMINAL_CURRENT_STATUSES.has(currentStatus)
    : undefined;

  addAlias(enriched, "routingMode", "routing_mode", routingMode);
  addAlias(enriched, "callDirection", "call_direction", callDirection);
  addAlias(enriched, "currentStatus", "current_status", currentStatus);
  addAlias(enriched, "answeredBy", "answered_by", enriched.answeredBy || enriched.answered_by);
  addAlias(enriched, "endedBy", "ended_by", enriched.endedBy || enriched.ended_by);
  addAlias(enriched, "endReason", "end_reason", enriched.endReason || enriched.end_reason);
  addAlias(enriched, "legType", "leg_type", enriched.legType || enriched.leg_type || enriched.leg);
  addAlias(
    enriched,
    "hangupInitiator",
    "hangup_initiator",
    enriched.hangupInitiator || enriched.hangup_initiator || enriched.endedBy || enriched.ended_by
  );
  addAlias(enriched, "sipStatus", "sip_status", enriched.sipStatus || enriched.sip_status);
  addAlias(enriched, "q850Cause", "q850_cause", enriched.q850Cause || enriched.q850_cause);
  addAlias(
    enriched,
    "humanReadableReason",
    "human_readable_reason",
    enriched.humanReadableReason ||
      enriched.human_readable_reason ||
      humanReadableReasonFor(enriched.endReason || enriched.end_reason)
  );

  if (terminal !== undefined) {
    enriched.terminal = terminal;
  }

  return applyObservedMediaGuard(enriched);
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
  const normalizedAction = normalizeRoutingMode(action) || action;
  const explicitlyAnswered =
    decision.answer === true ||
    decision.answerCall === true ||
    decision.answer_call === true;
  const explicitlyNotAnswered =
    decision.answer === false ||
    decision.answerCall === false ||
    decision.answer_call === false;

  const shouldAnswer = explicitlyAnswered
    ? true
    : explicitlyNotAnswered || normalizedAction === "reject" || normalizedAction === "operator"
      ? false
      : true;

  return {
    action: normalizedAction,
    routingMode:
      normalizeRoutingMode(decision.routingMode || decision.routing_mode) ||
      normalizedAction,
    answer: shouldAnswer,
    reason: decision.reason || null,
    message: decision.message || "",
    originalAction:
      decision.originalAction || decision.original_action || normalizedAction,
    transferMessage:
      decision.transferMessage || decision.transfer_message || "",
    timeout: decision.timeout || 60,
    appRef: decision.appRef || decision.app_ref || "",
    operatorAppRef: decision.operatorAppRef || decision.operator_app_ref || "",
    operatorFirstClassProductionPath:
      normalizeOptionalBoolean(
        decision.operatorFirstClassProductionPath ??
          decision.operator_first_class_production_path
      ),
    operatorExecutionMode:
      decision.operatorExecutionMode || decision.operator_execution_mode || "",
    operatorDirectBridgeDegraded:
      normalizeOptionalBoolean(
        decision.operatorDirectBridgeDegraded ?? decision.operator_direct_bridge_degraded
      ),
    mediaOwnership: decision.mediaOwnership || decision.media_ownership || "",
    recordingOwnership:
      decision.recordingOwnership || decision.recording_ownership || "",
    transcriptOwnership:
      decision.transcriptOwnership || decision.transcript_ownership || "",
    operatorObservabilityKey:
      decision.operatorObservabilityKey || decision.operator_observability_key || "",
    operatorSlaClass: decision.operatorSlaClass || decision.operator_sla_class || "",
    recordingImportContract:
      decision.recordingImportContract || decision.recording_import_contract || "",
    transcriptContract: decision.transcriptContract || decision.transcript_contract || "",
    agentAor: decision.agentAor || decision.agent_aor || "",
    destination: decision.destination || "",
    phoneNumber: decision.phoneNumber || decision.phone_number || "",
    recordingEnabled:
      normalizeOptionalBoolean(
        decision.recordingEnabled ?? decision.recording_enabled
      ),
    recordingContract:
      isPlainObject(decision.recordingContract)
        ? decision.recordingContract
        : isPlainObject(decision.recording_contract)
          ? decision.recording_contract
          : isPlainObject(decision.recording)
            ? decision.recording
            : {},
    metadata:
      isPlainObject(decision.metadata)
        ? decision.metadata
        : {},
    handoffMetadata:
      (isPlainObject(decision.handoffMetadata)
        ? decision.handoffMetadata
        : isPlainObject(decision.handoff_metadata)
          ? decision.handoff_metadata
          : {}),
    accountId: decision.accountId || decision.account_id || "",
    numberRef: decision.numberRef || decision.number_ref || "",
    inboxId: decision.inboxId || decision.inbox_id || "",
    idempotencyKey:
      decision.idempotencyKey || decision.idempotency_key || ""
  };
}

function buildAppHandoffMetadata({ inbound, decision, routingMode, context }) {
  const callDirection = normalizeCallDirection(inbound.direction) || "inbound";
  const originalAction = decision.originalAction || decision.original_action || decision.action;
  const target = resolveDialTarget(decision);
  const inboundMetadata = isPlainObject(inbound.metadata) ? inbound.metadata : {};
  const decisionMetadata = isPlainObject(decision.metadata) ? decision.metadata : {};
  const handoffMetadata = isPlainObject(decision.handoffMetadata)
    ? decision.handoffMetadata
    : {};
  const recordingMetadata = buildRecordingMetadata({
    ...inboundMetadata,
    ...decisionMetadata,
    ...handoffMetadata,
    ...decision,
    ...(decision.recordingEnabled !== undefined
      ? { recording_enabled: decision.recordingEnabled }
      : {}),
    ...(isPlainObject(decision.recordingContract)
      ? { recording_contract: decision.recordingContract }
      : {})
  });

  return {
    ...inboundMetadata,
    ...decisionMetadata,
    ...handoffMetadata,
    call_ref: inbound.bridgeCallRef || inbound.callRef || "",
    callRef: inbound.bridgeCallRef || inbound.callRef || "",
    bridge_call_ref: inbound.bridgeCallRef || inbound.callRef || "",
    bridgeCallRef: inbound.bridgeCallRef || inbound.callRef || "",
    parent_call_ref: inbound.bridgeCallRef || inbound.callRef || "",
    parentCallRef: inbound.bridgeCallRef || inbound.callRef || "",
    provider_call_id: inbound.bridgeCallRef || inbound.callRef || "",
    providerCallId: inbound.bridgeCallRef || inbound.callRef || "",
    runtime_call_ref: inbound.runtimeCallRef || "",
    runtimeCallRef: inbound.runtimeCallRef || "",
    child_call_ref: inbound.runtimeCallRef || "",
    childCallRef: inbound.runtimeCallRef || "",
    media_session_ref: inbound.mediaSessionRef || "",
    mediaSessionRef: inbound.mediaSessionRef || "",
    direction: callDirection,
    call_direction: callDirection,
    mode: routingMode,
    routing_mode: routingMode,
    original_action: originalAction || "",
    app_ref: decision.appRef || "",
    operator_app_ref: decision.operatorAppRef || "",
    operator_first_class_production_path:
      decision.operatorFirstClassProductionPath,
    operator_execution_mode: decision.operatorExecutionMode || "",
    operator_direct_bridge_degraded: decision.operatorDirectBridgeDegraded,
    media_ownership: decision.mediaOwnership || "",
    recording_ownership: decision.recordingOwnership || "",
    transcript_ownership: decision.transcriptOwnership || "",
    operator_observability_key: decision.operatorObservabilityKey || "",
    operator_sla_class: decision.operatorSlaClass || "",
    recording_import_contract: decision.recordingImportContract || "",
    transcript_contract: decision.transcriptContract || "",
    request_id: context.requestId || "",
    account_id: context.accountId || "",
    idempotency_key: context.idempotencyKey || "",
    ...(target ? { target, destination: target } : {}),
    ...(decision.agentAor
      ? {
          agent_aor: decision.agentAor,
          operator_agent_aor: decision.agentAor
        }
      : {}),
    ...(decision.phoneNumber ? { phone_number: decision.phoneNumber } : {}),
    ...recordingMetadata
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

function startTerminateRequestWatcher({ inbound, bridge, context = {}, onTerminate }) {
  if (!config.controlEventsEnabled || !inbound.callRef) {
    return () => {};
  }

  let stopped = false;
  let sinceId = 0;

  async function loop() {
    while (!stopped) {
      try {
        const payload = await bridge.pollCallEvents(
          inbound.callRef,
          "terminate_requested",
          {
            sinceId,
            accountId: context.accountId,
            requestId: context.requestId,
            timeoutMs: config.controlPollMs
          }
        );
        const items = Array.isArray(payload?.items) ? payload.items : [];

        for (const item of items) {
          if (item?.seq && item.seq > sinceId) {
            sinceId = item.seq;
          }

          if (stopped) return;
          if (item?.callRef !== inbound.callRef && item?.call_ref !== inbound.callRef) {
            continue;
          }

          await onTerminate(item);
          return;
        }
      } catch (error) {
        if (!stopped) {
          logger.warn("failed to poll terminate control events", {
            callRef: inbound.callRef,
            mediaSessionRef: inbound.mediaSessionRef,
            type: error.type || "unknown",
            message: error.message
          });
          await delay(Math.min(1000, Math.max(100, config.controlPollMs)));
        }
      }
    }
  }

  void loop();

  return () => {
    stopped = true;
  };
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
  const action = normalizeRoutingMode(decision.action);
  const outboundTargetMode = action === "outbound_target";
  const routingMode = "operator";
  const callDirection = outboundTargetMode
    ? "outbound"
    : normalizeCallDirection(
        decision.callDirection ||
          decision.call_direction ||
          inbound.direction ||
          inbound.callDirection ||
          inbound.call_direction
      ) || "inbound";
  const dialLeg = outboundTargetMode ? "callee" : "operator";
  const dialActor = outboundTargetMode ? "callee_device" : "operator_device";
  const dialRingingEventType = outboundTargetMode ? "callee_ringing" : "operator_ringing";
  const dialAnsweredEventType = outboundTargetMode ? "callee_answered" : "operator_answered";
  const answerBeforeDial = decision.answer !== false;

  if (!destination) {
    throw new Error("operator decision did not include a dialable destination");
  }

  let callerAnswered = false;
  let operatorAnswered = false;
  let terminalEmitted = false;
  let lastRawStatus = "";
  let lastNormalizedStatus = "";
  let lastDialStatusKey = "";
  let dialStatusTimeoutTimer = null;
  let cleanupVoiceEndListener = () => {};
  let cleanupDialDataListener = () => {};
  let cleanupTerminateRequestWatcher = () => {};
  let terminalResolved;
  const terminalPromise = new Promise((resolve) => {
    terminalResolved = resolve;
  });

  function clearDialStatusTimeout() {
    if (!dialStatusTimeoutTimer) return;
    clearTimeout(dialStatusTimeoutTimer);
    dialStatusTimeoutTimer = null;
  }

  function startDialStatusTimeout() {
    const timeoutSeconds = Math.max(1, Number(decision.timeout || 60));
    const timeoutMs = timeoutSeconds * 1000 + 5000;
    if (dialStatusTimeoutTimer) return;

    dialStatusTimeoutTimer = setTimeout(() => {
      dialStatusTimeoutTimer = null;
      if (terminalEmitted) return;

      logger.warn("operator dial status timeout elapsed", {
        callRef: inbound.callRef,
        mediaSessionRef: inbound.mediaSessionRef,
        destination,
        timeoutMs,
        operatorAnswered,
        lastRawStatus,
        lastNormalizedStatus
      });

      emitTerminal({
        outcome: operatorAnswered
          ? "operator_terminal_status_timeout"
          : "operator_no_answer_timeout",
        eventTypeOverride: operatorAnswered ? "operator_timeout" : "operator_timeout",
        terminalSource: "operator_dial_timeout",
        terminal_source: "operator_dial_timeout",
        currentStatus: operatorAnswered ? "failed" : "no_answer",
        endedBy: "system",
        hangupInitiator: "timeout",
        hangup_initiator: "timeout",
        endReason: operatorAnswered
          ? "operator_terminal_status_timeout"
          : "no_answer",
        operatorLegTerminalReceived: false,
        operator_leg_terminal_received: false
      });
    }, timeoutMs);
  }

  function emitTerminal(extra) {
    if (terminalEmitted) return;
    terminalEmitted = true;
    clearDialStatusTimeout();
    cleanupVoiceEndListener();
    cleanupDialDataListener();
    cleanupTerminateRequestWatcher();
    const terminalEndReason = extra.endReason || extra.end_reason || extra.outcome;

    const terminalEventType = extra.eventTypeOverride || extra.event_type_override || "session_completed";

    if (terminalEventType !== "session_completed") {
      void emitBridgeEvent(bridge, withLifecycle({
        eventType: terminalEventType,
        callRef: inbound.callRef,
        bridgeCallRef: inbound.bridgeCallRef,
        runtimeCallRef: inbound.runtimeCallRef,
        mediaSessionRef: inbound.mediaSessionRef,
        action: decision.action,
        destination,
        leg: dialLeg,
        legType: dialLeg,
        leg_type: dialLeg,
        ...legAnsweredFields(dialLeg, operatorAnswered),
        routingMode,
        callDirection,
        currentStatus: extra.currentStatus,
        endedBy: extra.endedBy,
        endReason: extra.endReason || terminalEndReason,
        rawStatus: extra.rawStatus || lastRawStatus,
        raw_status: extra.raw_status || extra.rawStatus || lastRawStatus,
        terminalSource: extra.terminalSource || extra.terminal_source,
        terminal_source: extra.terminal_source || extra.terminalSource,
        operatorAnswered,
        operator_answered: operatorAnswered,
        callerAnswered,
        caller_answered: callerAnswered,
        ...context
      }));
    }

    void emitBridgeEvent(bridge, withLifecycle({
      eventType: "session_completed",
      callRef: inbound.callRef,
      mediaSessionRef: inbound.mediaSessionRef,
      outcome: extra.outcome,
      action: decision.action,
      destination,
      rawStatus: extra.rawStatus || lastRawStatus,
      raw_status: extra.raw_status || extra.rawStatus || lastRawStatus,
      leg: dialLeg,
      ...terminationMetadata({
        legType: dialLeg,
        hangupInitiator:
          extra.hangupInitiator ||
          extra.hangup_initiator ||
          extra.endedBy ||
          extra.ended_by,
        endReason: terminalEndReason,
        answered: operatorAnswered,
        sipStatus: extra.sipStatus || extra.sip_status,
        q850Cause: extra.q850Cause || extra.q850_cause
      }),
      routingMode,
      callDirection,
      currentStatus: extra.currentStatus,
      endedBy: extra.endedBy,
      endReason: extra.endReason,
      lastRawStatus,
      last_raw_status: lastRawStatus,
      lastNormalizedStatus,
      last_normalized_status: lastNormalizedStatus,
      operatorAnswered,
      operator_answered: operatorAnswered,
      callerAnswered,
      caller_answered: callerAnswered,
      ...context,
      ...extra
    })).finally(() => {
      scheduleRecordingReadyEvent({
        bridge,
        inbound,
        decision,
        routingMode,
        appRefs: [inbound.appRef],
        context
      });
      terminalResolved();
    });
  }

  async function answerCallerAtOperatorAnswer() {
    if (callerAnswered) return;

    try {
      await voice.answer();
      callerAnswered = true;
    } catch (error) {
      logger.warn("failed to answer caller after operator answered", {
        callRef: inbound.callRef,
        mediaSessionRef: inbound.mediaSessionRef,
        destination,
        message: error?.message || String(error)
      });
    }
  }

  async function handleTerminateRequest(event) {
    if (terminalEmitted) return;

    const reason =
      event?.reason ||
      event?.endReason ||
      event?.end_reason ||
      "operator_declined";
    const endedBy =
      event?.endedBy ||
      event?.ended_by ||
      event?.actor ||
      "operator";

    logger.info("operator terminate requested", {
      callRef: inbound.callRef,
      mediaSessionRef: inbound.mediaSessionRef,
      destination,
      reason,
      endedBy,
      eventSeq: event?.seq || null
    });

    emitTerminal({
      outcome: reason,
      terminalSource: "operator_control",
      terminal_source: "operator_control",
      currentStatus: "cancelled",
      endedBy,
      hangupInitiator: endedBy,
      hangup_initiator: actorToHangupInitiator(endedBy),
      endReason: reason,
      operatorLegTerminalReceived: false,
      operator_leg_terminal_received: false,
      controlEventSeq: event?.seq || null,
      control_event_seq: event?.seq || null
    });

    if (typeof voice.hangup !== "function") return;

    try {
      await voice.hangup();
    } catch (error) {
      logger.warn("failed to hang up after operator terminate request", {
        callRef: inbound.callRef,
        mediaSessionRef: inbound.mediaSessionRef,
        destination,
        reason,
        message: error?.message || String(error)
      });
    }
  }

  async function handleOperatorDialStatus(status, statusSource) {
    if (terminalEmitted) return;

    const normalizedStatus = normalizeDialStatus(status);
    const rawStatus = String(status || "");
    if (!rawStatus) return;

    const dialStatusKey = `${rawStatus}:${normalizedStatus}`;
    if (dialStatusKey === lastDialStatusKey) return;
    lastDialStatusKey = dialStatusKey;
    lastRawStatus = rawStatus;
    lastNormalizedStatus = normalizedStatus;

    logger.info("dial status update", {
      callRef: inbound.callRef,
      mediaSessionRef: inbound.mediaSessionRef,
      destination,
      status: normalizedStatus,
      rawStatus: status,
      statusSource
    });

    void emitBridgeEvent(bridge, withLifecycle({
      eventType: "dial_status",
      callRef: inbound.callRef,
      mediaSessionRef: inbound.mediaSessionRef,
      action: decision.action,
      destination,
      status: normalizedStatus,
      rawStatus: status,
      raw_status: status,
      statusSource,
      status_source: statusSource,
      leg: dialLeg,
      legType: dialLeg,
      leg_type: dialLeg,
      ...legAnsweredFields(dialLeg, operatorAnswered),
      operatorLegAnswered: operatorAnswered,
      operator_leg_answered: operatorAnswered,
      routingMode,
      callDirection,
      currentStatus: currentStatusForDialStatus(normalizedStatus),
      ...(normalizedStatus === "answered"
        ? {
            answeredBy: dialActor,
            mediaEstablished: true,
            media_established: true
          }
        : {}),
      ...context
    }));

    if (normalizedStatus === "ringing") {
      void emitBridgeEvent(bridge, withLifecycle({
        eventType: dialRingingEventType,
        callRef: inbound.callRef,
        mediaSessionRef: inbound.mediaSessionRef,
        action: decision.action,
        destination,
        leg: dialLeg,
        legType: dialLeg,
        leg_type: dialLeg,
        ...legAnsweredFields(dialLeg, operatorAnswered),
        operatorLegAnswered: operatorAnswered,
        operator_leg_answered: operatorAnswered,
        routingMode,
        callDirection,
        currentStatus: "connecting",
        ...context
      }));
    }

    if (normalizedStatus === "answered") {
      if (operatorAnswered) return;
      operatorAnswered = true;
      clearDialStatusTimeout();
      await answerCallerAtOperatorAnswer();

      const answeredFields = {
        callRef: inbound.callRef,
        mediaSessionRef: inbound.mediaSessionRef,
        action: decision.action,
        destination,
        leg: dialLeg,
        legType: dialLeg,
        leg_type: dialLeg,
        ...legAnsweredFields(dialLeg, true),
        operatorLegAnswered: true,
        operator_leg_answered: true,
        routingMode,
        callDirection,
        answeredBy: dialActor,
        currentStatus: "in_progress",
        mediaEstablished: true,
        media_established: true,
        ...context
      };

      void emitBridgeEvent(bridge, withLifecycle({
        eventType: dialAnsweredEventType,
        ...answeredFields
      }));

      void emitBridgeEvent(bridge, withLifecycle({
        eventType: "answered",
        ...answeredFields
      }));
    }

    if (TERMINAL_DIAL_STATUSES.has(normalizedStatus)) {
      const currentStatus = currentStatusForDialStatus(normalizedStatus);
      const terminalEventType =
        normalizedStatus === "no-answer"
          ? "operator_no_answer"
          : normalizedStatus === "busy"
            ? "operator_busy"
            : normalizedStatus === "rejected"
              ? "operator_rejected"
              : normalizedStatus === "timeout"
                ? "operator_timeout"
                : normalizedStatus === "failed"
                  ? "operator_dial_failed"
                  : "session_completed";
      emitTerminal({
        eventTypeOverride: terminalEventType,
        outcome: normalizedStatus,
        rawStatus: status,
        raw_status: status,
        currentStatus,
        endedBy: normalizedStatus === "completed" ? dialActor : "provider",
        hangupInitiator: hangupInitiatorForDialStatus(
          normalizedStatus,
          dialActor,
          operatorAnswered
        ),
        endReason: endReasonForStatus(normalizedStatus),
        terminalSource: "dial_status",
        terminal_source: "dial_status",
        operatorLegTerminalReceived: true,
        operator_leg_terminal_received: true
      });
    }
  }

  if (answerBeforeDial) {
    await voice.answer();
    callerAnswered = true;

    if (!outboundTargetMode) {
      await emitBridgeEvent(bridge, withLifecycle({
        eventType: "answered",
        callRef: inbound.callRef,
        mediaSessionRef: inbound.mediaSessionRef,
        action: decision.action,
        destination,
        leg: "caller",
        legType: "caller",
        leg_type: "caller",
        callerLegAnswered: true,
        caller_leg_answered: true,
        mediaEstablished: false,
        media_established: false,
        answeredBy: "bridge",
        currentStatus: "connecting",
        routingMode,
        callDirection,
        ...context
      }));
    }
  }

  cleanupTerminateRequestWatcher = startTerminateRequestWatcher({
    inbound,
    bridge,
    context,
    onTerminate: handleTerminateRequest
  });

  cleanupVoiceEndListener = addVoiceEndListener(voice, ({ type, error }) => {
    if (terminalEmitted) return;

    const endReason = type === VOICE_EVENT_ERROR
      ? "voice_stream_error"
      : operatorAnswered
        ? "caller_hangup"
        : "voice_stream_ended_before_operator_answer";

    emitTerminal({
      outcome: endReason,
      terminalSource: type === VOICE_EVENT_ERROR ? "voice_error" : "voice_end",
      terminal_source: type === VOICE_EVENT_ERROR ? "voice_error" : "voice_end",
      currentStatus: operatorAnswered ? "completed" : "failed",
      endedBy: type === VOICE_EVENT_ERROR ? "system" : "caller",
      hangupInitiator: type === VOICE_EVENT_ERROR ? "system" : "caller",
      endReason,
      error,
      operatorLegTerminalReceived: false,
      operator_leg_terminal_received: false
    });
  });

  cleanupDialDataListener = addVoiceDataListener(voice, (result) => {
    const status = extractDialStatus(result);
    if (status === undefined || status === null || status === "") return;
    void handleOperatorDialStatus(status, "voice_data");
  });

  startDialStatusTimeout();

  const dialMediaSessionRef =
    inbound.mediaSessionRef || voice?.request?.mediaSessionRef || "";
  const dialCallerId = outboundTargetMode
    ? resolveDialCallerId({ inbound, decision, context })
    : "";
  const rawDialWritten = dialMediaSessionRef
    ? writeDialRequest(voice, {
        mediaSessionRef: dialMediaSessionRef,
        destination,
        ...(dialCallerId ? { callerId: dialCallerId } : {}),
        timeout: decision.timeout
      })
    : false;

  if (rawDialWritten) {
    logger.info("operator dial request written directly", {
      callRef: inbound.callRef,
      mediaSessionRef: inbound.mediaSessionRef,
      destination,
      callerId: dialCallerId || null,
      answerBeforeDial,
      statusSource: "voice_data"
    });

    await terminalPromise;
    return;
  }

  const stream = await voice.dial(destination, {
    timeout: decision.timeout
  });

  stream.on((status) => {
    void handleOperatorDialStatus(status, "dial_stream");
  });

  await terminalPromise;
}

async function handleAppRoute({ inbound, decision, voice, bridge, context }) {
  const destination = resolveAppTarget(decision);
  const routingMode =
    normalizeRoutingMode(decision.routingMode || decision.routing_mode) ||
    normalizeRoutingMode(decision.action) ||
    "app";
  const targetActor = actorForRoutingMode(routingMode) || "app";
  const targetAnsweredEvent =
    routingMode === "ai"
      ? "ai_answered"
      : routingMode === "operator"
        ? "operator_answered"
        : "app_answered";
  const targetRingingEvent =
    routingMode === "ai"
      ? "ai_ringing"
      : routingMode === "operator"
        ? "operator_ringing"
        : "app_ringing";
  const topology =
    decision.topology ||
    decision.callTopology ||
    decision.call_topology ||
    (routingMode === "ai" ? "transition_debug_child_handoff" : `${routingMode}_app_handoff`);
  const selectedAppRef =
    decision.selectedAppRef ||
    decision.selected_app_ref ||
    decision.appRef ||
    decision.app_ref ||
    "";
  const selectedEndpoint =
    decision.selectedEndpoint ||
    decision.selected_endpoint ||
    decision.endpoint ||
    "";

  if (!destination) {
    throw new Error("app decision did not include an executable appRef");
  }

  await voice.answer();

  await emitBridgeEvent(bridge, withLifecycle({
    eventType: "answered",
    callRef: inbound.callRef,
    mediaSessionRef: inbound.mediaSessionRef,
      action: decision.action,
      appRef: decision.appRef,
      destination,
      leg: "caller",
      legType: "caller",
      leg_type: "caller",
      callerLegAnswered: true,
      caller_leg_answered: true,
      routingMode,
      topology,
      selectedAppRef,
      selected_app_ref: selectedAppRef,
      endpoint: selectedEndpoint,
      callDirection: "inbound",
    currentStatus: "connecting",
    answeredBy: "bridge",
    mediaEstablished: false,
    media_established: false,
    ...context
  }));

  if (decision.transferMessage) {
    await voice.say(decision.transferMessage);
  }

  let appLegAnswered = false;
  let terminalEmitted = false;
  let lastRawStatus = "";
  let lastNormalizedStatus = "";
  let lastDialStatusKey = "";
  let lastMediaAccounting = {};
  let appDialStarted = false;
  let appDialStreamAttached = false;
  let entryVoiceEndObserved = false;
  let entryVoiceEndType = "";
  let handoffStatusTimeoutTimer = null;
  let handoffTerminalTimeoutTimer = null;
  let cleanupVoiceEndListener = () => {};
  let cleanupDialDataListener = () => {};
  let cleanupTerminateRequestWatcher = () => {};
  let terminalResolved;
  const terminalPromise = new Promise((resolve) => {
    terminalResolved = resolve;
  });

  function clearHandoffStatusTimeout() {
    if (!handoffStatusTimeoutTimer) return;
    clearTimeout(handoffStatusTimeoutTimer);
    handoffStatusTimeoutTimer = null;
  }

  function startHandoffStatusTimeout() {
    const timeoutMs = Math.max(0, config.appHandoffStatusTimeoutMs);
    if (!timeoutMs || handoffStatusTimeoutTimer) return;

    handoffStatusTimeoutTimer = setTimeout(() => {
      handoffStatusTimeoutTimer = null;

      if (terminalEmitted) return;
      if (appLegAnswered || inbound.streamRef) {
        logger.info("app handoff status timeout ignored for active app leg", {
          callRef: inbound.callRef,
          mediaSessionRef: inbound.mediaSessionRef,
          appRef: decision.appRef,
          destination,
          routingMode,
          timeoutMs,
          appLegAnswered,
          appDialStreamAttached,
          streamRef: inbound.streamRef,
          entryVoiceEndObserved,
          entryVoiceEndType,
          lastRawStatus,
          lastNormalizedStatus
        });
        return;
      }

      const endReason = "app_handoff_status_timeout";

      logger.warn("app handoff status timeout elapsed", {
        callRef: inbound.callRef,
        mediaSessionRef: inbound.mediaSessionRef,
        appRef: decision.appRef,
        selectedAppRef,
        topology,
        destination,
        routingMode,
        timeoutMs,
        appLegAnswered,
        appDialStreamAttached,
        entryVoiceEndObserved,
        entryVoiceEndType,
        lastRawStatus,
        lastNormalizedStatus
      });

      emitTerminal({
        outcome: endReason,
        terminalSource: "app_handoff_timeout",
        terminal_source: "app_handoff_timeout",
        currentStatus: "failed",
        endedBy: "system",
        hangupInitiator: "timeout",
        hangup_initiator: "timeout",
        endReason,
        appLegTerminalReceived: false,
        entryVoiceEndObserved,
        entry_voice_end_observed: entryVoiceEndObserved,
        entryVoiceEndType,
        entry_voice_end_type: entryVoiceEndType
      });

      if (typeof voice.hangup === "function") {
        void voice.hangup().catch((error) => {
          logger.warn("failed to hang up timed out app handoff", {
            callRef: inbound.callRef,
            mediaSessionRef: inbound.mediaSessionRef,
            appRef: decision.appRef,
            destination,
            routingMode,
            message: error?.message || String(error)
          });
        });
      }
    }, timeoutMs);
  }

  function clearHandoffTerminalTimeout() {
    if (!handoffTerminalTimeoutTimer) return;
    clearTimeout(handoffTerminalTimeoutTimer);
    handoffTerminalTimeoutTimer = null;
  }

  function startHandoffTerminalTimeout() {
    const timeoutMs = Math.max(0, config.appHandoffTerminalTimeoutMs);
    if (!timeoutMs || handoffTerminalTimeoutTimer) return;

    handoffTerminalTimeoutTimer = setTimeout(() => {
      handoffTerminalTimeoutTimer = null;

      if (terminalEmitted) return;

      const endReason = appLegAnswered
        ? "app_handoff_terminal_timeout_after_answer"
        : "app_handoff_terminal_timeout";

      logger.warn("app handoff terminal timeout elapsed", {
        callRef: inbound.callRef,
        mediaSessionRef: inbound.mediaSessionRef,
        streamRef: inbound.streamRef,
        appRef: decision.appRef,
        selectedAppRef,
        topology,
        destination,
        routingMode,
        timeoutMs,
        appLegAnswered,
        appDialStreamAttached,
        entryVoiceEndObserved,
        entryVoiceEndType,
        lastRawStatus,
        lastNormalizedStatus
      });

      emitTerminal({
        outcome: endReason,
        terminalSource: "app_handoff_terminal_timeout",
        terminal_source: "app_handoff_terminal_timeout",
        currentStatus: "failed",
        endedBy: "system",
        hangupInitiator: "timeout",
        hangup_initiator: "timeout",
        endReason,
        appLegTerminalReceived: false,
        terminalTimeoutMs: timeoutMs,
        terminal_timeout_ms: timeoutMs,
        entryVoiceEndObserved,
        entry_voice_end_observed: entryVoiceEndObserved,
        entryVoiceEndType,
        entry_voice_end_type: entryVoiceEndType
      });

      if (typeof voice.hangup === "function") {
        void voice.hangup().catch((error) => {
          logger.warn("failed to hang up terminal timed out app handoff", {
            callRef: inbound.callRef,
            mediaSessionRef: inbound.mediaSessionRef,
            appRef: decision.appRef,
            destination,
            routingMode,
            message: error?.message || String(error)
          });
        });
      }
    }, timeoutMs);
  }

  function emitTerminal(extra) {
    if (terminalEmitted) return;
    terminalEmitted = true;
    clearHandoffStatusTimeout();
    clearHandoffTerminalTimeout();
    cleanupVoiceEndListener();
    cleanupDialDataListener();
    cleanupTerminateRequestWatcher();
    const terminalEndReason = extra.endReason || extra.end_reason || extra.outcome;

    const terminalFields = {
      eventType: "session_completed",
      callRef: inbound.callRef,
      bridgeCallRef: inbound.bridgeCallRef,
      runtimeCallRef: inbound.runtimeCallRef,
      childCallRef: inbound.runtimeCallRef,
      mediaSessionRef: inbound.mediaSessionRef,
      streamRef: inbound.streamRef,
      action: decision.action,
      appRef: decision.appRef,
      destination,
      leg: routingMode,
      ...terminationMetadata({
        legType: routingMode,
        hangupInitiator:
          extra.hangupInitiator ||
          extra.hangup_initiator ||
          extra.endedBy ||
          extra.ended_by,
        endReason: terminalEndReason,
        answered: appLegAnswered,
        sipStatus: extra.sipStatus || extra.sip_status,
        q850Cause: extra.q850Cause || extra.q850_cause
      }),
      routingMode,
      callDirection: "inbound",
      lastRawStatus,
      last_raw_status: lastRawStatus,
      lastNormalizedStatus,
      last_normalized_status: lastNormalizedStatus,
      appLegAnswered,
      app_leg_answered: appLegAnswered,
      appDialStreamAttached,
      app_dial_stream_attached: appDialStreamAttached,
      entryVoiceEndObserved,
      entry_voice_end_observed: entryVoiceEndObserved,
      entryVoiceEndType,
      entry_voice_end_type: entryVoiceEndType,
      appLegTerminalReceived: Boolean(extra.appLegTerminalReceived),
      app_leg_terminal_received: Boolean(extra.appLegTerminalReceived),
      bridgeLegFinalized: true,
      bridge_leg_finalized: true,
      ...context,
      ...extra
    };

    const terminalCurrentStatus = String(
      terminalFields.currentStatus || terminalFields.current_status || ""
    ).toLowerCase();
    const terminalMediaEstablished = hasEstablishedAppMedia(terminalFields);
    const failedOrClosedBeforeMediaActive =
      ["failed", "rejected", "no_answer", "busy", "timeout"].includes(
        terminalCurrentStatus
      ) ||
      (!terminalMediaEstablished &&
        (terminalCurrentStatus === "cancelled" ||
          terminalFields.mediaEstablished === false ||
          terminalFields.media_established === false));

    if (failedOrClosedBeforeMediaActive) {
      void emitBridgeEvent(bridge, withLifecycle({
        eventType: "app_handoff_failed",
        callRef: inbound.callRef,
        bridgeCallRef: inbound.bridgeCallRef,
        runtimeCallRef: inbound.runtimeCallRef,
        mediaSessionRef: inbound.mediaSessionRef,
        streamRef: inbound.streamRef,
        action: decision.action,
        appRef: decision.appRef,
        destination,
        leg: routingMode,
        legType: routingMode,
        leg_type: routingMode,
        routingMode,
        callDirection: "inbound",
        currentStatus: terminalFields.currentStatus || "failed",
        endedBy: extra.endedBy || "system",
        endReason: terminalEndReason,
        terminalSource: extra.terminalSource || extra.terminal_source,
        terminal_source: extra.terminal_source || extra.terminalSource,
        appLegAnswered,
        app_leg_answered: appLegAnswered,
        ...extra,
        mediaEstablished: terminalFields.mediaEstablished,
        media_established: terminalFields.media_established,
        ...context
      }));
    }

    logger.info("app route terminal event", {
      callRef: inbound.callRef,
      mediaSessionRef: inbound.mediaSessionRef,
      appRef: decision.appRef,
      destination,
      routingMode,
      endReason: terminalFields.endReason || terminalFields.end_reason,
      terminalSource: terminalFields.terminalSource,
      outcome: terminalFields.outcome,
      lastRawStatus,
      lastNormalizedStatus,
      appLegAnswered
    });

    void emitBridgeEvent(bridge, withLifecycle(terminalFields)).finally(() => {
      scheduleRecordingReadyEvent({
        bridge,
        inbound,
        decision,
        routingMode,
        appRefs: [decision.appRef, inbound.appRef],
        context
      });
      terminalResolved();
    });
  }

  function emitVoiceEndTerminal({ type, error }) {
    if (type === VOICE_EVENT_ERROR) {
      emitTerminal({
        outcome: "voice_stream_error",
        terminalSource: "voice_error",
        terminal_source: "voice_error",
        currentStatus: "failed",
        endedBy: "system",
        hangupInitiator: "system",
        hangup_initiator: "system",
        endReason: "voice_stream_error",
        error,
        appLegTerminalReceived: false
      });
      return;
    }

    const mediaEstablished = hasEstablishedAppMedia(lastMediaAccounting);
    const endReason = appLegAnswered
      ? mediaEstablished
        ? "media_stream_closed_after_audio"
        : "voice_stream_ended_after_app_answer_without_terminal_status"
      : "voice_stream_ended_before_app_answer";

    emitTerminal({
      outcome: endReason,
      terminalSource: "voice_end",
      terminal_source: "voice_end",
      currentStatus: appLegAnswered && mediaEstablished ? "cancelled" : "failed",
      endedBy: "caller",
      hangupInitiator: "caller",
      hangup_initiator: "caller",
      endReason,
      appLegTerminalReceived: false,
      ...lastMediaAccounting,
      ...(appLegAnswered ? appMediaFields(true, lastMediaAccounting) : {})
    });
  }

  async function handleTerminateRequest(event) {
    if (terminalEmitted) return;

    const reason =
      event?.reason ||
      event?.endReason ||
      event?.end_reason ||
      `${routingMode}_terminated`;
    const endedBy =
      event?.endedBy ||
      event?.ended_by ||
      event?.actor ||
      "operator";

    logger.info("app route terminate requested", {
      callRef: inbound.callRef,
      mediaSessionRef: inbound.mediaSessionRef,
      appRef: decision.appRef,
      destination,
      routingMode,
      reason,
      endedBy,
      eventSeq: event?.seq || null
    });

    emitTerminal({
      outcome: reason,
      terminalSource: "operator_control",
      terminal_source: "operator_control",
      currentStatus: "cancelled",
      endedBy,
      hangupInitiator: endedBy,
      hangup_initiator: actorToHangupInitiator(endedBy),
      endReason: reason,
      appLegTerminalReceived: false,
      controlEventSeq: event?.seq || null,
      control_event_seq: event?.seq || null
    });

    if (typeof voice.hangup !== "function") return;

    try {
      await voice.hangup();
    } catch (error) {
      logger.warn("failed to hang up app route after terminate request", {
        callRef: inbound.callRef,
        mediaSessionRef: inbound.mediaSessionRef,
        appRef: decision.appRef,
        selectedAppRef,
        topology,
        destination,
        routingMode,
        reason,
        message: error?.message || String(error)
      });
    }
  }

  function handleAppDialStatus(status, statusSource, result = {}) {
    if (terminalEmitted) return;

    const rawStatus = String(status || "");
    if (!rawStatus) return;

    const observedRuntimeCallRef = extractDialRuntimeCallRef(result);
    if (observedRuntimeCallRef && !inbound.runtimeCallRef) {
      inbound.runtimeCallRef = observedRuntimeCallRef;
    }

    const observedStreamRef = extractDialStreamRef(result);
    if (observedStreamRef && !inbound.streamRef) {
      inbound.streamRef = observedStreamRef;
    }

    const observedCloseSource = extractDialCloseSource(result);
    const mediaAccounting = extractDialMediaAccounting(result);
    lastMediaAccounting = {
      ...lastMediaAccounting,
      ...mediaAccounting
    };
    const normalizedStatus = normalizeDialStatus(status);
    const dialStatusKey = `${rawStatus}:${normalizedStatus}`;
    if (dialStatusKey === lastDialStatusKey) return;
    lastDialStatusKey = dialStatusKey;

    const wasAppLegAnswered = appLegAnswered;
    lastRawStatus = rawStatus;
    lastNormalizedStatus = normalizedStatus;

    if (normalizedStatus === "answered") {
      appLegAnswered = true;
      clearHandoffStatusTimeout();
    }

    logger.info("app dial status update", {
      callRef: inbound.callRef,
      mediaSessionRef: inbound.mediaSessionRef,
      streamRef: inbound.streamRef,
      appRef: decision.appRef,
      selectedAppRef,
      topology,
      runtimeCallRef: inbound.runtimeCallRef,
      destination,
      routingMode,
      status: normalizedStatus,
      rawStatus: status,
      statusSource,
      closeSource: observedCloseSource,
      sawAudioIn: mediaAccounting.sawAudioIn,
      sawAudioOut: mediaAccounting.sawAudioOut,
      audioInBytesTotal: mediaAccounting.audioInBytesTotal,
      audioOutBytesTotal: mediaAccounting.audioOutBytesTotal,
      terminal: TERMINAL_DIAL_STATUSES.has(normalizedStatus),
      appLegAnswered
    });

    void emitBridgeEvent(bridge, withLifecycle({
      eventType: "dial_status",
      callRef: inbound.callRef,
      bridgeCallRef: inbound.bridgeCallRef,
      runtimeCallRef: inbound.runtimeCallRef,
      childCallRef: inbound.runtimeCallRef,
      mediaSessionRef: inbound.mediaSessionRef,
      streamRef: inbound.streamRef,
      action: decision.action,
      appRef: decision.appRef,
      selectedAppRef,
      selected_app_ref: selectedAppRef,
      endpoint: selectedEndpoint,
      topology,
      destination,
      status: normalizedStatus,
      rawStatus: status,
      raw_status: status,
      statusSource,
      status_source: statusSource,
      leg: routingMode,
      legType: routingMode,
      leg_type: routingMode,
      ...legAnsweredFields(routingMode, appLegAnswered),
      routingMode,
      callDirection: "inbound",
      currentStatus: currentStatusForDialStatus(normalizedStatus),
      ...(normalizedStatus === "answered"
        ? {
            answeredBy: targetActor,
            ...appMediaFields(true, mediaAccounting)
          }
        : {}),
      ...mediaAccounting,
      ...context
    }));

    if (normalizedStatus === "ringing") {
      void emitBridgeEvent(bridge, withLifecycle({
        eventType: targetRingingEvent,
        callRef: inbound.callRef,
        bridgeCallRef: inbound.bridgeCallRef,
        runtimeCallRef: inbound.runtimeCallRef,
        childCallRef: inbound.runtimeCallRef,
        mediaSessionRef: inbound.mediaSessionRef,
        streamRef: inbound.streamRef,
        action: decision.action,
        appRef: decision.appRef,
        selectedAppRef,
        selected_app_ref: selectedAppRef,
        endpoint: selectedEndpoint,
        topology,
        destination,
        leg: routingMode,
        legType: routingMode,
        leg_type: routingMode,
        ...legAnsweredFields(routingMode, appLegAnswered),
        routingMode,
        callDirection: "inbound",
        currentStatus: "connecting",
        ...context
      }));
    }

    if (normalizedStatus === "answered") {
      if (wasAppLegAnswered) return;

      const answeredFields = {
        callRef: inbound.callRef,
        bridgeCallRef: inbound.bridgeCallRef,
        runtimeCallRef: inbound.runtimeCallRef,
        childCallRef: inbound.runtimeCallRef,
        mediaSessionRef: inbound.mediaSessionRef,
        streamRef: inbound.streamRef,
        action: decision.action,
        appRef: decision.appRef,
        selectedAppRef,
        selected_app_ref: selectedAppRef,
        endpoint: selectedEndpoint,
        topology,
        destination,
        leg: routingMode,
        legType: routingMode,
        leg_type: routingMode,
        ...legAnsweredFields(routingMode, true),
        routingMode,
        callDirection: "inbound",
        currentStatus: "in_progress",
        answeredBy: targetActor,
        ...appMediaFields(true, mediaAccounting),
        ...context
      };

      void emitBridgeEvent(bridge, withLifecycle({
        eventType: targetAnsweredEvent,
        ...answeredFields
      }));

      void emitBridgeEvent(bridge, withLifecycle({
        eventType: "app_handoff_completed",
        ...answeredFields
      }));

      void emitBridgeEvent(bridge, withLifecycle({
        eventType: "answered",
        ...answeredFields
      }));
    }

    if (TERMINAL_DIAL_STATUSES.has(normalizedStatus)) {
      const outcome = appTerminalOutcomeForDialStatus(
        normalizedStatus,
        appLegAnswered,
        mediaAccounting
      );
      const currentStatus = currentStatusForAppDialStatus(
        normalizedStatus,
        appLegAnswered,
        mediaAccounting
      );
      const terminalMediaFields = appMediaFields(appLegAnswered, mediaAccounting);
      emitTerminal({
        outcome,
        rawStatus: status,
        raw_status: status,
        currentStatus,
        endedBy: endedByForAppDialStatus(
          normalizedStatus,
          targetActor,
          appLegAnswered
        ),
        hangupInitiator: hangupInitiatorForDialStatus(
          normalizedStatus,
          targetActor,
          appLegAnswered
        ),
        endReason: endReasonForAppDialStatus(
          normalizedStatus,
          routingMode,
          appLegAnswered,
          mediaAccounting
        ),
        terminalSource: observedCloseSource || "dial_status",
        terminal_source: observedCloseSource || "dial_status",
        appLegTerminalReceived: true,
        streamRef: inbound.streamRef,
        stream_ref: inbound.streamRef,
        ...terminalMediaFields,
        ...mediaAccounting
      });
    }
  }

  const detachedEndListeners = detachEntryVoiceEndClosers(voice);
  if (detachedEndListeners.detachedCount > 0) {
    logger.info("detached entry voice end closer during app handoff", {
      callRef: inbound.callRef,
      mediaSessionRef: inbound.mediaSessionRef,
      appRef: decision.appRef,
      selectedAppRef,
      topology,
      destination,
      routingMode,
      detachedCount: detachedEndListeners.detachedCount
    });
  }

  cleanupVoiceEndListener = addVoiceEndListener(voice, ({ type, error }) => {
    if (terminalEmitted) return;

    if (appDialStarted) {
      entryVoiceEndObserved = true;
      entryVoiceEndType = type;

      logger.info("entry voice stream closed during app handoff; terminalizing app lifecycle", {
        callRef: inbound.callRef,
        mediaSessionRef: inbound.mediaSessionRef,
        appRef: decision.appRef,
        selectedAppRef,
        topology,
        destination,
        routingMode,
        voiceEventType: type,
        error,
        appDialStreamAttached,
        lastRawStatus,
        lastNormalizedStatus
      });
      emitVoiceEndTerminal({ type, error });
      return;
    }

    emitVoiceEndTerminal({ type, error });
  });

  cleanupDialDataListener = addVoiceDataListener(voice, (result) => {
    const status = extractDialStatus(result);
    if (status === undefined || status === null || status === "") return;
    handleAppDialStatus(status, "voice_data", result);
  });

  cleanupTerminateRequestWatcher = startTerminateRequestWatcher({
    inbound,
    bridge,
    context,
    onTerminate: handleTerminateRequest
  });

  logger.info("dialing app route", {
    callRef: inbound.callRef,
    mediaSessionRef: inbound.mediaSessionRef,
    appRef: decision.appRef,
    selectedAppRef,
    endpoint: selectedEndpoint,
    topology,
    destination,
    routingMode
  });

  await emitBridgeEvent(bridge, withLifecycle({
    eventType: "app_handoff_started",
    callRef: inbound.callRef,
    bridgeCallRef: inbound.bridgeCallRef,
    runtimeCallRef: inbound.runtimeCallRef,
    mediaSessionRef: inbound.mediaSessionRef,
    action: decision.action,
    appRef: decision.appRef,
    selectedAppRef,
    selected_app_ref: selectedAppRef,
    endpoint: selectedEndpoint,
    topology,
    destination,
    leg: routingMode,
    legType: routingMode,
    leg_type: routingMode,
    routingMode,
    callDirection: "inbound",
    currentStatus: "connecting",
    ...context
  }));

  appDialStarted = true;
  startHandoffStatusTimeout();
  startHandoffTerminalTimeout();

  const dialMediaSessionRef =
    inbound.mediaSessionRef || voice?.request?.mediaSessionRef || "";
  const rawDialWritten = dialMediaSessionRef
    ? writeDialRequest(voice, {
        mediaSessionRef: dialMediaSessionRef,
        destination,
        timeout: decision.timeout,
        metadata: buildAppHandoffMetadata({
          inbound,
          decision,
          routingMode,
          context
        })
      })
    : false;

  if (rawDialWritten) {
    appDialStreamAttached = true;
    logger.info("app dial request written directly", {
      callRef: inbound.callRef,
      mediaSessionRef: inbound.mediaSessionRef,
      appRef: decision.appRef,
      selectedAppRef,
      topology,
      destination,
      routingMode,
      statusSource: "voice_data"
    });

    await terminalPromise;
    return;
  }

  logger.warn("direct app dial request unavailable; falling back to voice.dial", {
    callRef: inbound.callRef,
    mediaSessionRef: inbound.mediaSessionRef,
    appRef: decision.appRef,
    destination,
    routingMode
  });

  const dialPromise = voice
    .dial(destination, {
      timeout: decision.timeout
    })
    .then((stream) => ({ type: "stream", stream }))
    .catch((error) => ({ type: "dial_error", error }));

  const dialResult = await Promise.race([
    dialPromise,
    terminalPromise.then(() => ({ type: "terminal" }))
  ]);

  if (dialResult.type === "terminal") {
    return;
  }

  if (dialResult.type === "dial_error") {
    emitTerminal({
      outcome: "app_dial_failed",
      terminalSource: "dial_error",
      terminal_source: "dial_error",
      currentStatus: "failed",
      endedBy: "system",
      hangupInitiator: "system",
      hangup_initiator: "system",
      endReason: "app_dial_failed",
      error: dialResult.error?.message || String(dialResult.error || "app dial failed"),
      appLegTerminalReceived: false
    });
    await terminalPromise;
    return;
  }

  const stream = dialResult.stream;
  appDialStreamAttached = true;

  if (!stream || typeof stream.on !== "function") {
    emitTerminal({
      outcome: "app_dial_failed",
      terminalSource: "dial_error",
      terminal_source: "dial_error",
      currentStatus: "failed",
      endedBy: "system",
      hangupInitiator: "system",
      hangup_initiator: "system",
      endReason: "app_dial_failed",
      error: "voice.dial did not return a status stream",
      appLegTerminalReceived: false
    });
    await terminalPromise;
    return;
  }

  stream.on((status) => handleAppDialStatus(status, "dial_stream", status));

  await terminalPromise;
}

async function handleUnsupportedBridgeAction({ inbound, decision, voice, bridge, context }) {
  logger.warn("runtime received unsupported direct app handoff", {
    callRef: inbound.callRef,
    action: decision.action,
    appRef: decision.appRef
  });

  await emitBridgeEvent(bridge, withLifecycle({
    eventType: "unsupported_action",
    callRef: inbound.callRef,
    mediaSessionRef: inbound.mediaSessionRef,
    action: decision.action,
    appRef: decision.appRef,
    routingMode: normalizeRoutingMode(decision.action),
    callDirection: "inbound",
    currentStatus: "failed",
    endedBy: "system",
    endReason: "route_unavailable",
    ...context
  }));

  await sayAndHangup(
    voice,
    decision.message || config.unsupportedActionMessage
  );
}

async function handleIncomingCall(req, voice, deps = {}) {
  const bridge = deps.bridge || bridgeClient;
  const inbound = buildInbound(req);
  const runtimeContext = resolveRuntimeContext(req);
  let preRouteVoiceEnd = null;
  let cleanupPreRouteVoiceEndListener = () => {};

  function cleanupPreRouteVoiceEnd() {
    cleanupPreRouteVoiceEndListener();
    cleanupPreRouteVoiceEndListener = () => {};
  }

  cleanupPreRouteVoiceEndListener = addVoiceEndListener(voice, ({ type, error }) => {
    if (preRouteVoiceEnd) return;

    preRouteVoiceEnd = {
      type,
      error,
      endedAt: new Date().toISOString()
    };
  });

  logger.info("received inbound voice session", {
    callRef: inbound.callRef,
    ingressNumber: inbound.ingressNumber,
    callerNumber: inbound.callerNumber,
    appRef: inbound.appRef,
    requestId: runtimeContext.requestId || null,
    accountId: runtimeContext.accountId || null
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
      reason: decision.reason,
      appRef: decision.appRef || decision.app_ref || null,
      selectedAppRef: decision.selectedAppRef || decision.selected_app_ref || null,
      endpoint: decision.selectedEndpoint || decision.selected_endpoint || decision.endpoint || null,
      topology: decision.topology || null,
      operatorExecutionMode: decision.operatorExecutionMode || null,
      operatorFirstClassProductionPath:
        decision.operatorFirstClassProductionPath ?? null,
      operatorDirectBridgeDegraded: decision.operatorDirectBridgeDegraded ?? null,
      mediaOwnership: decision.mediaOwnership || null,
      recordingOwnership: decision.recordingOwnership || null,
      transcriptOwnership: decision.transcriptOwnership || null,
      operatorObservabilityKey: decision.operatorObservabilityKey || null,
      operatorSlaClass: decision.operatorSlaClass || null,
      recordingImportContract: decision.recordingImportContract || null,
      transcriptContract: decision.transcriptContract || null
    });

    const decisionContext = {
      ...runtimeContext,
      accountId: runtimeContext.accountId || decision.accountId || "",
      numberRef: decision.numberRef || "",
      inboxId: decision.inboxId || ""
    };

    await emitBridgeEvent(bridge, withLifecycle({
      eventType: "session_started",
      callRef: inbound.callRef,
      mediaSessionRef: inbound.mediaSessionRef,
      ingressNumber: inbound.ingressNumber,
      callerNumber: inbound.callerNumber,
      appRef: inbound.appRef,
      direction: inbound.direction,
      callDirection: normalizeCallDirection(inbound.direction) || "inbound",
      currentStatus: "ringing",
      metadata: inbound.metadata,
      ...decisionContext
    }));

    await emitBridgeEvent(bridge, withLifecycle({
      eventType: "decision_received",
      callRef: inbound.callRef,
      mediaSessionRef: inbound.mediaSessionRef,
      decision,
      action: decision.action,
      routingMode: decision.routingMode || decision.action,
      operatorAppRef: decision.operatorAppRef || "",
      operator_app_ref: decision.operatorAppRef || "",
      operatorFirstClassProductionPath: decision.operatorFirstClassProductionPath,
      operator_first_class_production_path: decision.operatorFirstClassProductionPath,
      operatorExecutionMode: decision.operatorExecutionMode || "",
      operator_execution_mode: decision.operatorExecutionMode || "",
      operatorDirectBridgeDegraded: decision.operatorDirectBridgeDegraded,
      operator_direct_bridge_degraded: decision.operatorDirectBridgeDegraded,
      mediaOwnership: decision.mediaOwnership || "",
      media_ownership: decision.mediaOwnership || "",
      recordingOwnership: decision.recordingOwnership || "",
      recording_ownership: decision.recordingOwnership || "",
      transcriptOwnership: decision.transcriptOwnership || "",
      transcript_ownership: decision.transcriptOwnership || "",
      operatorObservabilityKey: decision.operatorObservabilityKey || "",
      operator_observability_key: decision.operatorObservabilityKey || "",
      operatorSlaClass: decision.operatorSlaClass || "",
      operator_sla_class: decision.operatorSlaClass || "",
      recordingImportContract: decision.recordingImportContract || "",
      recording_import_contract: decision.recordingImportContract || "",
      transcriptContract: decision.transcriptContract || "",
      transcript_contract: decision.transcriptContract || "",
      callDirection:
        normalizeCallDirection(
          decision.callDirection ||
            decision.call_direction ||
            inbound.direction ||
            inbound.callDirection ||
            inbound.call_direction
        ) || "inbound",
      currentStatus: decision.action === "reject" ? "rejected" : "connecting",
      ...decisionContext
    }));

    if (preRouteVoiceEnd) {
      cleanupPreRouteVoiceEnd();

      const endReason = preRouteVoiceEnd.type === VOICE_EVENT_ERROR
        ? "voice_stream_error_before_route_decision"
        : "caller_hangup_before_route_decision";

      logger.warn("inbound voice session ended before route decision was applied", {
        callRef: inbound.callRef,
        mediaSessionRef: inbound.mediaSessionRef,
        action: decision.action,
        reason: decision.reason,
        endReason,
        endedAt: preRouteVoiceEnd.endedAt,
        error: preRouteVoiceEnd.error || null
      });

      await emitBridgeEvent(bridge, withLifecycle({
        eventType: "missed",
        callRef: inbound.callRef,
        mediaSessionRef: inbound.mediaSessionRef,
        ingressNumber: inbound.ingressNumber,
        callerNumber: inbound.callerNumber,
        appRef: inbound.appRef,
        action: decision.action,
        routingMode: decision.routingMode || decision.action,
        callDirection: "inbound",
        currentStatus: "missed",
        outcome: endReason,
        terminalSource: "voice_end_before_route_decision",
        terminal_source: "voice_end_before_route_decision",
        endedBy: preRouteVoiceEnd.type === VOICE_EVENT_ERROR ? "system" : "caller",
        endReason,
        error: preRouteVoiceEnd.error,
        ...decisionContext
      }));
      return;
    }

    cleanupPreRouteVoiceEnd();

    switch (decision.action) {
      case "operator":
      case "outbound_target":
        await handleOperatorRoute({
          inbound,
          decision,
          voice,
          bridge,
          context: decisionContext
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
            context: decisionContext
          });
          return;
        }

        if (resolveDialTarget(decision)) {
          await handleOperatorRoute({
            inbound,
            decision,
            voice,
            bridge,
            context: decisionContext
          });
          return;
        }

        await handleUnsupportedBridgeAction({
          inbound,
          decision,
          voice,
          bridge,
          context: decisionContext
        });
        return;
      case "reject":
      default:
        if (decision.answer === false) {
          await emitBridgeEvent(bridge, withLifecycle({
            eventType: "rejected",
            callRef: inbound.callRef,
            mediaSessionRef: inbound.mediaSessionRef,
            action: "reject",
            routingMode: "reject",
            callDirection: "inbound",
            currentStatus: "rejected",
            endedBy: "system",
            endReason: "rejected_by_policy",
            ...decisionContext
          }));

          await emitBridgeEvent(bridge, withLifecycle({
            eventType: "session_completed",
            callRef: inbound.callRef,
            mediaSessionRef: inbound.mediaSessionRef,
            outcome: "rejected_without_answer",
            action: "reject",
            routingMode: "reject",
            callDirection: "inbound",
            currentStatus: "rejected",
            endedBy: "system",
            endReason: "rejected_by_policy",
            ...decisionContext
          }));

          try {
            await hangupWithoutAnswer(voice);
          } catch (hangupError) {
            logger.error("failed to hang up rejected voice session", {
              callRef: inbound.callRef,
              message: hangupError.message
            });
          }
        } else {
          await sayAndHangup(
            voice,
            decision.message || config.defaultFailureMessage
          );

          await emitBridgeEvent(bridge, withLifecycle({
            eventType: "answered",
            callRef: inbound.callRef,
            mediaSessionRef: inbound.mediaSessionRef,
            action: "reject",
            routingMode: "reject",
            callDirection: "inbound",
            currentStatus: "rejected",
            endedBy: "system",
            endReason: "rejected_by_policy",
            answeredBy: "bridge",
            mediaEstablished: false,
            media_established: false,
            ...decisionContext
          }));

          await emitBridgeEvent(bridge, withLifecycle({
            eventType: "session_completed",
            callRef: inbound.callRef,
            mediaSessionRef: inbound.mediaSessionRef,
            outcome: "rejected",
            action: "reject",
            routingMode: "reject",
            callDirection: "inbound",
            currentStatus: "rejected",
            endedBy: "system",
            endReason: "rejected_by_policy",
            ...decisionContext
          }));
        }
        return;
    }
  } catch (error) {
    cleanupPreRouteVoiceEnd();

    logger.error("voice runtime failed", {
      callRef: inbound.callRef,
      message: error.message,
      stack: error.stack
    });

    await emitBridgeEvent(bridge, withLifecycle({
      eventType: "session_failed",
      callRef: inbound.callRef,
      mediaSessionRef: inbound.mediaSessionRef,
      error: error.message,
      callDirection: "inbound",
      currentStatus: "failed",
      endedBy: "system",
      endReason: "runtime_failed",
      ...runtimeContext
    }));

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
