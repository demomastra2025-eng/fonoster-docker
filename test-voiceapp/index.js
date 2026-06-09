const { createServer } = require("node:http");
const { randomUUID } = require("node:crypto");
const { URL } = require("node:url");
const voiceSdk = require("@fonoster/voice");
const VoiceServer = voiceSdk.VoiceServer || voiceSdk.default;
const { GatherSource } = voiceSdk;
const {
  StreamAudioFormat,
  StreamDirection,
  StreamMessageType
} = require("@fonoster/common");
const WebSocket = require("ws");
const {
  StartStream: InternalStartStream,
  StopStream: InternalStopStream,
  Stream: InternalVoiceStream
} = (() => {
  try {
    return require("@fonoster/voice/dist/verbs/Stream");
  } catch (_error) {
    return {};
  }
})();

const config = {
  grpcPort: parseInt(process.env.VOICE_AGENT_GRPC_PORT || process.env.VOICE_AGENT_PORT || "50061", 10),
  skipIdentity: parseBoolean(process.env.VOICE_AGENT_SKIP_IDENTITY, false),
  identityAddress: process.env.VOICE_AGENT_IDENTITY_ADDRESS || "cloud.vconsult.kz:443",
  apiPort: parseInt(process.env.VOICE_AGENT_API_PORT || "8081", 10),
  apiToken: (process.env.VOICE_AGENT_API_TOKEN || "").trim(),
  apiCorsOrigin: process.env.VOICE_AGENT_API_CORS_ORIGIN || "*",
  apiHeartbeatMs: parseInt(process.env.VOICE_AGENT_API_HEARTBEAT_MS || "15000", 10),
  apiEventBufferLimit: parseInt(process.env.VOICE_AGENT_API_EVENT_BUFFER_LIMIT || "300", 10),
  apiTranscriptLimit: parseInt(process.env.VOICE_AGENT_API_TRANSCRIPT_LIMIT || "300", 10),
  apiSessionTtlMs: parseInt(process.env.VOICE_AGENT_SESSION_TTL_MS || "3600000", 10),

  maxConversationTurns: parseInt(process.env.VOICE_AGENT_MAX_TURNS || "20", 10),
  maxConversationHistory: parseInt(process.env.VOICE_AGENT_MAX_HISTORY_MESSAGES || "30", 10),
  maxNoInputRetries: parseInt(process.env.VOICE_AGENT_MAX_NO_INPUT_RETRIES || "2", 10),
  gatherTimeoutMs: parseInt(process.env.VOICE_AGENT_GATHER_TIMEOUT_MS || "10000", 10),
  gatherMaxDigits: parseInt(process.env.VOICE_AGENT_GATHER_MAX_DIGITS || "20", 10),
  gatherSource: parseGatherSource(process.env.VOICE_AGENT_GATHER_SOURCE),

  promptGreeting: process.env.VOICE_AGENT_GREETING_MESSAGE || "Hello, this is the Fonoster AI support line. How can I help you?",
  promptFallback: process.env.VOICE_AGENT_FALLBACK_MESSAGE || "I did not catch that. Could you say it one more time please?",
  promptNoInput: process.env.VOICE_AGENT_NO_INPUT_MESSAGE || "I did not hear anything. If you want to continue, please speak up now.",
  promptGoodbye: process.env.VOICE_AGENT_GOODBYE_MESSAGE || "Thank you for calling. Goodbye.",
  promptSystem:
    process.env.VOICE_AGENT_SYSTEM_PROMPT ||
    "You are a virtual call center assistant. Keep responses short and clear for voice output. Ask only one question at a time and always remain polite.",

  llmProvider: (process.env.VOICE_AGENT_LLM_PROVIDER || "openai-compatible").toLowerCase(),
  llmDeployment: process.env.VOICE_AGENT_LLM_DEPLOYMENT || "",
  llmApiVersion: process.env.VOICE_AGENT_LLM_API_VERSION || process.env.AZURE_OPENAI_API_VERSION || "2024-02-15-preview",
  llmModel: process.env.VOICE_AGENT_LLM_MODEL || "gpt-4o-mini",
  llmApiUrl: (process.env.VOICE_AGENT_LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
  llmApiKey: process.env.VOICE_AGENT_LLM_API_KEY || "",
  llmTimeoutMs: parseInt(process.env.VOICE_AGENT_LLM_TIMEOUT_MS || "120000", 10),
  llmMaxTokens: parseInt(process.env.VOICE_AGENT_LLM_MAX_TOKENS || "700", 10),
  llmTemperature: parseFloat(process.env.VOICE_AGENT_LLM_TEMPERATURE || "0.2"),
  llmTopP: parseFloat(process.env.VOICE_AGENT_LLM_TOP_P || "1"),
  llmRetryCount: parseInt(process.env.VOICE_AGENT_LLM_RETRY_COUNT || "2", 10),
  llmRetryDelayMs: parseInt(process.env.VOICE_AGENT_LLM_RETRY_DELAY_MS || "300", 10),
  llmOpenRouterReferer: process.env.VOICE_AGENT_HTTP_REFERER || process.env.VOICE_AGENT_OPENROUTER_REFERER || "",
  llmOpenRouterTitle: process.env.VOICE_AGENT_OPENROUTER_TITLE || "Fonoster Voice Agent",
  llmHeaders: safeJson(process.env.VOICE_AGENT_LLM_HEADERS, null),
  llmCustomBody: safeJson(process.env.VOICE_AGENT_LLM_CUSTOM_BODY, null),
  llmUseStreaming: parseBoolean(process.env.VOICE_AGENT_LLM_STREAMING, false),

  voiceMode: (process.env.VOICE_AGENT_VOICE_MODE || "").trim().toLowerCase(),
  realtimeProvider: (process.env.VOICE_AGENT_REALTIME_PROVIDER || "").trim().toLowerCase(),
  realtimeApiKey:
    process.env.VOICE_AGENT_REALTIME_API_KEY ||
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.VOICE_AGENT_LLM_API_KEY ||
    "",
  realtimeBaseUrl: (process.env.VOICE_AGENT_REALTIME_BASE_URL || "").replace(/\/$/, ""),
  realtimeModel: process.env.VOICE_AGENT_REALTIME_MODEL || "",
  realtimeVoice: process.env.VOICE_AGENT_REALTIME_VOICE || "",
  realtimeLanguage: process.env.VOICE_AGENT_REALTIME_LANGUAGE || process.env.VOICE_AGENT_LANGUAGE || "",
  realtimeInputRate: parseInt(process.env.VOICE_AGENT_REALTIME_INPUT_RATE || "16000", 10),
  realtimeOutputRate: parseInt(process.env.VOICE_AGENT_REALTIME_OUTPUT_RATE || "24000", 10),
  realtimeCallRate: parseInt(process.env.VOICE_AGENT_REALTIME_CALL_RATE || "8000", 10),
  realtimeMaxDurationMs: parseInt(process.env.VOICE_AGENT_REALTIME_MAX_DURATION_MS || "900000", 10),
  realtimeGreetingMode: (process.env.VOICE_AGENT_REALTIME_GREETING_MODE || "provider").trim().toLowerCase(),
  realtimeTurnDetection: (process.env.VOICE_AGENT_REALTIME_TURN_DETECTION || "semantic_vad").trim(),
  realtimeInterruptions: parseBoolean(process.env.VOICE_AGENT_REALTIME_INTERRUPTS, true),
  realtimeStartupBeeps: parseBoolean(process.env.VOICE_AGENT_REALTIME_STARTUP_BEEPS, false),
  realtimeOutputMaxBufferedMs: parseInt(process.env.VOICE_AGENT_REALTIME_OUTPUT_MAX_BUFFERED_MS || "1500", 10),
  realtimeMaxOutputTokens: parseInt(process.env.VOICE_AGENT_REALTIME_MAX_OUTPUT_TOKENS || "120", 10),
  realtimeVadPrefixPaddingMs: parseInt(process.env.VOICE_AGENT_REALTIME_VAD_PREFIX_PADDING_MS || "120", 10),
  realtimeVadSilenceDurationMs: parseInt(process.env.VOICE_AGENT_REALTIME_VAD_SILENCE_DURATION_MS || "300", 10),
  realtimeVadStartSensitivity:
    process.env.VOICE_AGENT_REALTIME_VAD_START_SENSITIVITY ||
    "START_SENSITIVITY_HIGH",
  realtimeVadEndSensitivity:
    process.env.VOICE_AGENT_REALTIME_VAD_END_SENSITIVITY ||
    "END_SENSITIVITY_HIGH",
  realtimeTurnCoverage:
    process.env.VOICE_AGENT_REALTIME_TURN_COVERAGE ||
    "TURN_INCLUDES_ONLY_ACTIVITY",
  realtimeLogProviderEvents: parseBoolean(process.env.VOICE_AGENT_REALTIME_LOG_PROVIDER_EVENTS, false),

  transferSipAor: process.env.VOICE_AGENT_TRANSFER_AGENT_AOR || "",
  transferMessage: process.env.VOICE_AGENT_TRANSFER_MESSAGE || "",
  bridgeBaseUrl:
    (process.env.VOICE_AGENT_BRIDGE_BASE_URL ||
      process.env.VOICE_RUNTIME_BRIDGE_BASE_URL ||
      "").replace(/\/$/, ""),
  bridgeSharedSecret:
    process.env.VOICE_AGENT_BRIDGE_SHARED_SECRET ||
    process.env.VOICE_RUNTIME_BRIDGE_SHARED_SECRET ||
    process.env.TELEPHONY_BRIDGE_SHARED_SECRET ||
    "",
  bridgeEventPath:
    process.env.VOICE_AGENT_BRIDGE_EVENT_PATH ||
    "/internal/voice/inbound/event",
  onelinkAiEventsEnabled: parseBoolean(process.env.VOICE_AGENT_ONELINK_AI_EVENTS_ENABLED, true),
  onelinkAiBaseUrl:
    (process.env.VOICE_AGENT_ONELINK_AI_BASE_URL ||
      process.env.ONELINK_INTERNAL_BASE_URL ||
      process.env.ONELINK_BASE_URL ||
      "").replace(/\/$/, ""),
  onelinkAiSharedSecret:
    process.env.VOICE_AGENT_ONELINK_AI_SHARED_SECRET ||
    process.env.ONELINK_INTERNAL_SECRET ||
    "",
  onelinkAiContextPath:
    process.env.VOICE_AGENT_ONELINK_AI_CONTEXT_PATH ||
    "/internal/voice/ai/context",
  onelinkAiTranscriptPath:
    process.env.VOICE_AGENT_ONELINK_AI_TRANSCRIPT_PATH ||
    "/internal/voice/ai/transcript",
  onelinkAiToolsPath:
    process.env.VOICE_AGENT_ONELINK_AI_TOOLS_PATH ||
    "/internal/voice/ai/tools",
  onelinkAiTransferToolName:
    process.env.VOICE_AGENT_ONELINK_AI_TRANSFER_TOOL_NAME ||
    "transfer_to_operator",
  onelinkAiEndCallToolName:
    process.env.VOICE_AGENT_ONELINK_AI_END_CALL_TOOL_NAME ||
    "end_call",
  geminiTransferToolName:
    process.env.VOICE_AGENT_GEMINI_TRANSFER_TOOL_NAME ||
    "transfer_to_operator",
  geminiEndCallToolName:
    process.env.VOICE_AGENT_GEMINI_END_CALL_TOOL_NAME ||
    "end_call",
  onelinkAiEventPath:
    process.env.VOICE_AGENT_ONELINK_AI_EVENT_PATH ||
    "/internal/voice/ai/event",
  onelinkAiFinalizePath:
    process.env.VOICE_AGENT_ONELINK_AI_FINALIZE_PATH ||
    "/internal/voice/ai/finalize",
  onelinkAiTimeoutMs: parseInt(process.env.VOICE_AGENT_ONELINK_AI_TIMEOUT_MS || "2000", 10),
  onelinkAiRetryCount: parseInt(process.env.VOICE_AGENT_ONELINK_AI_RETRY_COUNT || "2", 10),
  onelinkAiRetryBackoffMs: parseInt(process.env.VOICE_AGENT_ONELINK_AI_RETRY_BACKOFF_MS || "500", 10),
  onelinkAiTranscriptMode:
    (process.env.VOICE_AGENT_ONELINK_AI_TRANSCRIPT_MODE || "event").trim().toLowerCase(),

  logEvents: parseBoolean(process.env.VOICE_AGENT_LOG_EVENTS, true),
  stopOnFiller: parseBoolean(process.env.VOICE_AGENT_STOP_ON_FALLBACK, false),
  fallbackMode: process.env.VOICE_AGENT_FALLBACK_MODE || "scripted"
};

const SUPPORTED_LLM_PROVIDERS = [
  "openai-compatible",
  "openai",
  "openai-realtime",
  "azure-openai",
  "gemini-live",
  "openrouter",
  "mock"
];

const LLM_PROVIDER_CAPABILITIES = {
  "openai-compatible": {
    label: "OpenAI-compatible",
    requiresKey: true,
    supportsStreaming: true,
    supportsTools: false,
    supportsFunctionCalling: true,
    supportsSpeechToSpeech: false,
    endpoints: ["chat/completions"]
  },
  openai: {
    label: "OpenAI",
    requiresKey: true,
    supportsStreaming: true,
    supportsTools: false,
    supportsFunctionCalling: true,
    supportsSpeechToSpeech: false,
    endpoints: ["chat/completions"]
  },
  "openai-realtime": {
    label: "OpenAI Realtime",
    requiresKey: true,
    supportsStreaming: true,
    supportsTools: true,
    supportsFunctionCalling: true,
    supportsSpeechToSpeech: true,
    endpoints: ["realtime websocket"]
  },
  "azure-openai": {
    label: "Azure OpenAI",
    requiresKey: true,
    supportsStreaming: true,
    supportsTools: false,
    supportsFunctionCalling: true,
    supportsSpeechToSpeech: false,
    endpoints: ["openai/deployments/{deployment}/chat/completions"]
  },
  openrouter: {
    label: "OpenRouter",
    requiresKey: true,
    supportsStreaming: true,
    supportsTools: false,
    supportsFunctionCalling: true,
    supportsSpeechToSpeech: false,
    endpoints: ["chat/completions"]
  },
  "gemini-live": {
    label: "Gemini Live",
    requiresKey: true,
    supportsStreaming: true,
    supportsTools: true,
    supportsFunctionCalling: true,
    supportsSpeechToSpeech: true,
    endpoints: ["BidiGenerateContent websocket"]
  },
  mock: {
    label: "Mock",
    requiresKey: false,
    supportsStreaming: false,
    supportsTools: false,
    supportsFunctionCalling: false,
    supportsSpeechToSpeech: false,
    endpoints: []
  }
};

function normalizeLlmProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  if (provider === "azure") {
    return "azure-openai";
  }
  if (provider === "gpt") {
    return "openai";
  }
  if (provider === "realtime" || provider === "openai-live") {
    return "openai-realtime";
  }
  if (provider === "gemini" || provider === "google-live") {
    return "gemini-live";
  }
  return provider;
}

function normalizeRealtimeProvider(value) {
  const provider = normalizeLlmProvider(value || config.realtimeProvider || config.llmProvider);
  if (provider === "openai") {
    return "openai-realtime";
  }
  if (provider === "gemini") {
    return "gemini-live";
  }
  return provider;
}

function isRealtimeVoiceMode() {
  const explicit = config.voiceMode;
  const provider = normalizeRealtimeProvider();

  return (
    explicit === "realtime" ||
    explicit === "speech-to-speech" ||
    provider === "openai-realtime" ||
    provider === "gemini-live"
  );
}

function getProviderCapabilities() {
  const provider = normalizeLlmProvider(config.llmProvider);
  const realtimeProvider = normalizeRealtimeProvider();
  const current = LLM_PROVIDER_CAPABILITIES[provider] || {};
  const realtime = LLM_PROVIDER_CAPABILITIES[realtimeProvider] || {};

  return {
    requested: config.llmProvider,
    resolved: provider,
    realtimeRequested: config.realtimeProvider || config.llmProvider,
    realtimeResolved: realtimeProvider,
    voiceMode: isRealtimeVoiceMode() ? "realtime" : "turn-by-turn",
    supported: SUPPORTED_LLM_PROVIDERS,
    provider: current,
    realtime,
    catalog: LLM_PROVIDER_CAPABILITIES,
    requiresKey: current.requiresKey ?? true,
    configured: Boolean(config.llmApiKey || config.llmApiUrl || config.realtimeApiKey),
    realtimeConfigured: Boolean(config.realtimeApiKey),
    remoteApi: config.llmApiUrl,
    realtimeBaseUrl: config.realtimeBaseUrl || null,
    realtimeModel: getRealtimeModel(realtimeProvider),
    realtimeVoice: getRealtimeVoice(realtimeProvider),
    deployment: config.llmDeployment || null,
    apiVersion: config.llmApiVersion || null,
    openrouterReferer: config.llmOpenRouterReferer || null,
    openrouterTitle: config.llmOpenRouterTitle || null
  };
}

