function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const config = {
  port: asNumber(process.env.VOICE_RUNTIME_PORT, 50062),
  logLevel: process.env.VOICE_RUNTIME_LOG_LEVEL || "info",
  bridgeBaseUrl:
    process.env.VOICE_RUNTIME_BRIDGE_BASE_URL || "http://telephony-bridge:3100",
  bridgeSharedSecret:
    process.env.VOICE_RUNTIME_BRIDGE_SHARED_SECRET ||
    process.env.TELEPHONY_BRIDGE_SHARED_SECRET ||
    "",
  bridgeTimeoutMs: asNumber(process.env.VOICE_RUNTIME_BRIDGE_TIMEOUT_MS, 5000),
  bridgeMaxRetries: asNumber(process.env.VOICE_RUNTIME_BRIDGE_MAX_RETRIES, 2),
  bridgeBackoffMs: asNumber(process.env.VOICE_RUNTIME_BRIDGE_BACKOFF_MS, 150),
  skipIdentity: asBoolean(process.env.VOICE_RUNTIME_SKIP_IDENTITY, true),
  defaultFailureMessage:
    process.env.VOICE_RUNTIME_DEFAULT_FAILURE_MESSAGE ||
    "We are unable to process your call right now.",
  unsupportedActionMessage:
    process.env.VOICE_RUNTIME_UNSUPPORTED_ACTION_MESSAGE ||
    "This call route is not available yet.",
  defaultTransferMessage:
    process.env.VOICE_RUNTIME_TRANSFER_MESSAGE ||
    "Please hold while we connect your call."
};

module.exports = { config };
