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
  realtimeLanguage: process.env.VOICE_AGENT_REALTIME_LANGUAGE || process.env.VOICE_AGENT_LANGUAGE || "en-US",
  realtimeInputRate: parseInt(process.env.VOICE_AGENT_REALTIME_INPUT_RATE || "16000", 10),
  realtimeOutputRate: parseInt(process.env.VOICE_AGENT_REALTIME_OUTPUT_RATE || "24000", 10),
  realtimeCallRate: parseInt(process.env.VOICE_AGENT_REALTIME_CALL_RATE || "16000", 10),
  realtimeMaxDurationMs: parseInt(process.env.VOICE_AGENT_REALTIME_MAX_DURATION_MS || "900000", 10),
  realtimeGreetingMode: (process.env.VOICE_AGENT_REALTIME_GREETING_MODE || "tts").trim().toLowerCase(),
  realtimeTurnDetection: (process.env.VOICE_AGENT_REALTIME_TURN_DETECTION || "semantic_vad").trim(),
  realtimeInterruptions: parseBoolean(process.env.VOICE_AGENT_REALTIME_INTERRUPTS, true),
  realtimeLogProviderEvents: parseBoolean(process.env.VOICE_AGENT_REALTIME_LOG_PROVIDER_EVENTS, false),

  transferSipAor: process.env.VOICE_AGENT_TRANSFER_AGENT_AOR || "",
  transferMessage: process.env.VOICE_AGENT_TRANSFER_MESSAGE || "",

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

function sanitizeSessionSummary(session) {
  return {
    id: session.id,
    state: session.state,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    turns: session.turns,
    callRef: session.callRef,
    mediaSessionRef: session.mediaSessionRef,
    callerNumber: session.callerNumber,
    ingressNumber: session.ingressNumber,
    realtime: session.realtime || null,
    events: session.events.length,
    transcriptCount: session.transcript.length
  };
}

function createSession(request) {
  const callRef = trimText(request.callRef || "");
  const mediaSessionRef = trimText(request.mediaSessionRef || "");
  const id = (mediaSessionRef || callRef || randomUUID()).toString();
  const now = new Date().toISOString();
  const session = {
    id,
    state: "initializing",
    callRef,
    mediaSessionRef,
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
    lastPongAt: now,
    nextTimeout: null,
    endedAt: null,
    transferRequested: false
  };

  sessions.set(id, session);
  if (mediaSessionRef && mediaSessionRef !== id) {
    sessions.set(mediaSessionRef, session);
  }
  if (callRef && callRef !== id && callRef !== mediaSessionRef) {
    sessions.set(callRef, session);
  }
  emitSessionEvent(session, "session.created", {
    callRef: session.callRef,
    mediaSessionRef: session.mediaSessionRef,
    callerNumber: session.callerNumber,
    ingressNumber: session.ingressNumber
  });
  return session;
}

function getSession(id) {
  return sessions.get(id) || null;
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
    return;
  }

  session.state = "closed";
  session.endedAt = new Date().toISOString();
  if (session.nextTimeout) {
    clearTimeout(session.nextTimeout);
  }

  const realtimeController = session.realtimeController;
  session.realtimeController = null;
  try {
    realtimeController?.close?.();
  } catch (_error) {
    // ignore realtime close errors
  }

  emitSessionEvent(session, "session.closed", { reason });
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
}