function buildOpenAIHeaders(provider) {
  const normalized = normalizeLlmProvider(provider);
  if (normalized === "azure-openai") {
    return {
      "content-type": "application/json",
      accept: "application/json",
      ...(config.llmApiKey ? { "api-key": config.llmApiKey } : {})
    };
  }
  return {
    "content-type": "application/json",
    accept: "application/json",
    ...(config.llmApiKey ? { authorization: `Bearer ${config.llmApiKey}` } : {})
  };
}

function buildOpenAIEndpoint(provider) {
  const normalized = normalizeLlmProvider(provider);
  const normalizedApiUrl = config.llmApiUrl.replace(/\/$/, "");

  if (normalized === "azure-openai") {
    const deployment = encodeURIComponent(
      config.llmDeployment || config.llmModel || "default"
    );
    const basePath = normalizedApiUrl.includes("/openai/deployments/")
      ? `${normalizedApiUrl}/chat/completions`
      : `${normalizedApiUrl}/openai/deployments/${deployment}/chat/completions`;
    const separator = basePath.includes("?") ? "&" : "?";
    return `${basePath}${separator}api-version=${encodeURIComponent(config.llmApiVersion)}`;
  }

  if (normalized === "openrouter" || normalized === "openai" || normalized === "openai-compatible") {
    if (/\/chat\/completions$/i.test(normalizedApiUrl)) {
      return normalizedApiUrl;
    }

    return `${normalizedApiUrl}/chat/completions`;
  }

  return `${normalizedApiUrl}/chat/completions`;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null) {
    return fallback;
  }

  const normalized = String(value).trim().toLowerCase();
  if (normalized.length === 0) {
    return fallback;
  }

  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

function parseGatherSource(value) {
  const normalized = String(value || GatherSource.SPEECH).trim().toUpperCase();
  if (normalized === "DTMF") {
    return GatherSource.DTMF;
  }

  if (normalized === "SPEECH") {
    return GatherSource.SPEECH;
  }

  if (normalized === "SPEECH_AND_DTMF") {
    return GatherSource.SPEECH_AND_DTMF;
  }

  return GatherSource.SPEECH_AND_DTMF;
}

function trimText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

function formatErrorPayload(error, fallback) {
  const raw = error instanceof Error ? error.message : String(error || fallback);
  return raw.replace(/[\\r\\n]+/g, " ").slice(0, 4000);
}

function safeJson(value, fallback = null) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function getCorsHeaders(reqOrigin) {
  if (!config.apiCorsOrigin) {
    return "*";
  }

  if (config.apiCorsOrigin === "*") {
    return "*";
  }

  if (!reqOrigin) {
    return config.apiCorsOrigin;
  }

  return reqOrigin === config.apiCorsOrigin ? config.apiCorsOrigin : "";
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendError(res, status, code, message) {
  sendJson(res, status, {
    error: code,
    message
  });
}

function ensureAuth(req, res) {
  if (!config.apiToken) {
    return true;
  }

  const header = req.headers.authorization || "";
  const token = trimText(header.replace(/^Bearer\\s+/i, ""));
  if (token === config.apiToken) {
    return true;
  }

  sendError(res, 401, "UNAUTHORIZED", "missing or invalid VOICE_AGENT_API_TOKEN");
  return false;
}

const sessions = new Map();
const terminalRefs = new Map();

function sessionRefTtlMs() {
  return Math.max(config.apiSessionTtlMs, 10 * 60 * 1000);
}

function normalizeSessionRef(value) {
  return trimText(value || "", "");
}

function addSessionRef(refs, value) {
  const ref = normalizeSessionRef(value);
  if (ref) {
    refs.add(ref);
  }
}

function collectRequestSessionRefs(request = {}) {
  const refs = new Set();
  addSessionRef(refs, request.id);
  addSessionRef(refs, request.callRef);
  addSessionRef(refs, request.call_ref);
  addSessionRef(refs, request.bridgeCallRef);
  addSessionRef(refs, request.bridge_call_ref);
  addSessionRef(refs, request.parentCallRef);
  addSessionRef(refs, request.parent_call_ref);
  addSessionRef(refs, request.runtimeCallRef);
  addSessionRef(refs, request.runtime_call_ref);
  addSessionRef(refs, request.childCallRef);
  addSessionRef(refs, request.child_call_ref);
  addSessionRef(refs, request.mediaSessionRef);
  addSessionRef(refs, request.media_session_ref);
  addSessionRef(refs, request.providerCallId);
  addSessionRef(refs, request.provider_call_id);
  return refs;
}

function collectSessionRefs(session) {
  const refs = new Set();
  if (!session) {
    return refs;
  }

  addSessionRef(refs, session.id);
  addSessionRef(refs, session.callRef);
  addSessionRef(refs, session.bridgeCallRef);
  addSessionRef(refs, session.parentCallRef);
  addSessionRef(refs, session.runtimeCallRef);
  addSessionRef(refs, session.childCallRef);
  addSessionRef(refs, session.mediaSessionRef);
  addSessionRef(refs, session.providerCallId);
  for (const alias of session.aliases || []) {
    addSessionRef(refs, alias);
  }
  return refs;
}

function pruneTerminalRefs() {
  const now = Date.now();
  for (const [ref, entry] of terminalRefs.entries()) {
    if (!entry || Number(entry.expiresAt || 0) <= now) {
      terminalRefs.delete(ref);
    }
  }
}

function getTerminalRef(ref) {
  const normalized = normalizeSessionRef(ref);
  if (!normalized) {
    return null;
  }

  const entry = terminalRefs.get(normalized);
  if (!entry) {
    return null;
  }

  if (Number(entry.expiresAt || 0) <= Date.now()) {
    terminalRefs.delete(normalized);
    return null;
  }

  return entry;
}

function findTerminalSessionRef(refs) {
  pruneTerminalRefs();
  for (const ref of refs || []) {
    const entry = getTerminalRef(ref);
    if (entry) {
      return { ref, entry };
    }
  }
  return null;
}

function registerSessionAlias(session, ref) {
  const normalized = normalizeSessionRef(ref);
  if (!session || !normalized) {
    return;
  }

  session.aliases.add(normalized);
  sessions.set(normalized, session);
}

function registerSessionAliases(session, refs) {
  for (const ref of refs || []) {
    registerSessionAlias(session, ref);
  }
}

function recordTerminalSessionRefs(session, reason = "completed") {
  const endedAt = session?.endedAt || new Date().toISOString();
  const expiresAt = Date.now() + sessionRefTtlMs();
  for (const ref of collectSessionRefs(session)) {
    terminalRefs.set(ref, {
      ref,
      reason,
      sessionId: session?.id || null,
      callRef: session?.callRef || null,
      bridgeCallRef: session?.bridgeCallRef || null,
      runtimeCallRef: session?.runtimeCallRef || null,
      mediaSessionRef: session?.mediaSessionRef || null,
      endedAt,
      expiresAt
    });
  }
}

function sanitizeSessionSummary(session) {
  return {
    id: session.id,
    state: session.state,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    turns: session.turns,
    callRef: session.callRef,
    bridgeCallRef: session.bridgeCallRef,
    runtimeCallRef: session.runtimeCallRef,
    childCallRef: session.childCallRef,
    mediaSessionRef: session.mediaSessionRef,
    callerNumber: session.callerNumber,
    ingressNumber: session.ingressNumber,
    realtime: session.realtime || null,
    finalStatus: session.finalStatus || "",
    finalReason: session.finalReason || "",
    events: session.events.length,
    transcriptCount: session.transcript.length
  };
}

function createSession(request) {
  const callRef = trimText(request.callRef || request.call_ref || "");
  const bridgeCallRef = trimText(
    request.bridgeCallRef ||
      request.bridge_call_ref ||
      request.parentCallRef ||
      request.parent_call_ref ||
      callRef ||
      "",
    ""
  );
  const runtimeCallRef = trimText(
    request.runtimeCallRef ||
      request.runtime_call_ref ||
      request.childCallRef ||
      request.child_call_ref ||
      "",
    ""
  );
  const childCallRef = trimText(request.childCallRef || request.child_call_ref || runtimeCallRef || "");
  const parentCallRef = trimText(request.parentCallRef || request.parent_call_ref || bridgeCallRef || "");
  const mediaSessionRef = trimText(request.mediaSessionRef || request.media_session_ref || "");
  const id = (mediaSessionRef || runtimeCallRef || callRef || bridgeCallRef || randomUUID()).toString();
  const now = new Date().toISOString();
  const session = {
    id,
    state: "initializing",
    callRef,
    bridgeCallRef,
    parentCallRef,
    runtimeCallRef,
    childCallRef,
    mediaSessionRef,
    providerCallId: bridgeCallRef || callRef || runtimeCallRef || mediaSessionRef,
    aiSessionId: trimText(request.aiSessionId || request.ai_session_id || randomUUID()),
    callId: trimText(request.callId || request.call_id || ""),
    conversationId: trimText(request.conversationId || request.conversation_id || ""),
    callerNumber: trimText(request.callerNumber || ""),
    ingressNumber: trimText(request.ingressNumber || ""),
    appRef: trimText(request.appRef || ""),
    selfEndpoint: trimText(request.selfEndpoint || ""),
    receivedAt: now,
    createdAt: now,
    updatedAt: now,
    turns: 0,
    noInputCount: 0,
    history: [{ role: "system", content: config.promptSystem }],
    events: [],
    transcript: [],
    listeners: new Set(),
    waiters: new Set(),
    nextSeq: 0,
    nextContractSeq: 0,
    lastPongAt: now,
    nextTimeout: null,
    endedAt: null,
    transferRequested: false,
    transferResult: null,
    endRequested: false,
    finalizeSent: false,
    finalStatus: "",
    finalReason: "",
    lastError: null,
    aiContext: null,
    operatorAgentAor: "",
    aliases: new Set()
  };

  registerSessionAliases(session, collectRequestSessionRefs({
    ...request,
    id,
    callRef,
    bridgeCallRef,
    parentCallRef,
    runtimeCallRef,
    childCallRef,
    mediaSessionRef,
    providerCallId: session.providerCallId
  }));
  emitSessionEvent(session, "session.created", {
    callRef: session.callRef,
    bridgeCallRef: session.bridgeCallRef,
    runtimeCallRef: session.runtimeCallRef,
    mediaSessionRef: session.mediaSessionRef,
    callerNumber: session.callerNumber,
    ingressNumber: session.ingressNumber
  });
  return session;
}

function getSession(id) {
  const ref = normalizeSessionRef(id);
  if (!ref || getTerminalRef(ref)) {
    return null;
  }

  const session = sessions.get(ref) || null;
  if (isTerminalSession(session)) {
    removeSessionAliases(session);
    return null;
  }

  return session;
}

function removeSessionAliases(session) {
  if (!session) {
    return;
  }

  for (const [id, storedSession] of Array.from(sessions.entries())) {
    if (storedSession === session) {
      sessions.delete(id);
    }
  }
}

function countActiveSessions() {
  const seen = new Set();
  pruneTerminalRefs();

  for (const session of sessions.values()) {
    if (!session || isTerminalSession(session) || seen.has(session.id)) {
      continue;
    }

    seen.add(session.id);
  }

  return seen.size;
}

function isTerminalSession(session) {
  return Boolean(
    !session ||
      session.state === "closed" ||
      session.state === "transferred" ||
      session.endedAt ||
      session.finalizeSent
  );
}

function touchSession(session) {
  if (!session) {
    return;
  }

  session.updatedAt = new Date().toISOString();
  if (session.nextTimeout) {
    clearTimeout(session.nextTimeout);
  }

  session.nextTimeout = setTimeout(() => {
    closeSession(session, "ttl-expired");
  }, config.apiSessionTtlMs);
}

function closeSession(session, reason = "completed") {
  if (!session || session.state === "closed") {
    recordTerminalSessionRefs(session, reason);
    removeSessionAliases(session);
    return;
  }

  session.state = "closed";
  session.endedAt = new Date().toISOString();
  recordTerminalSessionRefs(session, reason);
  if (session.nextTimeout) {
    clearTimeout(session.nextTimeout);
    session.nextTimeout = null;
  }

  const realtimeController = session.realtimeController;
  session.realtimeController = null;
  try {
    realtimeController?.close?.();
  } catch (_error) {
    // ignore realtime close errors
  }

  emitSessionEvent(session, "session.closed", { reason });
  if (session.nextTimeout) {
    clearTimeout(session.nextTimeout);
    session.nextTimeout = null;
  }
  for (const waiter of Array.from(session.waiters)) {
    session.waiters.delete(waiter);
    waiter([]);
  }

  for (const listener of Array.from(session.listeners)) {
    session.listeners.delete(listener);
    if (!listener.writableEnded) {
      try {
        listener.end();
      } catch (_error) {
        // ignore stream end errors
      }
    }
  }

  removeSessionAliases(session);
}

function canEmitTerminalSessionEvent(type) {
  const normalized = trimText(type, "");
  return Boolean(
    normalized === "session.closed" ||
      normalized === "call.completed" ||
      normalized === "onelink.ai.finalize.sent" ||
      normalized.endsWith(".ignored") ||
      normalized.endsWith(".dropped") ||
      normalized.endsWith(".failed")
  );
}

function emitSessionEvent(session, type, payload = {}) {
  if (!session) {
    return null;
  }

  const terminal = isTerminalSession(session);
  if (terminal && !canEmitTerminalSessionEvent(type)) {
    return null;
  }

  const event = {
    seq: session.nextSeq + 1,
    type,
    at: new Date().toISOString(),
    sessionId: session.id,
    data: payload
  };
  session.nextSeq = event.seq;
  session.events.push(event);

  if (session.events.length > config.apiEventBufferLimit) {
    const overflow = session.events.length - config.apiEventBufferLimit;
    if (overflow > 0) {
      session.events.splice(0, overflow);
    }
  }

  if (!terminal) {
    touchSession(session);
  }

  if (config.logEvents) {
    console.log(JSON.stringify(event));
  }

  for (const waiter of Array.from(session.waiters)) {
    session.waiters.delete(waiter);
    waiter(session.events.slice());
  }

  for (const listener of Array.from(session.listeners)) {
    if (listener.writableEnded) {
      session.listeners.delete(listener);
      continue;
    }

    try {
      listener.write(formatSseEvent(event));
    } catch (error) {
      try {
        listener.end();
      } catch (_err) {
        // ignore
      }
      session.listeners.delete(listener);
    }
  }

  return event;
}

function normalizeBridgeLifecycle(eventType, payload = {}) {
  if (payload.currentStatus || payload.current_status) return payload;

  switch (eventType) {
    case "transfer_started":
    case "transfer_ringing":
      return {
        currentStatus: "connecting",
        current_status: "connecting",
        terminal: false,
        ...payload
      };
    case "transfer_answered":
      return {
        currentStatus: "in_progress",
        current_status: "in_progress",
        terminal: false,
        answeredBy: payload.answeredBy || "operator_device",
        answered_by: payload.answered_by || "operator_device",
        ...payload
      };
    case "transfer_completed":
      return {
        currentStatus: "completed",
        current_status: "completed",
        terminal: false,
        endReason: payload.endReason || "normal",
        end_reason: payload.end_reason || "normal",
        ...payload
      };
    case "transfer_failed":
      return {
        currentStatus: "failed",
        current_status: "failed",
        terminal: false,
        endReason: payload.endReason || "provider_failed",
        end_reason: payload.end_reason || "provider_failed",
        ...payload
      };
    default:
      return payload;
  }
}

function emitBridgeLifecycleEvent(session, eventType, payload = {}) {
  if (!session || !config.bridgeBaseUrl || !config.bridgeSharedSecret) {
    return;
  }

  const eventId = createContractEventId(eventType);
  const eventSeq = nextContractSeq(session);
  const body = normalizeBridgeLifecycle(eventType, {
    eventId,
    event_id: eventId,
    eventSeq,
    event_seq: eventSeq,
    eventType,
    event_type: eventType,
    source: "test-voiceapp",
    providerCallId: getProviderCallId(session),
    provider_call_id: getProviderCallId(session),
    aiSessionId: session.aiSessionId,
    ai_session_id: session.aiSessionId,
    callId: session.callId || null,
    call_id: session.callId || null,
    conversationId: session.conversationId || null,
    conversation_id: session.conversationId || null,
    callRef: session.callRef,
    call_ref: session.callRef,
    bridgeCallRef: session.bridgeCallRef || session.callRef,
    bridge_call_ref: session.bridgeCallRef || session.callRef,
    parentCallRef: session.parentCallRef || session.bridgeCallRef || session.callRef,
    parent_call_ref: session.parentCallRef || session.bridgeCallRef || session.callRef,
    runtimeCallRef: session.runtimeCallRef || null,
    runtime_call_ref: session.runtimeCallRef || null,
    childCallRef: session.childCallRef || session.runtimeCallRef || null,
    child_call_ref: session.childCallRef || session.runtimeCallRef || null,
    mediaSessionRef: session.mediaSessionRef,
    media_session_ref: session.mediaSessionRef,
    appRef: session.appRef,
    app_ref: session.appRef,
    callerNumber: session.callerNumber,
    caller_number: session.callerNumber,
    ingressNumber: session.ingressNumber,
    ingress_number: session.ingressNumber,
    routingMode: "transfer",
    routing_mode: "transfer",
    callDirection: "inbound",
    call_direction: "inbound",
    leg: "operator",
    ts: new Date().toISOString(),
    ...payload
  });

  void fetch(`${config.bridgeBaseUrl}${config.bridgeEventPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bridge-secret": config.bridgeSharedSecret,
      "x-event-id": eventId,
      "x-idempotency-key": eventId,
      "x-event-attempt": "1"
    },
    body: JSON.stringify(body)
  }).catch((error) => {
    emitSessionEvent(session, "bridge.event.failed", {
      eventType,
      error: error?.message || "bridge event failed"
    });
  });
}

function collectSessionEvents(session, sinceSeq) {
  if (!session) {
    return [];
  }
  return session.events.filter((entry) => entry.seq > sinceSeq);
}

function waitForSessionEvents(session, sinceSeq, timeoutMs = 0) {
  return new Promise((resolve) => {
    const existing = collectSessionEvents(session, sinceSeq);
    if (existing.length > 0) {
      resolve(existing);
      return;
    }

    if (timeoutMs <= 0) {
      resolve([]);
      return;
    }

    let timeoutId;
    const waiter = (events = []) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      resolve(events);
    };

    session.waiters.add(waiter);

    timeoutId = setTimeout(() => {
      session.waiters.delete(waiter);
      resolve([]);
    }, timeoutMs);
  });
}

function formatSseEvent(event) {
  const chunk = JSON.stringify(event);
  return `id: ${event.seq}\\nid: ${event.type}\\nevent: ${event.type}\\ndata: ${chunk}\\n\\n`;
}

function startSessionHeartbeat(listener, intervalMs, session) {
  const heartbeat = setInterval(() => {
    if (listener.writableEnded) {
      clearInterval(heartbeat);
      if (session) {
        session.listeners.delete(listener);
      }
      return;
    }

    try {
      listener.write(`: heartbeat ${Date.now()}\\n\\n`);
      session.lastPongAt = new Date().toISOString();
    } catch (_error) {
      clearInterval(heartbeat);
      if (session) {
        session.listeners.delete(listener);
      }
    }
  }, Math.max(5000, intervalMs));

  return heartbeat;
}

function registerSseListener(session, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });
  res.write(`: connected ${new Date().toISOString()}\\n\\n`);

  session.listeners.add(res);
  const heartbeat = startSessionHeartbeat(res, config.apiHeartbeatMs, session);
  res.on("close", () => {
    clearInterval(heartbeat);
    session.listeners.delete(res);
  });
  return session;
}

async function parseJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();
  return raw ? safeJson(raw, {}) : {};
}

function pushTranscript(session, speaker, text, source = "voice") {
  if (isTerminalSession(session)) {
    emitSessionEvent(session, "transcript.ignored", {
      reason: "terminal_session",
      speaker,
      source,
      bytes: Buffer.byteLength(String(text || ""))
    });
    return null;
  }

  const line = {
    at: new Date().toISOString(),
    speaker,
    source,
    text
  };
  session.transcript.push(line);

  if (session.transcript.length > config.apiTranscriptLimit) {
    session.transcript.splice(0, session.transcript.length - config.apiTranscriptLimit);
  }

  emitSessionEvent(session, "transcript.appended", line);
  const payload = {
    speaker,
    text,
    is_final: true,
    provider: source,
    at: line.at
  };
  if (config.onelinkAiTranscriptMode === "event" || config.onelinkAiTranscriptMode === "both") {
    void emitOnelinkAiEvent(session, "transcript_delta", payload);
  }
  if (config.onelinkAiTranscriptMode === "transcript" || config.onelinkAiTranscriptMode === "both") {
    void emitOnelinkAiTranscript(session, payload);
  }
}

function createContractEventId(type = "event") {
  const prefix = trimText(type, "event")
    .replace(/[^a-z0-9_]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || "event";
  return `evt_${prefix}_${randomUUID()}`;
}

function nextContractSeq(session) {
  if (!session) {
    return 1;
  }

  session.nextContractSeq = Number(session.nextContractSeq || 0) + 1;
  return session.nextContractSeq;
}

function getProviderCallId(session) {
  return trimText(
    session?.providerCallId ||
      session?.bridgeCallRef ||
      session?.callRef ||
      session?.runtimeCallRef ||
      session?.mediaSessionRef ||
      session?.id ||
      "",
    ""
  );
}

function getTransferSipAor(session) {
  return trimText(
    session?.operatorAgentAor ||
      session?.aiContext?.operator_agent_aor ||
      session?.aiContext?.operatorAgentAor ||
      session?.aiContext?.operator_target ||
      session?.aiContext?.operatorTarget ||
      session?.aiContext?.operator?.agent_aor ||
      session?.aiContext?.operator?.agentAor ||
      config.transferSipAor,
    ""
  );
}

function hasOnelinkTool(session, names = []) {
  const allowed = new Set(names.map((name) => String(name || "").trim()).filter(Boolean));
  const tools = Array.isArray(session?.aiContext?.tools) ? session.aiContext.tools : [];
  return tools.some((tool) => {
    const name = typeof tool === "string"
      ? trimText(tool, "")
      : trimText(tool?.name || tool?.function?.name || "", "");
    return allowed.has(name);
  });
}

function isTransferToolEnabled(session) {
  return Boolean(
    getTransferSipAor(session) ||
      hasOnelinkTool(session, [
        "request_transfer",
        "transfer_to_operator",
        "transfer_to_live_agent",
        config.geminiTransferToolName,
        config.onelinkAiTransferToolName
      ])
  );
}

function isTransferToolName(name) {
  const normalized = trimText(name, "");
  return [
    "request_transfer",
    "transfer_to_operator",
    "transfer_to_live_agent",
    config.geminiTransferToolName,
    config.onelinkAiTransferToolName
  ].includes(normalized);
}

function isEndCallToolName(name) {
  const normalized = trimText(name, "");
  return [
    "end_call",
    config.geminiEndCallToolName,
    config.onelinkAiEndCallToolName
  ].includes(normalized);
}

function isOnelinkAiConfigured() {
  return Boolean(
    config.onelinkAiEventsEnabled &&
      config.onelinkAiBaseUrl &&
      config.onelinkAiSharedSecret
  );
}

function joinUrl(baseUrl, path) {
  const normalizedPath = String(path || "").startsWith("/")
    ? String(path || "")
    : `/${String(path || "")}`;
  return `${baseUrl}${normalizedPath}`;
}

function isTransientHttpStatus(status) {
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

async function readJsonResponse(response) {
  const raw = await response.text().catch(() => "");
  return raw ? safeJson(raw, {}) : {};
}

function buildOnelinkHeaders(body = {}, attempt = 1) {
  const eventId = trimText(body.event_id || body.eventId || "", "");
  const headers = {
    "content-type": "application/json",
    "x-request-id": randomUUID()
  };

  if (config.onelinkAiSharedSecret) {
    headers.authorization = `Bearer ${config.onelinkAiSharedSecret}`;
    headers["x-bridge-secret"] = config.onelinkAiSharedSecret;
  }

  if (eventId) {
    headers["x-event-id"] = eventId;
    headers["x-idempotency-key"] = trimText(body.idempotency_key || body.idempotencyKey || eventId);
    headers["x-event-attempt"] = String(attempt);
  }

  return headers;
}

async function postOnelinkAiJson(path, body = {}, options = {}) {
  if (!isOnelinkAiConfigured()) {
    return null;
  }

  const attempts = Math.max(1, Number(options.maxRetries ?? config.onelinkAiRetryCount) + 1);
  const timeoutMs = Math.max(250, Number(options.timeoutMs ?? config.onelinkAiTimeoutMs));
  const url = joinUrl(config.onelinkAiBaseUrl, path);
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const attemptBody = {
      ...body,
      attempt
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: buildOnelinkHeaders(body, attempt),
        body: JSON.stringify(attemptBody),
        signal: controller.signal
      });
      clearTimeout(timer);

      const payload = await readJsonResponse(response);
      if (response.ok) {
        return payload;
      }

      const message = `Onelink AI request failed: ${response.status} ${response.statusText}`;
      lastError = new Error(`${message} ${trimText(JSON.stringify(payload), "")}`);
      if (!isTransientHttpStatus(response.status) || attempt >= attempts) {
        lastError.nonRetryable = !isTransientHttpStatus(response.status);
        throw lastError;
      }
    } catch (error) {
      clearTimeout(timer);
      lastError = error;
      if (error?.nonRetryable || attempt >= attempts) {
        throw lastError;
      }
    }

    const backoff = Math.max(100, config.onelinkAiRetryBackoffMs * attempt);
    await sleep(backoff);
  }

  throw lastError || new Error("Onelink AI request failed");
}

function buildOnelinkSessionPayload(session) {
  return {
    call_id: session?.callId || null,
    provider_call_id: getProviderCallId(session) || null,
    call_ref: session?.callRef || null,
    bridge_call_ref: session?.bridgeCallRef || session?.callRef || null,
    parent_call_ref: session?.parentCallRef || session?.bridgeCallRef || session?.callRef || null,
    runtime_call_ref: session?.runtimeCallRef || null,
    child_call_ref: session?.childCallRef || session?.runtimeCallRef || null,
    media_session_ref: session?.mediaSessionRef || null,
    ai_session_id: session?.aiSessionId || null,
    conversation_id: session?.conversationId || null,
    from: session?.callerNumber || null,
    to: session?.ingressNumber || null,
    direction: "inbound",
    app_ref: session?.appRef || null,
    started_at: session?.createdAt || null
  };
}

function buildOnelinkContractEvent(session, eventType, payload = {}) {
  const occurredAt = new Date().toISOString();
  const eventId = trimText(payload.event_id || payload.eventId || "", "") || createContractEventId(eventType);
  const eventSeq = Number.isFinite(Number(payload.event_seq || payload.eventSeq))
    ? Number(payload.event_seq || payload.eventSeq)
    : nextContractSeq(session);

  return {
    event_id: eventId,
    eventId,
    event_seq: eventSeq,
    eventSeq,
    event_type: eventType,
    eventType,
    provider: "fonoster",
    provider_call_id: getProviderCallId(session) || null,
    providerCallId: getProviderCallId(session) || null,
    call_ref: session?.callRef || null,
    callRef: session?.callRef || null,
    bridge_call_ref: session?.bridgeCallRef || session?.callRef || null,
    bridgeCallRef: session?.bridgeCallRef || session?.callRef || null,
    parent_call_ref: session?.parentCallRef || session?.bridgeCallRef || session?.callRef || null,
    parentCallRef: session?.parentCallRef || session?.bridgeCallRef || session?.callRef || null,
    runtime_call_ref: session?.runtimeCallRef || null,
    runtimeCallRef: session?.runtimeCallRef || null,
    child_call_ref: session?.childCallRef || session?.runtimeCallRef || null,
    childCallRef: session?.childCallRef || session?.runtimeCallRef || null,
    media_session_ref: session?.mediaSessionRef || null,
    mediaSessionRef: session?.mediaSessionRef || null,
    ai_session_id: session?.aiSessionId || null,
    aiSessionId: session?.aiSessionId || null,
    call_id: session?.callId || payload.call_id || null,
    callId: session?.callId || payload.callId || null,
    conversation_id: session?.conversationId || payload.conversation_id || null,
    conversationId: session?.conversationId || payload.conversationId || null,
    from: session?.callerNumber || null,
    to: session?.ingressNumber || null,
    direction: "inbound",
    occurred_at: occurredAt,
    occurredAt,
    attempt: 1,
    payload
  };
}

async function emitOnelinkAiEvent(session, eventType, payload = {}) {
  if (!session || !isOnelinkAiConfigured()) {
    return null;
  }

  const normalizedType = trimText(eventType, "");
  const terminalAllowed = new Set(["call_ended", "error"]);
  if (isTerminalSession(session) && !terminalAllowed.has(normalizedType)) {
    emitSessionEvent(session, "onelink.ai.event.ignored", {
      eventType: normalizedType,
      reason: "terminal_session"
    });
    return null;
  }

  const event = buildOnelinkContractEvent(session, eventType, payload);
  try {
    await postOnelinkAiJson(config.onelinkAiEventPath, event);
    return event;
  } catch (error) {
    emitSessionEvent(session, "onelink.ai.event.failed", {
      eventType,
      eventId: event.event_id,
      error: formatErrorPayload(error, "failed to deliver Onelink AI event")
    });
    return null;
  }
}

async function emitOnelinkAiTranscript(session, payload = {}) {
  if (!session || !isOnelinkAiConfigured()) {
    return null;
  }

  const event = buildOnelinkContractEvent(session, "transcript_delta", payload);
  const body = {
    ...buildOnelinkSessionPayload(session),
    event_id: event.event_id,
    eventId: event.eventId,
    event_seq: event.event_seq,
    eventSeq: event.eventSeq,
    speaker: payload.speaker || "",
    text: payload.text || "",
    source: payload.provider || "voice",
    is_final: payload.is_final !== false,
    at: payload.at || event.occurred_at
  };

  try {
    await postOnelinkAiJson(config.onelinkAiTranscriptPath, body, { maxRetries: 0 });
    return body;
  } catch (error) {
    emitSessionEvent(session, "onelink.ai.transcript.failed", {
      eventId: event.event_id,
      error: formatErrorPayload(error, "failed to deliver Onelink AI transcript")
    });
    return null;
  }
}

function applyOnelinkAiContext(session, context) {
  if (!session || !context || typeof context !== "object") {
    return;
  }

  session.aiContext = context;
  session.callId = trimText(context.call_id || context.callId || session.callId || "");
  session.conversationId = trimText(
    context.conversation_id ||
      context.conversationId ||
      session.conversationId ||
      ""
  );
  session.operatorAgentAor = trimText(
    context.operator_agent_aor ||
      context.operatorAgentAor ||
      context.operator_target ||
      context.operatorTarget ||
      context.operator?.agent_aor ||
      context.operator?.agentAor ||
      session.operatorAgentAor ||
      ""
  );

  const systemPrompt = trimText(
    context.system_prompt ||
      context.systemPrompt ||
      context.prompt ||
      "",
    ""
  );
  if (systemPrompt) {
    session.history[0] = { role: "system", content: systemPrompt };
  }
}

async function fetchOnelinkAiContext(session) {
  if (!session || !isOnelinkAiConfigured()) {
    return null;
  }

  try {
    const context = await postOnelinkAiJson(
      config.onelinkAiContextPath,
      buildOnelinkSessionPayload(session),
      { maxRetries: 0, timeoutMs: Math.min(config.onelinkAiTimeoutMs, 1500) }
    );
    applyOnelinkAiContext(session, context);
    emitSessionEvent(session, "onelink.ai.context.loaded", {
      callId: session.callId || null,
      conversationId: session.conversationId || null,
      hasSystemPrompt: Boolean(trimText(context?.system_prompt || context?.systemPrompt || "")),
      hasOperatorTarget: Boolean(getTransferSipAor(session)),
      transferToolEnabled: isTransferToolEnabled(session)
    });
    return context;
  } catch (error) {
    const message = formatErrorPayload(error, "Onelink AI context failed");
    emitSessionEvent(session, "onelink.ai.context.failed", {
      error: message
    });
    void emitOnelinkAiEvent(session, "error", {
      scope: "onelink_context",
      error_code: "context_unavailable",
      error_message: message,
      retryable: false
    });
    return null;
  }
}

async function callOnelinkAiTool(session, name, args = {}) {
  if (!session || !isOnelinkAiConfigured()) {
    return null;
  }

  const path = `${config.onelinkAiToolsPath.replace(/\/$/, "")}/${encodeURIComponent(name)}`;
  const event = buildOnelinkContractEvent(session, `tool_${name}`, {
    tool_name: name,
    args
  });
  const body = {
    ...buildOnelinkSessionPayload(session),
    event_id: event.event_id,
    eventId: event.eventId,
    event_seq: event.event_seq,
    eventSeq: event.eventSeq,
    tool_name: name,
    toolName: name,
    tool_call_id: args.tool_call_id || args.toolCallId || null,
    args
  };

  try {
    const result = await postOnelinkAiJson(path, body, { maxRetries: 0 });
    emitSessionEvent(session, "onelink.ai.tool.result", {
      name,
      action: result?.action || null,
      ok: result?.ok !== false
    });
    return result;
  } catch (error) {
    const message = formatErrorPayload(error, "Onelink AI tool failed");
    emitSessionEvent(session, "onelink.ai.tool.failed", {
      name,
      error: message
    });
    void emitOnelinkAiEvent(session, "error", {
      scope: "onelink_tool",
      error_code: "tool_unavailable",
      error_message: message,
      retryable: false
    });
    return {
      ok: false,
      action: "blocked",
      error: message
    };
  }
}

function getSessionAiNumber(session, camelName, snakeName, fallback) {
  const value =
    session?.aiContext?.[camelName] ??
    session?.aiContext?.[snakeName] ??
    fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function inferFinalStatus(session, reason = "") {
  if (session?.finalStatus) {
    return session.finalStatus;
  }

  const transferResult = session?.transferResult?.result || session?.transferResult?.status || "";
  if (session?.state === "transferred" || transferResult === "answered") {
    return "transferred";
  }

  if (session?.transferRequested && ["no_answer", "busy", "failed", "cancelled"].includes(transferResult)) {
    return "operator_unavailable";
  }

  if (session?.lastError) {
    return "failed";
  }

  if (reason === "caller_hung_up" || reason === "caller-hung-up") {
    return "caller_hung_up";
  }

  return "completed";
}

function buildTranscriptSummary(session) {
  const lines = Array.isArray(session?.transcript) ? session.transcript : [];
  return lines
    .slice(-8)
    .map((line) => `${line.speaker}: ${line.text}`)
    .join("\n")
    .slice(0, 2000);
}

async function finalizeOnelinkAiSession(session, reason = "call_completed") {
  if (!session || session.finalizeSent) {
    return null;
  }

  session.finalizeSent = true;
  const endedAt = session.endedAt || new Date().toISOString();
  const startedMs = Date.parse(session.createdAt || session.receivedAt || endedAt);
  const endedMs = Date.parse(endedAt);
  const status = inferFinalStatus(session, reason);
  session.finalStatus = status;
  session.finalReason = reason;

  const body = {
    ...buildOnelinkContractEvent(session, "finalize", {}),
    status,
    started_at: session.createdAt || null,
    ended_at: endedAt,
    duration_ms: Number.isFinite(startedMs) && Number.isFinite(endedMs)
      ? Math.max(0, endedMs - startedMs)
      : null,
    reason,
    final_transcript: Array.isArray(session.transcript) ? session.transcript : [],
    summary: buildTranscriptSummary(session),
    transfer_result: session.transferResult || null,
    recording_url: session.recordingUrl || null,
    error_code: session.lastError ? "voice_session_error" : null,
    error_message: session.lastError || null
  };

  try {
    const result = await postOnelinkAiJson(config.onelinkAiFinalizePath, body);
    emitSessionEvent(session, "onelink.ai.finalize.sent", {
      status,
      reason,
      alreadyFinalized: Boolean(result?.already_finalized || result?.alreadyFinalized)
    });
    return result;
  } catch (error) {
    session.finalizeSent = false;
    emitSessionEvent(session, "onelink.ai.finalize.failed", {
      status,
      reason,
      error: formatErrorPayload(error, "failed to finalize Onelink AI session")
    });
    return null;
  }
}

function addHistoryMessage(session, role, content) {
  if (!content) {
    return;
  }

  session.history.push({ role, content });
  if (session.history.length > config.maxConversationHistory) {
    const overflow = session.history.length - config.maxConversationHistory;
    session.history.splice(1, overflow); // keep system prompt
  }
}

function hasTransferIntent(text) {
  const normalized = trimText((text || "").toLowerCase());
  if (!normalized) {
    return false;
  }

  return (
    /\bоператор\b/.test(normalized) ||
    /\bhuman\b/.test(normalized) ||
    /\blive agent\b/.test(normalized) ||
    /\bagent\b/.test(normalized) ||
    /\brepresentative\b/.test(normalized) ||
    /\bsupport\b/.test(normalized)
  );
}

function hasHangupIntent(text) {
  const normalized = trimText((text || "").toLowerCase());
  if (!normalized) {
    return false;
  }

  return (
    /\b(до свидания|счастливо|пока|bye|good bye|goodbye|завершить|зайти|всё|стоп)\b/.test(normalized) ||
    normalized.includes("thank you") && normalized.includes("bye")
  );
}

function isScriptedFallbackAllowed() {
  return config.fallbackMode === "scripted" || config.fallbackMode === "both";
}

function fallbackResponse(input) {
  const normalized = trimText(input).toLowerCase();
  if (hasTransferIntent(normalized)) {
    return {
      text: config.transferMessage || "I will connect you to a human specialist.",
      transfer: Boolean(config.transferSipAor),
      continue: true
    };
  }

  if (hasHangupIntent(normalized)) {
    return {
      text: config.promptGoodbye,
      transfer: false,
      continue: false
    };
  }

  return {
    text: config.promptFallback,
    transfer: false,
    continue: true
  };
}

async function callOpenAICompatible(messages, session) {
  const provider = normalizeLlmProvider(config.llmProvider);
  const endpoint = buildOpenAIEndpoint(provider);
  const body = {
    model: config.llmModel,
    messages,
    temperature: Number.isFinite(config.llmTemperature) ? config.llmTemperature : 0.2,
    top_p: Number.isFinite(config.llmTopP) ? config.llmTopP : 1,
    max_tokens: Number.isFinite(config.llmMaxTokens) ? config.llmMaxTokens : 700,
    stream: config.llmUseStreaming
  };

  const headers = {
    ...buildOpenAIHeaders(provider),
    ...(typeof config.llmHeaders === "object" && config.llmHeaders !== null ? config.llmHeaders : {})
  };

  if (provider === "openrouter") {
    headers["HTTP-Referer"] = trimText(
      config.llmOpenRouterReferer,
      "https://fonoster.com"
    );
    headers["X-Title"] = trimText(config.llmOpenRouterTitle, "Fonoster Voice Agent");
    const openRouterHeaders = safeJson(process.env.VOICE_AGENT_OPENROUTER_HEADERS, null);
    if (openRouterHeaders && typeof openRouterHeaders === "object") {
      Object.assign(headers, openRouterHeaders);
    }
  }

  if (typeof config.llmCustomBody === "object" && config.llmCustomBody !== null) {
    Object.assign(body, config.llmCustomBody);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, config.llmTimeoutMs));
  let text = "";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!response.ok) {
      const responseText = await response.text().catch(() => "");
      throw new Error(`LLM request failed: ${response.status} ${response.statusText} ${trimText(responseText)}`);
    }

    if (!config.llmUseStreaming) {
      const payload = await response.json();
      const completion = (payload?.choices || [])[0];
      const rawText =
        completion?.message?.content || completion?.text || completion?.delta?.content || "";
      const content = trimText(String(rawText), config.promptFallback);
      return {
        text: content,
        model: completion?.model || config.llmModel,
        usage: payload.usage || {}
      };
    }

    if (!response.body) {
      throw new Error("LLM stream response has no body");
    }

    const decoder = new TextDecoder();
    let rawBuffer = "";
    for await (const chunk of response.body) {
      rawBuffer += decoder.decode(chunk, { stream: true });
      const lines = rawBuffer.split("\\n");
      rawBuffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = trimText(line);
        if (!trimmed) {
          continue;
        }
        if (trimmed === "[DONE]") {
          break;
        }
        if (!trimmed.startsWith("data:")) {
          continue;
        }

        const dataPart = trimText(trimmed.slice(5));
        if (!dataPart || dataPart === "[DONE]") {
          continue;
        }

        const packet = safeJson(dataPart, null);
        if (!packet) {
          continue;
        }
        const delta = packet.choices?.[0]?.delta?.content || "";
        if (delta) {
          text += String(delta);
          emitSessionEvent(session, "llm.token", { token: String(delta) });
        }
        if (packet.choices?.[0]?.finish_reason) {
          session.llmFinishReason = packet.choices[0].finish_reason;
        }
      }
      if (rawBuffer.includes("data: [DONE]")) {
        break;
      }
    }

    const normalizedText = trimText(text, config.promptFallback);
    if (!normalizedText) {
      throw new Error("LLM stream returned no content");
    }

    return {
      text: normalizedText
    };
  } finally {
    clearTimeout(timer);
  }
}

async function callLLM(messages, session) {
  const provider = normalizeLlmProvider(config.llmProvider || "openai-compatible");
  const preparedMessages = messages.map((message) => ({
    role: message.role || "user",
    content: trimText(message.content, "")
  })).filter((entry) => entry.content.length > 0);

  let attempts = 0;
  let lastError = "";
  while (attempts <= config.llmRetryCount) {
    attempts += 1;

    try {
      if (provider === "openai-compatible" || provider === "openai" || provider === "openrouter" || provider === "azure-openai") {
        const reply = await callOpenAICompatible(preparedMessages, session);
        return {
          text: trimText(reply.text, config.promptFallback),
          continue: true
        };
      }

      if (provider === "mock") {
        const lastUserMessage = preparedMessages.findLast
          ? preparedMessages.findLast((entry) => entry.role === "user")
          : preparedMessages.slice().reverse().find((entry) => entry.role === "user");
        return {
          text: `Mock response for: ${trimText(lastUserMessage?.content || "", "request").slice(0, 250)}`
        };
      }

      throw new Error(`unsupported llm provider: ${provider}`);
    } catch (error) {
      lastError = formatErrorPayload(error, "llm provider error");
      emitSessionEvent(session, "llm.error", { attempt: attempts, message: lastError });

      if (attempts > config.llmRetryCount) {
        break;
      }

      const delayMs = Math.max(100, config.llmRetryDelayMs * attempts);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  emitSessionEvent(session, "llm.failed", { error: lastError });
  if (!isScriptedFallbackAllowed()) {
    throw new Error(lastError || "llm provider failed");
  }

  return {
    ...fallbackResponse(),
    continue: true
  };
}

function getRealtimeModel(provider = normalizeRealtimeProvider(), session = null) {
  const explicit = trimText(
    session?.aiContext?.model ||
      session?.aiContext?.realtime_model ||
      session?.aiContext?.realtimeModel ||
      config.realtimeModel,
    ""
  );
  if (explicit) {
    return explicit;
  }

  if (provider === "gemini-live") {
    return "gemini-3.1-flash-live-preview";
  }

  return "gpt-realtime";
}

function getRealtimeVoice(provider = normalizeRealtimeProvider(), session = null) {
  const explicit = trimText(
    session?.aiContext?.voice ||
      session?.aiContext?.realtime_voice ||
      session?.aiContext?.realtimeVoice ||
      config.realtimeVoice,
    ""
  );
  if (explicit) {
    if (provider === "gemini-live") {
      return trimText(explicit.charAt(0).toUpperCase() + explicit.slice(1).toLowerCase(), "Charon");
    }

    return explicit;
  }

  if (provider === "gemini-live") {
    return "Sulafat";
  }

  return "marin";
}

function getRealtimeSystemInstruction(options = {}) {
  const session = options.session || null;
  const prompt = trimText(
    session?.aiContext?.system_prompt ||
      session?.aiContext?.systemPrompt ||
      session?.aiContext?.prompt ||
      config.promptSystem,
    config.promptSystem
  );
  const instructions = [prompt];

  if (options.includeToolInstructions && isTransferToolEnabled(session)) {
    instructions.push(
      `When the caller asks for a human, operator, representative, or live specialist, use the ${config.geminiTransferToolName} tool instead of only saying that you will transfer.`
    );
  }

  if (options.includeToolInstructions) {
    instructions.push(
      `When the caller clearly says goodbye or asks to end the call, use the ${config.geminiEndCallToolName} tool.`
    );
  }

  return instructions.filter(Boolean).join("\n");
}

function buildGeminiLiveTools(session = null) {
  const functionDeclarations = [];

  if (isTransferToolEnabled(session)) {
    functionDeclarations.push({
      name: config.geminiTransferToolName,
      description: "Request an Onelink-authorized transfer of the current phone call to a live specialist.",
      parameters: {
        type: "OBJECT",
        properties: {
          reason: {
            type: "STRING",
            description: "Short reason for the transfer."
          }
        }
      }
    });
  }

  functionDeclarations.push({
    name: config.geminiEndCallToolName,
    description: "End the current phone call after the caller is done.",
    parameters: {
      type: "OBJECT",
      properties: {
        reason: {
          type: "STRING",
          description: "Short reason for ending the call."
        }
      }
    }
  });

  return functionDeclarations.length > 0 ? [{ functionDeclarations }] : [];
}

function normalizeOpenAIRealtimeUrl() {
  const baseUrl = trimText(
    config.realtimeBaseUrl,
    "wss://api.openai.com/v1"
  )
    .replace(/^https:/i, "wss:")
    .replace(/^http:/i, "ws:")
    .replace(/\/$/, "");

  const path = /\/realtime$/i.test(baseUrl) ? baseUrl : `${baseUrl}/realtime`;
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}model=${encodeURIComponent(getRealtimeModel("openai-realtime"))}`;
}

function normalizeGeminiLiveUrl() {
  const baseUrl = trimText(
    config.realtimeBaseUrl,
    "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent"
  )
    .replace(/^https:/i, "wss:")
    .replace(/^http:/i, "ws:");

  if (!config.realtimeApiKey || /[?&]key=/.test(baseUrl)) {
    return baseUrl;
  }

  const separator = baseUrl.includes("?") ? "&" : "?";
  return `${baseUrl}${separator}key=${encodeURIComponent(config.realtimeApiKey)}`;
}

function clampPcm16(value) {
  if (value > 32767) {
    return 32767;
  }
  if (value < -32768) {
    return -32768;
  }
  return Math.round(value);
}

class Pcm16Resampler {
  constructor(inputRate, outputRate) {
    this.inputRate = Number(inputRate) || 16000;
    this.outputRate = Number(outputRate) || 16000;
    this.pending = Buffer.alloc(0);
    this.sourceOffset = 0;
  }

  convert(chunk) {
    const inputChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk || []);
    if (!inputChunk.length) {
      return Buffer.alloc(0);
    }

    if (this.inputRate === this.outputRate) {
      return inputChunk;
    }

    const input = this.pending.length
      ? Buffer.concat([this.pending, inputChunk])
      : inputChunk;
    const sampleCount = Math.floor(input.length / 2);
    if (sampleCount < 2) {
      this.pending = input;
      return Buffer.alloc(0);
    }

    const ratio = this.inputRate / this.outputRate;
    const out = [];
    let pos = this.sourceOffset;

    while (pos + 1 < sampleCount) {
      const index = Math.floor(pos);
      const fraction = pos - index;
      const left = input.readInt16LE(index * 2);
      const right = input.readInt16LE((index + 1) * 2);
      out.push(clampPcm16(left + (right - left) * fraction));
      pos += ratio;
    }

    const keepFrom = Math.max(0, Math.floor(pos) - 1);
    this.pending = input.subarray(keepFrom * 2);
    this.sourceOffset = pos - keepFrom;

    const buffer = Buffer.alloc(out.length * 2);
    for (let i = 0; i < out.length; i += 1) {
      buffer.writeInt16LE(out[i], i * 2);
    }
    return buffer;
  }
}

class Pcm16FramePacer {
  constructor({ sampleRate, frameMs, maxBufferedMs, onFrame, onDrop, onStats }) {
    this.sampleRate = Number(sampleRate) || 16000;
    this.frameMs = Number(frameMs) || 20;
    this.frameBytes = Math.max(2, Math.round((this.sampleRate * this.frameMs * 2) / 1000));
    if (this.frameBytes % 2 !== 0) {
      this.frameBytes += 1;
    }
    this.maxBufferedMs = Number(maxBufferedMs) || 45000;
    this.maxBufferedBytes = Math.round((this.sampleRate * 2 * this.maxBufferedMs) / 1000);
    this.onFrame = onFrame;
    this.onDrop = onDrop;
    this.onStats = onStats;
    this.buffer = Buffer.alloc(0);
    this.timer = null;
    this.closed = false;
    this.stats = {
      pushedBytes: 0,
      writtenBytes: 0,
      droppedBytes: 0,
      frames: 0,
      lastStatsAt: Date.now()
    };
  }

  push(chunk) {
    if (this.closed) {
      return;
    }

    const input = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk || []);
    if (!input.length) {
      return;
    }

    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, input]) : input;
    this.stats.pushedBytes += input.length;

    if (this.buffer.length > this.maxBufferedBytes) {
      const droppedBytes = this.buffer.length - this.maxBufferedBytes;
      const alignedDrop = droppedBytes % 2 === 0 ? droppedBytes : droppedBytes + 1;
      this.buffer = this.buffer.subarray(Math.min(alignedDrop, this.buffer.length));
      this.stats.droppedBytes += alignedDrop;
      this.onDrop?.(alignedDrop);
    }

    this.start();
  }

  start() {
    if (this.timer || this.closed) {
      return;
    }

    this.timer = setInterval(() => this.tick(), this.frameMs);
    this.timer.unref?.();
    this.tick();
  }

  tick() {
    if (this.closed) {
      return;
    }

    if (this.buffer.length < this.frameBytes) {
      return;
    }

    const frame = this.buffer.subarray(0, this.frameBytes);
    this.buffer = this.buffer.subarray(this.frameBytes);
    this.stats.writtenBytes += frame.length;
    this.stats.frames += 1;
    this.onFrame?.(frame);
    this.emitStatsIfDue();
  }

  emitStatsIfDue() {
    const now = Date.now();
    if (now - this.stats.lastStatsAt < 1000) {
      return;
    }

    this.onStats?.({
      bufferedBytes: this.buffer.length,
      bufferedMs: Math.round((this.buffer.length / (this.sampleRate * 2)) * 1000),
      pushedBytes: this.stats.pushedBytes,
      writtenBytes: this.stats.writtenBytes,
      droppedBytes: this.stats.droppedBytes,
      frames: this.stats.frames,
      maxBufferedMs: this.maxBufferedMs
    });

    this.stats = {
      pushedBytes: 0,
      writtenBytes: 0,
      droppedBytes: 0,
      frames: 0,
      lastStatsAt: now
    };
  }

  clear() {
    this.stats.droppedBytes += this.buffer.length;
    this.buffer = Buffer.alloc(0);
  }

  close() {
    this.closed = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.buffer = Buffer.alloc(0);
  }
}