function emitSessionEvent(session, type, payload = {}) {
  if (!session) {
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

  touchSession(session);

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

function getRealtimeModel(provider = normalizeRealtimeProvider()) {
  const explicit = trimText(config.realtimeModel, "");
  if (explicit) {
    return explicit;
  }

  if (provider === "gemini-live") {
    return "gemini-2.5-flash-native-audio-preview-12-2025";
  }

  return "gpt-realtime";
}

function getRealtimeVoice(provider = normalizeRealtimeProvider()) {
  const explicit = trimText(config.realtimeVoice, "");
  if (explicit) {
    return explicit;
  }

  if (provider === "gemini-live") {
    return "Charon";
  }

  return "marin";
}

function getRealtimeSystemInstruction(options = {}) {
  const instructions = [config.promptSystem];

  if (options.includeToolInstructions && config.transferSipAor) {
    instructions.push(
      "When the caller asks for a human, operator, representative, or live specialist, use the transfer_to_live_agent tool instead of only saying that you will transfer."
    );
  }

  if (options.includeToolInstructions) {
    instructions.push(
      "When the caller clearly says goodbye or asks to end the call, use the end_call tool."
    );
  }

  return instructions.filter(Boolean).join("\n");
}

function buildGeminiLiveTools() {
  const functionDeclarations = [];

  if (config.transferSipAor) {
    functionDeclarations.push({
      name: "transfer_to_live_agent",
      description: "Transfer the current phone call to a configured live specialist.",
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
    name: "end_call",
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

async function executeRealtimeToolCall(session, actions, call) {
  const name = trimText(call?.name, "");
  const id = trimText(call?.id, "");
  const args = call?.args && typeof call.args === "object" ? call.args : {};

  emitSessionEvent(session, "realtime.tool.called", {
    provider: "gemini-live",
    name,
    id,
    args
  });

  if (name === "transfer_to_live_agent") {
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

    const transferred = await actions.transferToLiveAgent(args);
    return {
      name,
      id,
      terminal: transferred,
      response: {
        ok: transferred,
        status: transferred ? "transferred" : "failed"
      }
    };
  }

  if (name === "end_call") {
    if (actions.endCall) {
      await actions.endCall(args);
    } else {
      session.state = "closed";
    }

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

  async function handleToolCall(toolCall) {
    const functionCalls = Array.isArray(toolCall?.functionCalls)
      ? toolCall.functionCalls
      : [];
    if (!functionCalls.length) {
      return;
    }

    const results = [];
    for (const call of functionCalls) {
      try {
        results.push(await executeRealtimeToolCall(session, actions, call));
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
      emitSessionEvent(session, "realtime.tool.cancelled", {
        provider: "gemini-live",
        ids: event.toolCallCancellation.ids || []
      });
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
          const setup = {
            model: `models/${getRealtimeModel("gemini-live").replace(/^models\//, "")}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
              temperature: Number.isFinite(config.llmTemperature) ? config.llmTemperature : 0.2,
              topP: Number.isFinite(config.llmTopP) ? config.llmTopP : 1,
              maxOutputTokens: Number.isFinite(config.llmMaxTokens) ? config.llmMaxTokens : 700,
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: {
                    voiceName: getRealtimeVoice("gemini-live")
                  }
                },
                languageCode: config.realtimeLanguage
              }
            },
            systemInstruction: {
              parts: [{ text: getRealtimeSystemInstruction({ includeToolInstructions: true }) }]
            },
            realtimeInputConfig: {
              automaticActivityDetection: {
                disabled: false
              },
              activityHandling: config.realtimeInterruptions
                ? "START_OF_ACTIVITY_INTERRUPTS"
                : "NO_INTERRUPTION"
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {}
          };
          const tools = buildGeminiLiveTools();
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
              model: getRealtimeModel("gemini-live")
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
          emitSessionEvent(session, "realtime.provider.error", {
            provider: "gemini-live",
            error: formatErrorPayload(error, "Gemini Live error")
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
            settled = true;
            reject(new Error(`Gemini Live connection closed before setup complete (${code})`));
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

  session.state = "realtime";
  session.realtime = {
    provider,
    model: getRealtimeModel(provider),
    voice: getRealtimeVoice(provider),
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

  controller = createRealtimeController(session, (audio) => {
    if (!streamRef) {
      return;
    }

    voiceStream.write({
      mediaSessionRef: session.mediaSessionRef,
      streamRef,
      format: StreamAudioFormat.WAV,
      type: StreamMessageType.AUDIO_OUT,
      data: audio
    });
  }, {
    transferToLiveAgent: async () => {
      const transferred = await transferToLiveAgent(voice, session);
      if (transferred) {
        session.state = "transferred";
      }
      return transferred;
    },
    endCall: async () => {
      session.state = "closed";
    }
  });

  session.realtimeController = controller;

  voiceStream.onPayload((payload) => {
    if (!payload || payload.type !== StreamMessageType.AUDIO_IN || !payload.data) {
      return;
    }

    streamRef = payload.streamRef || streamRef;
    session.realtime.streamRef = streamRef;
    controller.sendAudio(Buffer.from(payload.data));
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

async function transferToLiveAgent(voice, session) {
  if (!config.transferSipAor) {
    emitSessionEvent(session, "agent.transfer.blocked", { reason: "transfer target not configured" });
    return false;
  }

  emitSessionEvent(session, "agent.transfer.started", { aor: config.transferSipAor });
  session.transferRequested = true;
  try {
    await voice.dial(config.transferSipAor, { timeout: 30 });
    emitSessionEvent(session, "agent.transfer.completed", { aor: config.transferSipAor });
    return true;
  } catch (error) {
    emitSessionEvent(session, "agent.transfer.failed", {
      error: formatErrorPayload(error, "agent transfer failed")
    });
    return false;
  }
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
  const sessionId = trimText(req.mediaSessionRef || req.callRef || randomUUID());
  const session = createSession({
    callRef: req.callRef,
    mediaSessionRef: req.mediaSessionRef,
    callerNumber: req.callerNumber,
    ingressNumber: req.ingressNumber,
    appRef: req.appRef,
    selfEndpoint: req.selfEndpoint
  });
  sessions.set(session.id, session);
  sessions.set(sessionId, session); // alias by incoming mediaSessionRef
  session.state = "starting";

  emitSessionEvent(session, "call.incoming", {
    callerNumber: session.callerNumber,
    ingressNumber: session.ingressNumber,
    appRef: session.appRef
  });

  try {
    await voice.answer();
    session.state = "active";
    emitSessionEvent(session, "call.answered", {
      callerNumber: session.callerNumber,
      ingressNumber: session.ingressNumber
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
      if (hasTransferIntent(input.text) && config.transferSipAor) {
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
        const transferred = await transferToLiveAgent(voice, session);
        if (transferred) {
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
    emitSessionEvent(session, "call.error", {
      error: formatErrorPayload(error, "call handling error")
    });
  } finally {
    if (session.state !== "transferred") {
      try {
        await voice.hangup();
      } catch (_error) {
        // ignore
      }
      session.state = "closed";
      emitSessionEvent(session, "call.completed", { state: session.state });
      closeSession(session, "call-flow-ended");
    }
  }
}

async function listSessions(req, res) {
  const url = new URL(req.url, `http://localhost:${config.apiPort}`);
  const stateFilter = (url.searchParams.get("state") || "").toLowerCase();
  const seen = new Set();
  const sessionsData = [];
  for (const session of sessions.values()) {
    if (seen.has(session.id)) {
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
  const session = getSession(sessionId);
  if (!session) {
    sendError(res, 404, "SESSION_NOT_FOUND", `session ${sessionId} not found`);
    return;
  }

  const url = new URL(req.url, `http://localhost:${config.apiPort}`);
  let reason = trimText(url.searchParams.get("reason") || "", "api");
  if (req.method === "POST" || req.method === "DELETE") {
    const body = await parseJsonBody(req).catch(() => ({}));
    if (typeof body.reason === "string" && body.reason.trim().length > 0) {
      reason = trimText(body.reason, reason);
    }
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
  if (!ensureAuth(req, res)) {
    return;
  }

  handleCors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${config.apiPort}`);
  const pathname = trimText(url.pathname);
  if (!pathname) {
    res.writeHead(301, {
      Location: "/healthz"
    });
    res.end();
    return;
  }

  if (pathname === "/healthz") {
    sendJson(res, 200, {
      status: "ok",
      time: new Date().toISOString(),
      sessions: sessions.size
    });
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
  for (const [id, session] of sessions.entries()) {
    if (session.state === "closed") {
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

new VoiceServer({ port: config.grpcPort }).listen(async (req, voice) => {
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
    llmProvider: config.llmProvider,
    apiPort: config.apiPort
  })
);