class Pcm16LevelMeter {
  constructor({ session, eventName, sampleRate, intervalMs = 1000 }) {
    this.session = session;
    this.eventName = eventName;
    this.sampleRate = Number(sampleRate) || 8000;
    this.intervalMs = Number(intervalMs) || 1000;
    this.reset();
  }

  reset() {
    this.startedAt = Date.now();
    this.bytes = 0;
    this.samples = 0;
    this.squareSum = 0;
    this.peak = 0;
    this.zeroSamples = 0;
  }

  push(chunk) {
    const input = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk || []);
    const sampleCount = Math.floor(input.length / 2);
    if (!sampleCount) {
      return;
    }

    this.bytes += sampleCount * 2;

    for (let offset = 0; offset + 1 < input.length; offset += 2) {
      const sample = input.readInt16LE(offset);
      const abs = Math.abs(sample);
      this.squareSum += sample * sample;
      this.samples += 1;
      if (abs > this.peak) {
        this.peak = abs;
      }
      if (abs <= 1) {
        this.zeroSamples += 1;
      }
    }

    if (Date.now() - this.startedAt >= this.intervalMs) {
      this.emit();
      this.reset();
    }
  }

  emit() {
    if (!this.samples) {
      return;
    }

    const rms = Math.sqrt(this.squareSum / this.samples);
    const rmsDbfs = rms > 0 ? 20 * Math.log10(rms / 32768) : -Infinity;
    const peakDbfs = this.peak > 0 ? 20 * Math.log10(this.peak / 32768) : -Infinity;
    const zeroRatio = this.zeroSamples / this.samples;
    const verdict =
      rmsDbfs < -45
        ? "too_quiet"
        : peakDbfs > -1
          ? "clipping"
          : zeroRatio > 0.95
            ? "mostly_silence"
            : "ok";

    emitSessionEvent(this.session, this.eventName, {
      bytes: this.bytes,
      samples: this.samples,
      sampleRate: this.sampleRate,
      rmsDbfs: Number.isFinite(rmsDbfs) ? Number(rmsDbfs.toFixed(1)) : null,
      peakDbfs: Number.isFinite(peakDbfs) ? Number(peakDbfs.toFixed(1)) : null,
      zeroRatio: Number(zeroRatio.toFixed(3)),
      verdict
    });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createPcm16Tone({ sampleRate, frequency, durationMs, amplitude }) {
  const samples = Math.max(0, Math.round((sampleRate * durationMs) / 1000));
  const buffer = Buffer.alloc(samples * 2);

  for (let i = 0; i < samples; i += 1) {
    const sample = Math.round(amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate));
    buffer.writeInt16LE(sample, i * 2);
  }

  return buffer;
}

function createPcm16Silence({ sampleRate, durationMs }) {
  const samples = Math.max(0, Math.round((sampleRate * durationMs) / 1000));
  return Buffer.alloc(samples * 2);
}

async function playStartupBeeps(outputPacer, session) {
  const count = 2;
  const toneMs = 450;
  const gapMs = 250;
  const sampleRate = config.realtimeCallRate;
  const chunks = [];

  for (let index = 0; index < count; index += 1) {
    chunks.push(createPcm16Tone({
      sampleRate,
      frequency: 425,
      durationMs: toneMs,
      amplitude: 7000
    }));
    chunks.push(createPcm16Silence({
      sampleRate,
      durationMs: gapMs
    }));
  }

  emitSessionEvent(session, "voice.stream.startup_beeps", {
    count,
    toneMs,
    gapMs,
    frequency: 425,
    sampleRate
  });

  for (const chunk of chunks) {
    outputPacer.push(chunk);
  }

  await sleep((toneMs + gapMs) * count);
}

function emitProviderEvent(session, provider, event) {
  const type = trimText(
    event?.type ||
      (event?.setupComplete ? "setupComplete" : "") ||
      (event?.serverContent ? "serverContent" : "") ||
      (event?.toolCall ? "toolCall" : "") ||
      (event?.toolCallCancellation ? "toolCallCancellation" : "") ||
      (event?.goAway ? "goAway" : "") ||
      (event?.sessionResumptionUpdate ? "sessionResumptionUpdate" : "") ||
      (event?.usageMetadata ? "usageMetadata" : ""),
    ""
  );
  if (!type) {
    return;
  }

  if (config.realtimeLogProviderEvents) {
    emitSessionEvent(session, "realtime.provider.event", {
      provider,
      type
    });
  }
}

function createToolCallCancellationToken(id) {
  const controller = new AbortController();
  let cancelled = false;
  let cancelReason = "";
  let cancelTimestamp = null;
  const waiters = new Set();

  return {
    id,
    get cancelled() {
      return cancelled;
    },
    get signal() {
      return controller.signal;
    },
    get reason() {
      return cancelReason || "cancelled";
    },
    get cancelledAt() {
      return cancelTimestamp;
    },
    isCancelled() {
      return cancelled;
    },
    waitForCancellation() {
      if (cancelled) {
        return Promise.resolve(cancelReason || "cancelled");
      }

      return new Promise((resolve) => {
        waiters.add(resolve);
      });
    },
    cancel(reason) {
      if (cancelled) {
        return false;
      }

      cancelled = true;
      cancelTimestamp = new Date().toISOString();
      cancelReason = trimText(reason, "cancelled");
      controller.abort(cancelReason);
      for (const waiter of Array.from(waiters)) {
        waiter(cancelReason);
      }
      waiters.clear();
      return true;
    }
  };
}

function normalizeToolCallResponse(result) {
  if (!result || typeof result !== "object") {
    return {
      ok: Boolean(result),
      status: result ? "ok" : "failed",
      cancelled: false,
      error: result || null
    };
  }

  if (typeof result.cancelled === "undefined") {
    return {
      ...result,
      cancelled: false
    };
  }

  return result;
}

function createCancelledToolResult(name, id) {
  return {
    name,
    id,
    terminal: false,
    response: {
      ok: false,
      cancelled: true,
      status: "cancelled",
      error: "tool call cancelled"
    }
  };
}

function createOpenAIRealtimeController(session, onAudio) {
  let ws = null;
  let ready = false;
  let closed = false;
  const pending = [];
  const outputResampler = new Pcm16Resampler(
    config.realtimeOutputRate,
    config.realtimeCallRate
  );

  function send(event) {
    if (closed) {
      return;
    }

    if (!ready || !ws || ws.readyState !== WebSocket.OPEN) {
      pending.push(event);
      return;
    }

    ws.send(JSON.stringify(event));
  }

  function flush() {
    while (pending.length > 0 && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(pending.shift()));
    }
  }

  function handleMessage(message) {
    const event = safeJson(message.toString(), null);
    if (!event) {
      return;
    }

    emitProviderEvent(session, "openai-realtime", event);

    if (event.type === "error") {
      emitSessionEvent(session, "realtime.provider.error", {
        provider: "openai-realtime",
        error: event.error?.message || event.message || "provider error"
      });
      return;
    }

    const audioDelta =
      event.type === "response.output_audio.delta" ||
      event.type === "response.audio.delta"
        ? event.delta
        : "";
    if (audioDelta) {
      const converted = outputResampler.convert(Buffer.from(audioDelta, "base64"));
      if (converted.length) {
        onAudio(converted);
      }
      return;
    }

    const inputTranscript =
      event.type === "conversation.item.input_audio_transcription.completed"
        ? trimText(event.transcript, "")
        : "";
    if (inputTranscript) {
      pushTranscript(session, "caller", inputTranscript, "openai-realtime");
      addHistoryMessage(session, "user", inputTranscript);
      return;
    }

    const outputTranscript =
      event.type === "response.output_audio_transcript.done" ||
      event.type === "response.audio_transcript.done"
        ? trimText(event.transcript, "")
        : "";
    if (outputTranscript) {
      pushTranscript(session, "assistant", outputTranscript, "openai-realtime");
      addHistoryMessage(session, "assistant", outputTranscript);
    }
  }

  return {
    provider: "openai-realtime",
    connect() {
      if (!config.realtimeApiKey) {
        throw new Error("VOICE_AGENT_REALTIME_API_KEY or VOICE_AGENT_LLM_API_KEY is required for OpenAI Realtime");
      }

      return new Promise((resolve, reject) => {
        const url = normalizeOpenAIRealtimeUrl();
        const timeout = setTimeout(
          () => reject(new Error("OpenAI Realtime connection timeout")),
          15000
        );

        ws = new WebSocket(url, {
          headers: {
            Authorization: `Bearer ${config.realtimeApiKey}`
          }
        });

        ws.once("open", () => {
          clearTimeout(timeout);
          ready = true;
          send({
            type: "session.update",
            session: {
              type: "realtime",
              model: getRealtimeModel("openai-realtime"),
              instructions: getRealtimeSystemInstruction(),
              output_modalities: ["audio"],
              audio: {
                input: {
                  format: {
                    type: "audio/pcm",
                    rate: config.realtimeInputRate
                  },
                  turn_detection:
                    config.realtimeTurnDetection === "none"
                      ? null
                      : { type: config.realtimeTurnDetection }
                },
                output: {
                  format: {
                    type: "audio/pcm"
                  },
                  voice: getRealtimeVoice("openai-realtime")
                }
              }
            }
          });
          flush();
          emitSessionEvent(session, "realtime.connected", {
            provider: "openai-realtime",
            model: getRealtimeModel("openai-realtime")
          });
          resolve();
        });

        ws.on("message", handleMessage);
        ws.once("error", (error) => {
          clearTimeout(timeout);
          emitSessionEvent(session, "realtime.provider.error", {
            provider: "openai-realtime",
            error: formatErrorPayload(error, "OpenAI Realtime error")
          });
          reject(error);
        });
        ws.once("close", () => {
          closed = true;
          ready = false;
          if (session.state === "realtime") {
            session.state = "closed";
          }
          emitSessionEvent(session, "realtime.disconnected", {
            provider: "openai-realtime"
          });
        });
      });
    },
    sendAudio(buffer) {
      send({
        type: "input_audio_buffer.append",
        audio: Buffer.from(buffer).toString("base64")
      });
    },
    sendText(text) {
      send({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }]
        }
      });
      send({ type: "response.create" });
    },
    interrupt() {
      send({ type: "response.cancel" });
    },
    close() {
      closed = true;
      try {
        ws?.close();
      } catch (_error) {
        // ignore close errors
      }
    }
  };
}

async function executeRealtimeToolCall(session, actions, call, toolCallToken) {
  const name = trimText(call?.name, "");
  const id = trimText(call?.id, "");
  const args = call?.args && typeof call.args === "object" ? call.args : {};
  const toolContext = {
    callId: id,
    toolCallCancellationToken: toolCallToken
  };

  if (toolCallToken?.isCancelled?.()) {
    emitSessionEvent(session, "realtime.tool.skipped", {
      provider: "gemini-live",
      name,
      id,
      reason: toolCallToken.reason
    });
    return createCancelledToolResult(name, id);
  }

  emitSessionEvent(session, "realtime.tool.called", {
    provider: "gemini-live",
    name,
    id,
    args
  });

  if (isTransferToolName(name)) {
    if (!actions.transferToLiveAgent) {
      return {
        name,
        id,
        terminal: false,
        response: {
          ok: false,
          error: "transfer is not configured"
        }
      };
    }

    const transferResult = normalizeToolCallResponse(
      await actions.transferToLiveAgent(args, toolContext)
    );
    const transferred = Boolean(transferResult?.ok);

    if (toolCallToken?.isCancelled?.()) {
      return createCancelledToolResult(name, id);
    }

    if (transferResult.cancelled) {
      return {
        name,
        id,
        terminal: false,
        response: {
          ok: false,
          cancelled: true,
          status: transferResult.status || "cancelled",
          error: transferResult.error || "tool call cancelled"
        }
      };
    }

    return {
      name,
      id,
      terminal: transferred,
      response: {
        ok: transferred,
        status: transferResult.status || (transferred ? "transferred" : "failed"),
        cancelled: transferResult.cancelled,
        reason: trimText(transferResult.reason, ""),
        error: transferResult.error || null
      }
    };
  }

  if (isEndCallToolName(name)) {
    if (actions.endCall) {
      const endResult = normalizeToolCallResponse(await actions.endCall(args, toolContext));
      if (toolCallToken?.isCancelled?.()) {
        return createCancelledToolResult(name, id);
      }
      if (endResult.cancelled) {
        return {
          name,
          id,
          terminal: false,
          response: {
            ok: false,
            cancelled: true,
            status: endResult.status || "cancelled",
            error: endResult.error || "tool call cancelled"
          }
        };
      }
      return {
        name,
        id,
        terminal: true,
        response: {
          ok: Boolean(endResult?.ok !== false),
          status: endResult.status || "ending",
          reason: trimText(endResult.reason, "")
        }
      };
    } else {
      session.state = "closed";
      return {
        name,
        id,
        terminal: true,
        response: {
          ok: true,
          status: "ending"
        }
      };
    }
  }

  return {
    name,
    id,
    terminal: false,
    response: {
      ok: false,
      error: `unknown tool: ${name || "unnamed"}`
    }
  };
}

function createGeminiLiveController(session, onAudio, actions = {}) {
  let ws = null;
  let socketOpen = false;
  let setupComplete = false;
  let closed = false;
  const pending = [];
  const outputResampler = new Pcm16Resampler(
    config.realtimeOutputRate,
    config.realtimeCallRate
  );
  const activeToolCalls = new Map();

  function send(event) {
    if (closed) {
      return;
    }

    if (!socketOpen || !setupComplete || !ws || ws.readyState !== WebSocket.OPEN) {
      pending.push(event);
      return;
    }

    ws.send(JSON.stringify(event));
  }

  function sendSetup(event) {
    if (closed || !ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    ws.send(JSON.stringify(event));
  }

  function flush() {
    while (setupComplete && pending.length > 0 && ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(pending.shift()));
    }
  }

  function closeSocket() {
    try {
      send({
        realtimeInput: {
          audioStreamEnd: true
        }
      });
      closed = true;
      ws?.close();
    } catch (_error) {
      // ignore close errors
    }
  }

  function getToolCallToken(callId) {
    const id = trimText(callId, "");
    if (!id) {
      return null;
    }

    const existing = activeToolCalls.get(id);
    if (existing) {
      return existing;
    }

    const token = createToolCallCancellationToken(id);
    activeToolCalls.set(id, token);
    return token;
  }

  function clearToolCallToken(callId) {
    const id = trimText(callId, "");
    if (!id) {
      return;
    }

    activeToolCalls.delete(id);
  }

  function handleToolCallCancellation(toolCallCancellation) {
    const incomingIds = Array.isArray(toolCallCancellation?.ids)
      ? toolCallCancellation.ids
      : [];
    const cancelledIds = [];
    for (const rawId of incomingIds) {
      const id = trimText(rawId, "");
      if (!id) {
        continue;
      }
      const token = getToolCallToken(id);
      const changed = token.cancel(`toolCallCancellation: ${trimText(toolCallCancellation?.reason || "provider cancellation")}`);
      if (changed) {
        cancelledIds.push(id);
      }
    }

    if (cancelledIds.length > 0) {
      emitSessionEvent(session, "realtime.tool.cancelled", {
        provider: "gemini-live",
        ids: cancelledIds,
        reason: trimText(toolCallCancellation?.reason, "")
      });
    }
  }

  async function handleToolCall(toolCall) {
    const functionCalls = Array.isArray(toolCall?.functionCalls)
      ? toolCall.functionCalls
      : [];
    if (!functionCalls.length) {
      return;
    }

    const results = [];
    for (const call of functionCalls) {
      const callId = trimText(call?.id, "");
      const token = getToolCallToken(callId);
      try {
        results.push(await executeRealtimeToolCall(session, actions, call, token));
      } catch (error) {
        results.push({
          name: trimText(call?.name, ""),
          id: trimText(call?.id, ""),
          terminal: false,
          response: {
            ok: false,
            error: formatErrorPayload(error, "tool execution failed")
          }
        });
      } finally {
        clearToolCallToken(callId);
      }
    }

    send({
      toolResponse: {
        functionResponses: results.map((result) => ({
          name: result.name,
          id: result.id,
          response: result.response
        }))
      }
    });

    if (results.some((result) => result.terminal)) {
      closeSocket();
    }
  }

  function handleServerContent(serverContent) {
    const inputText = trimText(serverContent?.inputTranscription?.text, "");
    if (inputText) {
      pushTranscript(session, "caller", inputText, "gemini-live");
      addHistoryMessage(session, "user", inputText);
    }

    const outputText = trimText(serverContent?.outputTranscription?.text, "");
    if (outputText) {
      pushTranscript(session, "assistant", outputText, "gemini-live");
      addHistoryMessage(session, "assistant", outputText);
    }

    if (serverContent?.interrupted) {
      emitSessionEvent(session, "realtime.interrupted", {
        provider: "gemini-live"
      });
      actions.onInterrupt?.();
    }

    const parts = serverContent?.modelTurn?.parts || [];
    for (const part of parts) {
      const inlineData = part.inlineData || part.inline_data;
      const data = inlineData?.data;
      if (!data) {
        continue;
      }
      const mimeType = trimText(inlineData?.mimeType || inlineData?.mime_type || "");
      if (mimeType && mimeType !== "audio/pcm" && !mimeType.startsWith("audio/pcm;")) {
        emitSessionEvent(session, "realtime.provider.warning", {
          provider: "gemini-live",
          warning: "unexpected audio mime type",
          mimeType
        });
        continue;
      }
      const converted = outputResampler.convert(Buffer.from(data, "base64"));
      if (converted.length) {
        if (isTerminalSession(session)) {
          emitSessionEvent(session, "realtime.audio.out.ignored", {
            provider: "gemini-live",
            reason: "terminal_session",
            bytes: converted.length
          });
          continue;
        }

        emitSessionEvent(session, "realtime.audio.out", {
          provider: "gemini-live",
          bytes: converted.length,
          mimeType: mimeType || "audio/pcm"
        });
        onAudio(converted);
      }
    }
  }

  function handleMessage(message) {
    const event = safeJson(message.toString(), null);
    if (!event) {
      return;
    }

    emitProviderEvent(session, "gemini-live", event);

    if (event.setupComplete) {
      return;
    }

    if (event.serverContent) {
      handleServerContent(event.serverContent);
    }

    if (event.toolCall) {
      void handleToolCall(event.toolCall);
    }

    if (event.toolCallCancellation) {
      handleToolCallCancellation(event.toolCallCancellation);
    }

    if (event.goAway) {
      emitSessionEvent(session, "realtime.provider.goaway", {
        provider: "gemini-live"
      });
    }
  }

  return {
    provider: "gemini-live",
    connect() {
      if (!config.realtimeApiKey) {
        throw new Error("VOICE_AGENT_REALTIME_API_KEY, GEMINI_API_KEY, GOOGLE_API_KEY, or VOICE_AGENT_LLM_API_KEY is required for Gemini Live");
      }

      return new Promise((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(
          () => {
            if (!settled) {
              settled = true;
              reject(new Error("Gemini Live setup timeout"));
            }
          },
          15000
        );

        ws = new WebSocket(normalizeGeminiLiveUrl(), {
          headers: {
            "x-goog-api-key": config.realtimeApiKey
          }
        });

        ws.once("open", () => {
          socketOpen = true;
          const speechConfig = {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: getRealtimeVoice("gemini-live", session)
              }
            }
          };
          if (config.realtimeLanguage) {
            speechConfig.languageCode = config.realtimeLanguage;
          }

          const setup = {
            model: `models/${getRealtimeModel("gemini-live", session).replace(/^models\//, "")}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
              temperature: getSessionAiNumber(session, "temperature", "temperature", Number.isFinite(config.llmTemperature) ? config.llmTemperature : 0.2),
              topP: Number.isFinite(config.llmTopP) ? config.llmTopP : 1,
              maxOutputTokens: getSessionAiNumber(session, "maxOutputTokens", "max_output_tokens", config.realtimeMaxOutputTokens),
              speechConfig,
              thinkingConfig: {
                thinkingLevel: "minimal"
              }
            },
            systemInstruction: {
              parts: [{ text: getRealtimeSystemInstruction({ session, includeToolInstructions: true }) }]
            },
            realtimeInputConfig: {
              automaticActivityDetection: {
                disabled: false,
                startOfSpeechSensitivity: config.realtimeVadStartSensitivity,
                endOfSpeechSensitivity: config.realtimeVadEndSensitivity,
                prefixPaddingMs: config.realtimeVadPrefixPaddingMs,
                silenceDurationMs: config.realtimeVadSilenceDurationMs
              },
              activityHandling: config.realtimeInterruptions
                ? "START_OF_ACTIVITY_INTERRUPTS"
                : "NO_INTERRUPTION",
              turnCoverage: config.realtimeTurnCoverage
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {}
          };
          const tools = buildGeminiLiveTools(session);
          if (tools.length > 0) {
            setup.tools = tools;
          }

          sendSetup({
            setup
          });
        });

        ws.on("message", (message) => {
          const event = safeJson(message.toString(), null);
          if (event?.setupComplete && !setupComplete) {
            setupComplete = true;
            clearTimeout(timeout);
            flush();
            emitSessionEvent(session, "realtime.connected", {
              provider: "gemini-live",
              model: getRealtimeModel("gemini-live", session)
            });
            if (!settled) {
              settled = true;
              resolve();
            }
          }
          handleMessage(message);
        });
        ws.once("error", (error) => {
          clearTimeout(timeout);
          const message = formatErrorPayload(error, "Gemini Live error");
          session.lastError = message;
          emitSessionEvent(session, "realtime.provider.error", {
            provider: "gemini-live",
            error: message
          });
          void emitOnelinkAiEvent(session, "error", {
            scope: "gemini_live",
            error_code: "gemini_unavailable",
            error_message: message,
            retryable: false
          });
          if (!settled) {
            settled = true;
            reject(error);
          }
        });
        ws.once("close", (code, reason) => {
          clearTimeout(timeout);
          closed = true;
          socketOpen = false;
          setupComplete = false;
          if (session.state === "realtime") {
            session.state = "closed";
          }
          emitSessionEvent(session, "realtime.disconnected", {
            provider: "gemini-live",
            code,
            reason: trimText(reason?.toString?.() || "")
          });
          if (!settled) {
            const message = `Gemini Live connection closed before setup complete (${code})`;
            session.lastError = message;
            void emitOnelinkAiEvent(session, "error", {
              scope: "gemini_live",
              error_code: "gemini_setup_closed",
              error_message: message,
              retryable: false
            });
            settled = true;
            reject(new Error(message));
          }
        });
      });
    },
    sendAudio(buffer) {
      send({
        realtimeInput: {
          audio: {
            data: Buffer.from(buffer).toString("base64"),
            mimeType: `audio/pcm;rate=${config.realtimeInputRate}`
          }
        }
      });
    },
    sendText(text) {
      send({
        realtimeInput: {
          text
        }
      });
    },
    interrupt() {
      send({
        realtimeInput: {
          activityStart: {}
        }
      });
    },
    close() {
      closeSocket();
    }
  };
}

function createRealtimeController(session, onAudio, actions = {}) {
  const provider = normalizeRealtimeProvider();

  if (provider === "openai-realtime") {
    return createOpenAIRealtimeController(session, onAudio);
  }

  if (provider === "gemini-live") {
    return createGeminiLiveController(session, onAudio, actions);
  }

  throw new Error(`unsupported realtime provider: ${provider}`);
}

function waitForRealtimeSession(session, controller) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const interval = setInterval(() => {
      if (session.state === "closed" || session.state === "transferred") {
        clearInterval(interval);
        resolve();
        return;
      }

      if (Date.now() - startedAt > config.realtimeMaxDurationMs) {
        emitSessionEvent(session, "realtime.timeout", {
          maxDurationMs: config.realtimeMaxDurationMs
        });
        clearInterval(interval);
        resolve();
      }
    }, 1000);

    const previousClose = controller.close;
    controller.close = () => {
      previousClose.call(controller);
      clearInterval(interval);
      resolve();
    };
  });
}

async function startManagedVoiceStream(voice, options) {
  const mediaSessionRef = voice.request?.mediaSessionRef;
  const format = options?.format || StreamAudioFormat.WAV;

  if (
    InternalStartStream &&
    InternalStopStream &&
    InternalVoiceStream &&
    voice.request &&
    voice.voice
  ) {
    const stream = new InternalVoiceStream();
    const startStream = new InternalStartStream(voice.request, voice.voice);
    const stopStream = new InternalStopStream(voice.request, voice.voice);
    const { startStreamResponse } = await startStream.run({
      mediaSessionRef,
      ...options
    });
    const streamRef = trimText(startStreamResponse?.streamRef || "", "");

    stream.mediaSessionRef = mediaSessionRef;
    stream.streamRef = streamRef;
    stream.format = format;

    const onData = (result) => {
      if (
        result.streamPayload &&
        (!streamRef || !result.streamPayload.streamRef || result.streamPayload.streamRef === streamRef)
      ) {
        stream.emit("payloadOut", result.streamPayload);
      }
    };

    voice.voice.on("data", onData);

    stream.onPayloadIn((payload) => {
      voice.voice.write({
        streamPayload: {
          ...payload,
          mediaSessionRef: payload.mediaSessionRef || mediaSessionRef,
          streamRef: payload.streamRef || streamRef,
          format: payload.format || format
        }
      });
    });

    const originalClose = stream.close?.bind(stream);
    let stopped = false;
    stream.close = () => {
      if (stopped) {
        return;
      }
      stopped = true;
      voice.voice.removeListener("data", onData);
      if (streamRef) {
        stopStream
          .run({
            mediaSessionRef,
            streamRef
          })
          .catch((error) => {
            emitSessionEvent(getSession(mediaSessionRef), "voice.stream.stop.error", {
              error: formatErrorPayload(error, "stop stream failed")
            });
          });
      }
      if (originalClose) {
        originalClose();
      }
    };

    return stream;
  }

  return voice.stream(options);
}

async function runRealtimeVoiceConversation(voice, session) {
  const provider = normalizeRealtimeProvider();
  let streamRef = "";
  let controller = null;
  let voiceStream = null;
  let outputPacer = null;
  const inputLevelMeter = new Pcm16LevelMeter({
    session,
    eventName: "voice.stream.audio_in.level",
    sampleRate: config.realtimeInputRate
  });

  session.state = "realtime";
  session.realtime = {
    provider,
    model: getRealtimeModel(provider, session),
    voice: getRealtimeVoice(provider, session),
    startedAt: new Date().toISOString()
  };

  emitSessionEvent(session, "realtime.starting", session.realtime);

  if (config.realtimeGreetingMode === "tts" && config.promptGreeting) {
    await sayText(voice, session, config.promptGreeting, "agent.greeting");
  }

  voiceStream = await startManagedVoiceStream(voice, {
    direction: StreamDirection.BOTH,
    format: StreamAudioFormat.WAV
  });
  streamRef = trimText(voiceStream.streamRef || "", "");

  outputPacer = new Pcm16FramePacer({
    sampleRate: config.realtimeCallRate,
    frameMs: 20,
    maxBufferedMs: config.realtimeOutputMaxBufferedMs,
    onDrop: (bytes) => {
      emitSessionEvent(session, "voice.stream.audio_out.pacer_drop", {
        reason: "output_queue_overflow",
        bytes,
        encoding: "slin",
        sampleRate: config.realtimeCallRate
      });
    },
    onStats: (stats) => {
      emitSessionEvent(session, "voice.stream.audio_out.pacer_stats", {
        encoding: "slin",
        sampleRate: config.realtimeCallRate,
        frameMs: 20,
        ...stats
      });
    },
    onFrame: (audio) => {
      if (!streamRef) {
        emitSessionEvent(session, "voice.stream.audio_out.dropped", {
          reason: "missing_stream_ref",
          bytes: audio?.length || 0,
          encoding: "slin",
          frameMs: 20,
          sampleRate: config.realtimeCallRate
        });
        return;
      }

      voiceStream.write({
        mediaSessionRef: session.mediaSessionRef,
        streamRef,
        format: StreamAudioFormat.WAV,
        type: StreamMessageType.AUDIO_OUT,
        data: audio
      });
    }
  });

  emitSessionEvent(session, "voice.stream.audio_out.pacer_started", {
    encoding: "slin",
    sampleRate: config.realtimeCallRate,
    frameMs: 20,
    frameBytes: outputPacer.frameBytes,
    maxBufferedMs: config.realtimeOutputMaxBufferedMs
  });

  void emitOnelinkAiEvent(session, "stream_started", {
    stream_ref: streamRef,
    direction: "BOTH",
    input_rate: config.realtimeInputRate,
    output_rate: config.realtimeCallRate,
    gemini_model: provider === "gemini-live" ? getRealtimeModel(provider, session) : null
  });

  if (config.realtimeStartupBeeps) {
    await playStartupBeeps(outputPacer, session);
  }

  controller = createRealtimeController(session, (audio) => {
    if (isTerminalSession(session)) {
      emitSessionEvent(session, "voice.stream.audio_out.dropped", {
        reason: "terminal_session",
        bytes: audio?.length || 0,
        encoding: "slin",
        sampleRate: config.realtimeCallRate
      });
      return;
    }

    if (!streamRef) {
      emitSessionEvent(session, "voice.stream.audio_out.dropped", {
        reason: "missing_stream_ref",
        bytes: audio?.length || 0,
        encoding: "slin",
        sampleRate: config.realtimeCallRate
      });
    } else {
      outputPacer.push(audio);
    }
  }, {
    transferToLiveAgent: async (args, toolCallContext = {}) => {
      const result = await transferToLiveAgent(voice, session, {
        ...toolCallContext,
        args
      });
      const normalized = normalizeToolCallResponse(result);
      if (normalized?.ok && !normalized?.cancelled) {
        session.state = "transferred";
      }
      return normalized;
    },
    endCall: async (args, toolCallContext = {}) => {
      const normalized = normalizeToolCallResponse(await endCallAction(session, {
        ...toolCallContext,
        args
      }));
      if (normalized?.ok && !normalized?.cancelled) {
        session.state = "closed";
      }
      return normalized;
    },
    onInterrupt: () => {
      outputPacer?.clear?.();
      emitSessionEvent(session, "voice.stream.audio_out.pacer_cleared", {
        reason: "caller_interrupted",
        encoding: "slin",
        sampleRate: config.realtimeCallRate
      });
    }
  });

  session.realtimeController = controller;

  voiceStream.onPayload((payload) => {
    if (!payload || payload.type !== StreamMessageType.AUDIO_IN || !payload.data) {
      return;
    }

    streamRef = payload.streamRef || streamRef;
    session.realtime.streamRef = streamRef;
    const audio = Buffer.from(payload.data);
    inputLevelMeter.push(audio);
    controller.sendAudio(audio);
  });

  await controller.connect();

  if (config.realtimeGreetingMode === "provider" && config.promptGreeting) {
    controller.sendText(`Start the call by saying this greeting only: ${config.promptGreeting}`);
  }

  try {
    await waitForRealtimeSession(session, controller);
  } finally {
    try {
      controller?.close?.();
    } catch (_error) {
      // ignore close errors
    }
    try {
      outputPacer?.close?.();
    } catch (_error) {
      // ignore pacer close errors
    }
    try {
      voiceStream?.close?.();
    } catch (_error) {
      // ignore stream close errors
    }
  }
}

async function sayText(voice, session, text, eventType = "agent.speech") {
  const sanitized = trimText(text, config.promptFallback);
  emitSessionEvent(session, eventType, {
    length: sanitized.length,
    message: sanitized
  });

  try {
    await voice.say(sanitized);
  } catch (error) {
    emitSessionEvent(session, "voice.say.error", { error: formatErrorPayload(error, "voice.say failed") });
    throw error;
  }
}

async function transferToLiveAgent(voice, session, context = {}) {
  const token = context?.toolCallCancellationToken;
  if (token?.isCancelled?.()) {
    return {
      ok: false,
      cancelled: true,
      status: "cancelled",
      error: "tool call cancelled"
    };
  }

  const toolArgs = context?.args && typeof context.args === "object" ? context.args : {};
  const requestedReason = trimText(toolArgs.reason || context?.reason || "caller_requested_operator");
  let toolDecision = null;
  if (isOnelinkAiConfigured()) {
    toolDecision = await callOnelinkAiTool(session, config.onelinkAiTransferToolName, {
      reason: requestedReason,
      tool_call_id: context?.callId || null,
      gemini_tool_name: config.geminiTransferToolName
    });
    const action = trimText(toolDecision?.action || "", "").toLowerCase();
    const allowed = toolDecision?.ok !== false && (!action || action === "transfer" || action === "operator");
    if (!allowed) {
      emitSessionEvent(session, "agent.transfer.blocked", {
        reason: toolDecision?.reason || toolDecision?.error || "transfer not authorized"
      });
      return {
        ok: false,
        status: "blocked",
        error: toolDecision?.error || "transfer not authorized"
      };
    }
  }

  const transferTarget = trimText(
    toolDecision?.operator_agent_aor ||
      toolDecision?.operatorAgentAor ||
      toolDecision?.agent_aor ||
      toolDecision?.agentAor ||
      getTransferSipAor(session),
    ""
  );
  const dialTimeout = Math.max(1, Number(toolDecision?.timeout || toolDecision?.timeout_s || 30));
  const transferReason = trimText(toolDecision?.reason || requestedReason || "caller_requested_operator");

  if (!transferTarget) {
    session.transferResult = {
      requested: true,
      operator_agent_aor: "",
      result: "failed",
      error_code: "route_unavailable",
      error_message: "transfer target not configured"
    };
    emitSessionEvent(session, "agent.transfer.blocked", { reason: "transfer target not configured" });
    emitBridgeLifecycleEvent(session, "transfer_failed", {
      destination: "",
      endReason: "route_unavailable",
      end_reason: "route_unavailable",
      error: "transfer target not configured"
    });
    void emitOnelinkAiEvent(session, "transfer_result", session.transferResult);
    return {
      ok: false,
      status: "blocked",
      error: "transfer target not configured"
    };
  }

  const dialStartedAt = new Date().toISOString();
  emitSessionEvent(session, "agent.transfer.started", { aor: transferTarget });
  emitBridgeLifecycleEvent(session, "transfer_started", {
    destination: transferTarget,
    agent_aor: transferTarget
  });
  void emitOnelinkAiEvent(session, "transfer_requested", {
    requested_by: "ai_tool",
    reason: transferReason,
    operator_agent_aor: transferTarget
  });
  session.transferRequested = true;
  try {
    const transferPromises = [
      voice.dial(transferTarget, {
        timeout: dialTimeout,
        signal: token?.signal
      }).then(() => ({ ok: true }))
    ];
    if (typeof token?.waitForCancellation === "function") {
      transferPromises.push(
        token.waitForCancellation().then((reason) => ({
          ok: false,
          cancelled: true,
          status: "cancelled",
          error: reason
        }))
      );
    }

    const transferResult = await Promise.race(transferPromises);
    if (transferResult?.cancelled) {
      emitSessionEvent(session, "agent.transfer.cancelled", {
        aor: transferTarget,
        reason: transferResult.error || "tool call cancelled"
      });
      emitBridgeLifecycleEvent(session, "transfer_failed", {
        destination: transferTarget,
        agent_aor: transferTarget,
        endReason: "operator_cancelled",
        end_reason: "operator_cancelled",
        error: transferResult.error || "tool call cancelled"
      });
      session.transferResult = {
        requested: true,
        operator_agent_aor: transferTarget,
        result: "cancelled",
        dial_started_at: dialStartedAt,
        ended_at: new Date().toISOString(),
        duration_ms: Date.now() - Date.parse(dialStartedAt),
        error_code: "operator_cancelled",
        error_message: transferResult.error || "tool call cancelled"
      };
      void emitOnelinkAiEvent(session, "transfer_result", session.transferResult);
      return transferResult;
    }

    const answeredAt = new Date().toISOString();
    emitSessionEvent(session, "agent.transfer.completed", { aor: transferTarget });
    emitBridgeLifecycleEvent(session, "transfer_answered", {
      destination: transferTarget,
      agent_aor: transferTarget,
      answeredBy: "operator_device",
      answered_by: "operator_device"
    });
    emitBridgeLifecycleEvent(session, "transfer_completed", {
      destination: transferTarget,
      agent_aor: transferTarget
    });
    session.transferResult = {
      requested: true,
      operator_agent_aor: transferTarget,
      result: "answered",
      dial_started_at: dialStartedAt,
      answered_at: answeredAt,
      ended_at: null,
      duration_ms: Date.now() - Date.parse(dialStartedAt),
      bridge_id: null,
      error_code: null,
      error_message: null
    };
    void emitOnelinkAiEvent(session, "transfer_result", session.transferResult);
    return {
      ok: true,
      status: "transferred"
    };
  } catch (error) {
    if (token?.isCancelled?.()) {
      return {
        ok: false,
        cancelled: true,
        status: "cancelled",
        error: "tool call cancelled"
      };
    }

    emitSessionEvent(session, "agent.transfer.failed", {
      error: formatErrorPayload(error, "agent transfer failed")
    });
    emitBridgeLifecycleEvent(session, "transfer_failed", {
      destination: transferTarget,
      agent_aor: transferTarget,
      error: formatErrorPayload(error, "agent transfer failed")
    });
    session.transferResult = {
      requested: true,
      operator_agent_aor: transferTarget,
      result: "failed",
      dial_started_at: dialStartedAt,
      ended_at: new Date().toISOString(),
      duration_ms: Date.now() - Date.parse(dialStartedAt),
      error_code: "provider_failed",
      error_message: formatErrorPayload(error, "agent transfer failed")
    };
    void emitOnelinkAiEvent(session, "transfer_result", session.transferResult);
    return {
      ok: false,
      status: "failed",
      error: formatErrorPayload(error, "agent transfer failed")
    };
  }
}

async function endCallAction(session, context = {}) {
  const token = context?.toolCallCancellationToken;
  if (token?.isCancelled?.()) {
    emitSessionEvent(session, "agent.end_call.cancelled", {
      reason: token.reason || "tool call cancelled"
    });
    return {
      ok: false,
      cancelled: true,
      status: "cancelled",
      error: "tool call cancelled"
    };
  }

  const args = context?.args && typeof context.args === "object" ? context.args : {};
  if (isOnelinkAiConfigured()) {
    const decision = await callOnelinkAiTool(session, config.onelinkAiEndCallToolName, {
      ...args,
      tool_call_id: context?.callId || null,
      gemini_tool_name: config.geminiEndCallToolName
    });
    if (decision?.ok === false) {
      return {
        ok: false,
        status: "blocked",
        error: decision.error || "end_call not authorized"
      };
    }
  }

  session.endRequested = true;
  session.state = "closed";
  return {
    ok: true,
    status: "ending"
  };
}

async function waitForCallerInput(voice, session) {
  emitSessionEvent(session, "agent.listen.started", { turn: session.turns });
  const result = await voice.gather({
    source: config.gatherSource,
    timeout: config.gatherTimeoutMs,
    maxDigits: config.gatherMaxDigits
  });

  const speech = trimText(result?.speech, "");
  const digits = trimText(result?.digits, "");
  if (speech) {
    emitSessionEvent(session, "caller.speech", { transcript: speech });
    return {
      text: speech,
      source: "speech",
      fallback: !speech && !digits
    };
  }

  if (digits) {
    emitSessionEvent(session, "caller.digits", { digits });
    return {
      text: digits,
      source: "dtmf",
      fallback: false
    };
  }

  return {
    text: "",
    source: "none",
    fallback: true
  };
}

async function answerAndRunConversation(req, voice) {
  const requestRefs = collectRequestSessionRefs(req);
  const terminalRef = findTerminalSessionRef(requestRefs);
  if (terminalRef) {
    try {
      await voice.hangup();
    } catch (_error) {
      // ignore late duplicate close errors
    }
    return;
  }

  const sessionId = trimText(req.mediaSessionRef || req.runtimeCallRef || req.callRef || randomUUID());
  const session = createSession({
    callRef: req.callRef,
    call_ref: req.call_ref,
    bridgeCallRef: req.bridgeCallRef,
    bridge_call_ref: req.bridge_call_ref,
    parentCallRef: req.parentCallRef,
    parent_call_ref: req.parent_call_ref,
    runtimeCallRef: req.runtimeCallRef,
    runtime_call_ref: req.runtime_call_ref,
    childCallRef: req.childCallRef,
    child_call_ref: req.child_call_ref,
    mediaSessionRef: req.mediaSessionRef,
    media_session_ref: req.media_session_ref,
    callerNumber: req.callerNumber,
    ingressNumber: req.ingressNumber,
    appRef: req.appRef,
    selfEndpoint: req.selfEndpoint
  });
  registerSessionAlias(session, session.id);
  registerSessionAlias(session, sessionId); // alias by incoming mediaSessionRef/runtime ref
  session.state = "starting";

  emitSessionEvent(session, "call.incoming", {
    callerNumber: session.callerNumber,
    ingressNumber: session.ingressNumber,
    appRef: session.appRef,
    bridgeCallRef: session.bridgeCallRef,
    runtimeCallRef: session.runtimeCallRef,
    mediaSessionRef: session.mediaSessionRef
  });

  try {
    await voice.answer();
    session.state = "active";
    emitSessionEvent(session, "call.answered", {
      callerNumber: session.callerNumber,
      ingressNumber: session.ingressNumber
    });
    await fetchOnelinkAiContext(session);
    void emitOnelinkAiEvent(session, "call_started", {
      from: session.callerNumber,
      to: session.ingressNumber,
      direction: "inbound",
      started_at: session.createdAt,
      app_ref: session.appRef,
      route_action: isRealtimeVoiceMode() ? "ai" : "voice_agent"
    });

    if (isRealtimeVoiceMode()) {
      await runRealtimeVoiceConversation(voice, session);
      return;
    }

    await sayText(voice, session, config.promptGreeting);

    while (session.state === "active" && session.turns < config.maxConversationTurns) {
      const input = await waitForCallerInput(voice, session).catch((error) => {
        emitSessionEvent(session, "caller.input.error", {
          error: formatErrorPayload(error, "failed to collect user input")
        });
        return { text: "", source: "none", fallback: true };
      });

      session.turns += 1;
      if (!input.text) {
        session.noInputCount += 1;
        if (session.noInputCount >= config.maxNoInputRetries) {
          await sayText(voice, session, config.promptNoInput);
          emitSessionEvent(session, "call.no_input", { retries: session.noInputCount });
          break;
        }

        await sayText(voice, session, config.promptFallback);
        emitSessionEvent(session, "call.retry", {
          noInputCount: session.noInputCount
        });
        if (config.stopOnFiller) {
          break;
        }
        continue;
      }

      session.noInputCount = 0;
      pushTranscript(session, "caller", input.text, input.source);
      addHistoryMessage(session, "user", input.text);

      let reply;
      if (hasTransferIntent(input.text) && isTransferToolEnabled(session)) {
        reply = {
          text: trimText(config.transferMessage || config.promptFallback),
          transfer: true,
          continue: true
        };
      } else if (hasHangupIntent(input.text)) {
        reply = {
          text: config.promptGoodbye,
          transfer: false,
          continue: false
        };
      } else if (normalizeLlmProvider(config.llmProvider) === "mock") {
        reply = fallbackResponse(input.text);
      } else {
        reply = await callLLM(session.history, session);
      }

      addHistoryMessage(session, "assistant", reply.text);
      pushTranscript(session, "assistant", reply.text, "agent");

      if (reply.transfer) {
        emitSessionEvent(session, "agent.transfer.requested", { reason: "intent"});
        const transferResult = await transferToLiveAgent(voice, session);
        if (transferResult?.ok) {
          session.state = "transferred";
          return;
        }
        await sayText(voice, session, config.transferMessage || "I cannot transfer now, continue with me.");
      }

      await sayText(voice, session, reply.text);
      emitSessionEvent(session, "agent.responded", {
        turn: session.turns,
        continue: reply.continue
      });

      if (!reply.continue) {
        break;
      }
    }
  } catch (error) {
    session.lastError = formatErrorPayload(error, "call handling error");
    emitSessionEvent(session, "call.error", {
      error: session.lastError
    });
    void emitOnelinkAiEvent(session, "error", {
      scope: "voice_session",
      error_code: "call_handling_error",
      error_message: session.lastError,
      retryable: false
    });
  } finally {
    const finalState = session.state;
    const finalReason =
      finalState === "transferred"
        ? "operator_answered"
        : session.endRequested
          ? "caller_finished"
          : session.lastError
            ? "failed"
            : "call_flow_ended";
    if (session.state !== "transferred") {
      try {
        await voice.hangup();
      } catch (_error) {
        // ignore
      }
      session.state = "closed";
    }
    session.endedAt = session.endedAt || new Date().toISOString();
    emitSessionEvent(session, "call.completed", { state: session.state });
    await emitOnelinkAiEvent(session, "call_ended", {
      ended_by: finalState === "transferred" ? "transfer" : "voice_agent",
      reason: finalReason,
      duration_ms:
        Number.isFinite(Date.parse(session.endedAt)) && Number.isFinite(Date.parse(session.createdAt))
          ? Math.max(0, Date.parse(session.endedAt) - Date.parse(session.createdAt))
          : null
    });
    await finalizeOnelinkAiSession(session, finalReason);
    closeSession(session, finalReason);
  }
}

async function listSessions(req, res) {
  const url = new URL(req.url, `http://localhost:${config.apiPort}`);
  const stateFilter = (url.searchParams.get("state") || "").toLowerCase();
  const seen = new Set();
  const sessionsData = [];
  for (const session of sessions.values()) {
    if (isTerminalSession(session) || seen.has(session.id)) {
      continue;
    }
    seen.add(session.id);
    if (stateFilter && session.state !== stateFilter) {
      continue;
    }
    sessionsData.push(sanitizeSessionSummary(session));
    if (sessionsData.length >= 200) {
      break;
    }
  }

  sendJson(res, 200, {
    count: sessionsData.length,
    sessions: sessionsData
  });
}

async function getSessionById(req, res, sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    sendError(res, 404, "SESSION_NOT_FOUND", `session ${sessionId} not found`);
    return;
  }

  sendJson(res, 200, {
    session: {
      ...sanitizeSessionSummary(session),
      state: session.state,
      historyCount: session.history.length,
      transcript: session.transcript
    }
  });
}

async function getSessionEvents(req, res, sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    sendError(res, 404, "SESSION_NOT_FOUND", `session ${sessionId} not found`);
    return;
  }

  const url = new URL(req.url, `http://localhost:${config.apiPort}`);
  const rawSince = Number(url.searchParams.get("since_seq") || "0");
  const sinceSeq = Number.isFinite(rawSince) && rawSince > 0 ? Math.floor(rawSince) : 0;
  const longPollMs = Number(url.searchParams.get("block_ms") || url.searchParams.get("wait") || "0");
  const watch = trimText(url.searchParams.get("watch") || "").toLowerCase();
  const streamMode = watch === "1" || watch === "true" || watch === "sse" || req.headers.accept?.includes("text/event-stream");

  if (streamMode) {
    const events = collectSessionEvents(session, sinceSeq);
    registerSseListener(session, res);
    events.forEach((event) => {
      res.write(formatSseEvent(event));
    });
    return;
  }

  if (longPollMs > 0) {
    const events = await waitForSessionEvents(
      session,
      sinceSeq,
      Math.min(30000, Math.max(250, longPollMs))
    );
    sendJson(res, 200, {
      sessionId,
      events,
      at: new Date().toISOString()
    });
    return;
  }

  const events = collectSessionEvents(session, sinceSeq);
  sendJson(res, 200, {
    sessionId,
    events
  });
}

async function getSessionTranscript(req, res, sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    sendError(res, 404, "SESSION_NOT_FOUND", `session ${sessionId} not found`);
    return;
  }

  sendJson(res, 200, {
    sessionId,
    transcript: session.transcript
  });
}

async function postSessionTranscript(req, res, sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    sendError(res, 404, "SESSION_NOT_FOUND", `session ${sessionId} not found`);
    return;
  }

  const body = await parseJsonBody(req);
  const text = trimText(body.text || body.message, "");
  const speaker = trimText(body.speaker || "system");
  if (!text) {
    sendError(res, 400, "INVALID_PAYLOAD", "body.text is required");
    return;
  }

  pushTranscript(session, speaker, text, "api");
  addHistoryMessage(session, "system", `CRM override: ${text}`);
  emitSessionEvent(session, "transcript.imported", { speaker, textLength: text.length });
  sendJson(res, 200, {
    sessionId,
    status: "ok"
  });
}

async function getProviders(req, res) {
  sendJson(res, 200, {
    runtime: getProviderCapabilities()
  });
}

async function streamSessionEvents(req, res, sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    sendError(res, 404, "SESSION_NOT_FOUND", `session ${sessionId} not found`);
    return;
  }

  const url = new URL(req.url, `http://localhost:${config.apiPort}`);
  const rawSince = Number(url.searchParams.get("since_seq") || "0");
  const sinceSeq = Number.isFinite(rawSince) && rawSince > 0 ? Math.floor(rawSince) : 0;
  const events = collectSessionEvents(session, sinceSeq);
  registerSseListener(session, res);
  events.forEach((event) => {
    res.write(formatSseEvent(event));
  });
}

async function closeSessionByApi(req, res, sessionId) {
  let body = {};
  if (req.method === "POST" || req.method === "DELETE") {
    body = await parseJsonBody(req).catch(() => ({}));
  }

  let session = getSession(sessionId);
  if (!session) {
    for (const ref of collectRequestSessionRefs(body)) {
      session = getSession(ref);
      if (session) {
        break;
      }
    }
  }

  if (!session) {
    const terminalRef = findTerminalSessionRef(new Set([sessionId, ...collectRequestSessionRefs(body)]));
    if (terminalRef) {
      sendJson(res, 200, {
        status: "closed",
        reason: terminalRef.entry.reason || "terminal",
        terminal: true,
        session: terminalRef.entry
      });
      return;
    }

    sendError(res, 404, "SESSION_NOT_FOUND", `session ${sessionId} not found`);
    return;
  }

  const url = new URL(req.url, `http://localhost:${config.apiPort}`);
  let reason = trimText(url.searchParams.get("reason") || "", "api");
  if (typeof body.reason === "string" && body.reason.trim().length > 0) {
    reason = trimText(body.reason, reason);
  }
  closeSession(session, reason || "api");
  sendJson(res, 200, {
    status: "closed",
    reason,
    session: sanitizeSessionSummary(session)
  });
}

async function getRealtimeSessionStatus(req, res, sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    sendError(res, 404, "SESSION_NOT_FOUND", `session ${sessionId} not found`);
    return;
  }

  sendJson(res, 200, {
    sessionId,
    realtime: session.realtime || null,
    active: Boolean(session.realtimeController),
    state: session.state
  });
}

async function postRealtimeSessionText(req, res, sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    sendError(res, 404, "SESSION_NOT_FOUND", `session ${sessionId} not found`);
    return;
  }

  if (!session.realtimeController?.sendText) {
    sendError(res, 409, "REALTIME_NOT_ACTIVE", `session ${sessionId} has no active realtime controller`);
    return;
  }

  const body = await parseJsonBody(req);
  const text = trimText(body.text || body.message, "");
  if (!text) {
    sendError(res, 400, "INVALID_PAYLOAD", "body.text is required");
    return;
  }

  session.realtimeController.sendText(text);
  emitSessionEvent(session, "realtime.text.sent", {
    textLength: text.length
  });
  sendJson(res, 202, {
    sessionId,
    status: "accepted"
  });
}

async function postRealtimeSessionInterrupt(req, res, sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    sendError(res, 404, "SESSION_NOT_FOUND", `session ${sessionId} not found`);
    return;
  }

  if (!session.realtimeController?.interrupt) {
    sendError(res, 409, "REALTIME_NOT_ACTIVE", `session ${sessionId} has no active realtime controller`);
    return;
  }

  session.realtimeController.interrupt();
  emitSessionEvent(session, "realtime.interrupt.sent");
  sendJson(res, 202, {
    sessionId,
    status: "accepted"
  });
}

async function postRealtimeSessionClose(req, res, sessionId) {
  const session = getSession(sessionId);
  if (!session) {
    sendError(res, 404, "SESSION_NOT_FOUND", `session ${sessionId} not found`);
    return;
  }

  closeSession(session, "realtime-api-close");
  sendJson(res, 200, {
    sessionId,
    status: "closed"
  });
}

async function getConfig(req, res) {
  sendJson(res, 200, {
    runtime: {
      grpcPort: config.grpcPort,
      apiPort: config.apiPort,
      llmProvider: config.llmProvider,
      llmProviderResolved: normalizeLlmProvider(config.llmProvider),
      llmModel: config.llmModel,
      maxConversationTurns: config.maxConversationTurns,
      maxConversationHistory: config.maxConversationHistory,
      gatherSource: config.gatherSource,
      gatherTimeoutMs: config.gatherTimeoutMs,
      voiceMode: isRealtimeVoiceMode() ? "realtime" : "turn-by-turn",
      realtimeProvider: normalizeRealtimeProvider(),
      realtimeModel: getRealtimeModel(),
      realtimeVoice: getRealtimeVoice(),
      realtimeInputRate: config.realtimeInputRate,
      realtimeOutputRate: config.realtimeOutputRate,
      realtimeCallRate: config.realtimeCallRate,
      realtimeStartupBeeps: config.realtimeStartupBeeps,
      realtimeOutputMaxBufferedMs: config.realtimeOutputMaxBufferedMs,
      geminiTransferToolName: config.geminiTransferToolName,
      onelinkAiConfigured: isOnelinkAiConfigured(),
      onelinkAiBaseUrl: config.onelinkAiBaseUrl || null,
      onelinkAiEventPath: config.onelinkAiEventPath,
      onelinkAiFinalizePath: config.onelinkAiFinalizePath,
      onelinkAiTranscriptMode: config.onelinkAiTranscriptMode,
      providers: getProviderCapabilities()
    }
  });
}

function handleCors(req, res) {
  const origin = req.headers.origin || "";
  const allowed = getCorsHeaders(origin);
  if (allowed) {
    res.setHeader("Access-Control-Allow-Origin", allowed);
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  }
}

function notFound(res) {
  sendError(res, 404, "NOT_FOUND", "resource not found");
}

function routeRequest(req, res) {
  handleCors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${config.apiPort}`);
  const pathname = trimText(url.pathname);
  if (pathname === "/healthz" || pathname === "/readyz") {
    sendJson(res, 200, {
      status: "ok",
      ready: true,
      time: new Date().toISOString(),
      sessions: countActiveSessions(),
      realtimeProvider: normalizeRealtimeProvider(),
      realtimeConfigured: Boolean(config.realtimeApiKey),
      onelinkAiConfigured: isOnelinkAiConfigured()
    });
    return;
  }

  if (!ensureAuth(req, res)) {
    return;
  }

  if (!pathname) {
    res.writeHead(301, {
      Location: "/healthz"
    });
    res.end();
    return;
  }
  if (pathname === "/api/v1/voice/sessions") {
    if (req.method === "GET") {
      void listSessions(req, res);
      return;
    }
    sendError(res, 405, "METHOD_NOT_ALLOWED", "method not allowed");
    return;
  }

  if (pathname === "/api/v1/voice/config") {
    if (req.method === "GET") {
      void getConfig(req, res);
      return;
    }
    sendError(res, 405, "METHOD_NOT_ALLOWED", "method not allowed");
    return;
  }

  if (pathname === "/api/v1/voice/providers") {
    if (req.method === "GET") {
      void getProviders(req, res);
      return;
    }
    sendError(res, 405, "METHOD_NOT_ALLOWED", "method not allowed");
    return;
  }

  const matchEventsStream = pathname.match(
    /^\/api\/v1\/voice\/sessions\/([^/]+)\/events\/stream$/
  );
  if (matchEventsStream) {
    const sessionId = decodeURIComponent(matchEventsStream[1] || "");
    if (req.method === "GET") {
      void streamSessionEvents(req, res, sessionId);
      return;
    }
    sendError(res, 405, "METHOD_NOT_ALLOWED", "method not allowed");
    return;
  }

  const matchEvents = pathname.match(/^\/api\/v1\/voice\/sessions\/([^/]+)\/events$/);
  if (matchEvents) {
    const sessionId = decodeURIComponent(matchEvents[1] || "");
    if (req.method === "GET") {
      void getSessionEvents(req, res, sessionId);
      return;
    }
    sendError(res, 405, "METHOD_NOT_ALLOWED", "method not allowed");
    return;
  }

  const matchRealtimeText = pathname.match(
    /^\/api\/v1\/voice\/sessions\/([^/]+)\/realtime\/text$/
  );
  if (matchRealtimeText) {
    const sessionId = decodeURIComponent(matchRealtimeText[1] || "");
    if (req.method === "POST") {
      void postRealtimeSessionText(req, res, sessionId);
      return;
    }
    sendError(res, 405, "METHOD_NOT_ALLOWED", "method not allowed");
    return;
  }

  const matchRealtimeInterrupt = pathname.match(
    /^\/api\/v1\/voice\/sessions\/([^/]+)\/realtime\/interrupt$/
  );
  if (matchRealtimeInterrupt) {
    const sessionId = decodeURIComponent(matchRealtimeInterrupt[1] || "");
    if (req.method === "POST") {
      void postRealtimeSessionInterrupt(req, res, sessionId);
      return;
    }
    sendError(res, 405, "METHOD_NOT_ALLOWED", "method not allowed");
    return;
  }

  const matchRealtimeClose = pathname.match(
    /^\/api\/v1\/voice\/sessions\/([^/]+)\/realtime\/close$/
  );
  if (matchRealtimeClose) {
    const sessionId = decodeURIComponent(matchRealtimeClose[1] || "");
    if (req.method === "POST" || req.method === "DELETE") {
      void postRealtimeSessionClose(req, res, sessionId);
      return;
    }
    sendError(res, 405, "METHOD_NOT_ALLOWED", "method not allowed");
    return;
  }

  const matchRealtime = pathname.match(
    /^\/api\/v1\/voice\/sessions\/([^/]+)\/realtime$/
  );
  if (matchRealtime) {
    const sessionId = decodeURIComponent(matchRealtime[1] || "");
    if (req.method === "GET") {
      void getRealtimeSessionStatus(req, res, sessionId);
      return;
    }
    sendError(res, 405, "METHOD_NOT_ALLOWED", "method not allowed");
    return;
  }

  const matchTranscript = pathname.match(
    /^\/api\/v1\/voice\/sessions\/([^/]+)\/transcript$/
  );
  if (matchTranscript) {
    const sessionId = decodeURIComponent(matchTranscript[1] || "");
    if (req.method === "GET") {
      void getSessionTranscript(req, res, sessionId);
      return;
    }
    if (req.method === "POST") {
      void postSessionTranscript(req, res, sessionId);
      return;
    }
    sendError(res, 405, "METHOD_NOT_ALLOWED", "method not allowed");
    return;
  }

  const matchStream = pathname.match(
    /^\/api\/v1\/voice\/sessions\/([^/]+)\/stream$/
  );
  if (matchStream) {
    const sessionId = decodeURIComponent(matchStream[1] || "");
    if (req.method === "GET") {
      void streamSessionEvents(req, res, sessionId);
      return;
    }
    sendError(res, 405, "METHOD_NOT_ALLOWED", "method not allowed");
    return;
  }

  const matchClose = pathname.match(/^\/api\/v1\/voice\/sessions\/([^/]+)\/close$/);
  if (matchClose) {
    const sessionId = decodeURIComponent(matchClose[1] || "");
    if (req.method === "POST" || req.method === "DELETE") {
      void closeSessionByApi(req, res, sessionId);
      return;
    }
    sendError(res, 405, "METHOD_NOT_ALLOWED", "method not allowed");
    return;
  }

  const matchSession = pathname.match(/^\/api\/v1\/voice\/sessions\/([^/]+)$/);
  if (matchSession) {
    const sessionId = decodeURIComponent(matchSession[1] || "");
    if (req.method === "GET") {
      void getSessionById(req, res, sessionId);
      return;
    }
    sendError(res, 405, "METHOD_NOT_ALLOWED", "method not allowed");
    return;
  }

  notFound(res);
}

setInterval(() => {
  const now = Date.now();
  pruneTerminalRefs();
  for (const [id, session] of sessions.entries()) {
    if (isTerminalSession(session)) {
      recordTerminalSessionRefs(session, "housekeeping");
      sessions.delete(id);
      continue;
    }

    const updatedAt = Date.parse(session.updatedAt || session.createdAt || Date.now());
    if (!Number.isFinite(updatedAt)) {
      continue;
    }

    if (now - updatedAt > config.apiSessionTtlMs) {
      closeSession(session, "housekeeping");
      sessions.delete(id);
    }
  }
}, Math.max(60000, Math.floor(config.apiSessionTtlMs / 6)));

new VoiceServer({
  port: config.grpcPort,
  skipIdentity: config.skipIdentity,
  identityAddress: config.identityAddress
}).listen(async (req, voice) => {
  emitSessionEvent(null, "incoming", { appRef: req.appRef || "" });
  await answerAndRunConversation(req, voice).catch((error) => {
    console.error(
      JSON.stringify({
        event: "voice-runtime-error",
        error: formatErrorPayload(error, "failed inbound call"),
        appRef: req.appRef
      })
    );
  });
});

const httpServer = createServer((req, res) => {
  try {
    routeRequest(req, res);
  } catch (error) {
    sendError(res, 500, "INTERNAL_ERROR", formatErrorPayload(error, "internal server error"));
  }
});

httpServer.listen(config.apiPort, "0.0.0.0", () => {
  console.log(
    JSON.stringify({
      event: "test-voiceapp-http-started",
      port: config.apiPort,
      grpcPort: config.grpcPort
    })
  );
});

console.log(
  JSON.stringify({
    event: "test-voiceapp-runtime-started",
    grpcPort: config.grpcPort,
    skipIdentity: config.skipIdentity,
    identityAddress: config.identityAddress,
    llmProvider: config.llmProvider,
    apiPort: config.apiPort
  })
);
