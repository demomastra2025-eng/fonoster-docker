function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function asNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function asList(value, fallback = []) {
  if (value === undefined || value === null || value === "") return fallback;
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function requiredEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === null || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

const config = {
  port: asNumber(process.env.TELEPHONY_BRIDGE_PORT, 3100),
  logLevel: process.env.TELEPHONY_BRIDGE_LOG_LEVEL || "info",
  sharedSecret: process.env.TELEPHONY_BRIDGE_SHARED_SECRET || "",
  security: {
    requireInternalSecret: asBoolean(
      process.env.TELEPHONY_BRIDGE_REQUIRE_INTERNAL_SECRET,
      true
    ),
    trustProxy: asBoolean(process.env.TELEPHONY_BRIDGE_TRUST_PROXY, false),
    logHttpRequests: asBoolean(
      process.env.TELEPHONY_BRIDGE_LOG_HTTP_REQUESTS,
      false
    )
  },
  stream: {
    maxHistory: asNumber(process.env.TELEPHONY_BRIDGE_STREAM_MAX_HISTORY, 500),
    heartbeatMs: asNumber(process.env.TELEPHONY_BRIDGE_STREAM_HEARTBEAT_MS, 10000),
    maxLongPollMs: asNumber(
      process.env.TELEPHONY_BRIDGE_STREAM_MAX_LONG_POLL_MS,
      30000
    ),
    dedupTtlMs: asNumber(
      process.env.TELEPHONY_BRIDGE_STREAM_DEDUP_TTL_MS,
      120000
    ),
    databaseUrl:
      process.env.TELEPHONY_BRIDGE_STREAM_DATABASE_URL ||
      process.env.TELEPHONY_BRIDGE_ROUTR_DATABASE_URL ||
      process.env.ROUTR_DATABASE_URL ||
      "",
    tableName: process.env.TELEPHONY_BRIDGE_STREAM_TABLE_NAME ||
      "telephony_voice_events",
    listenChannel:
      process.env.TELEPHONY_BRIDGE_STREAM_LISTEN_CHANNEL ||
      "telephony_voice_events",
    retentionHours:
      asNumber(process.env.TELEPHONY_BRIDGE_STREAM_RETENTION_HOURS, 24),
    pgMaxConnections:
      asNumber(process.env.TELEPHONY_BRIDGE_STREAM_PG_MAX_CONNECTIONS, 4),
    pgEnablePersist:
      asBoolean(process.env.TELEPHONY_BRIDGE_STREAM_PERSIST_EVENTS, true)
  },
  fonoster: {
    accessKeyId: requiredEnv("TELEPHONY_BRIDGE_FONOSTER_ACCESS_KEY_ID"),
    endpoint: requiredEnv("TELEPHONY_BRIDGE_FONOSTER_ENDPOINT"),
    username: requiredEnv("TELEPHONY_BRIDGE_FONOSTER_USERNAME"),
    password: requiredEnv("TELEPHONY_BRIDGE_FONOSTER_PASSWORD"),
    allowInsecure: asBoolean(
      process.env.TELEPHONY_BRIDGE_FONOSTER_ALLOW_INSECURE,
      false
    )
  },
  webphone: {
    identityPrivateKeyPath:
      process.env.TELEPHONY_BRIDGE_IDENTITY_PRIVATE_KEY_PATH ||
      process.env.IDENTITY_PRIVATE_KEY_PATH ||
      "/opt/fonoster/keys/private.pem",
    signalingServer:
      process.env.TELEPHONY_BRIDGE_WEBPHONE_SIGNALING_SERVER ||
      process.env.APISERVER_SIGNALING_SERVER ||
      process.env.APISERVER_TEST_TOKEN_SIGNALING_SERVER ||
      "",
    defaultDomainUri:
      process.env.TELEPHONY_BRIDGE_OPERATOR_DOMAIN ||
      process.env.TELEPHONY_BRIDGE_OPERATOR_DOMAIN_URI ||
      process.env.APISERVER_TEST_TOKEN_DOMAIN ||
      "operator.cloud.vconsult.kz",
    defaultDomainRef:
      process.env.TELEPHONY_BRIDGE_OPERATOR_DOMAIN_REF ||
      process.env.APISERVER_TEST_TOKEN_DOMAIN_REF ||
      "",
    tokenExpiresInSeconds: asNumber(
      process.env.TELEPHONY_BRIDGE_WEBPHONE_TOKEN_EXPIRES_IN_SECONDS,
      3600
    )
  },
  routr: {
    databaseUrl:
      process.env.TELEPHONY_BRIDGE_ROUTR_DATABASE_URL ||
      process.env.ROUTR_DATABASE_URL ||
      ""
  },
  asterisk: {
    ariBaseUrl:
      process.env.TELEPHONY_BRIDGE_ASTERISK_ARI_BASE_URL ||
      "http://asterisk:8088/ari",
    ariUsername:
      process.env.TELEPHONY_BRIDGE_ASTERISK_ARI_USERNAME ||
      process.env.ASTERISK_ARI_USERNAME ||
      "",
    ariSecret:
      process.env.TELEPHONY_BRIDGE_ASTERISK_ARI_SECRET ||
      process.env.ASTERISK_ARI_SECRET ||
      "",
    sipuniOutboundNumberRefs: asList(
      process.env.TELEPHONY_BRIDGE_SIPUNI_OUTBOUND_NUMBER_REFS,
      ["sipuni-internal-asterisk-056124100014"]
    ),
    sipuniOutboundRuntimeNumberRef:
      process.env.TELEPHONY_BRIDGE_SIPUNI_OUTBOUND_RUNTIME_NUMBER_REF ||
      "",
    sipuniOutboundEndpoint:
      process.env.TELEPHONY_BRIDGE_SIPUNI_OUTBOUND_ENDPOINT ||
      "sipuni-onelink-endpoint",
    sipuniOutboundCallerId:
      process.env.TELEPHONY_BRIDGE_SIPUNI_OUTBOUND_CALLER_ID ||
      "207",
    sipuniOutboundIngressNumber:
      process.env.TELEPHONY_BRIDGE_SIPUNI_OUTBOUND_INGRESS_NUMBER ||
      "056124100014"
  },
  onelink: {
    baseUrl:
      process.env.TELEPHONY_BRIDGE_ONELINK_BASE_URL ||
      process.env.TELEPHONY_BRIDGE_CHATWOOT_BASE_URL ||
      "",
    accessToken:
      process.env.TELEPHONY_BRIDGE_ONELINK_ACCESS_TOKEN ||
      process.env.TELEPHONY_BRIDGE_CHATWOOT_ACCESS_TOKEN ||
      "",
    accountId:
      process.env.TELEPHONY_BRIDGE_ONELINK_ACCOUNT_ID ||
      process.env.TELEPHONY_BRIDGE_CHATWOOT_ACCOUNT_ID ||
      "",
    routePath:
      process.env.TELEPHONY_BRIDGE_ONELINK_ROUTE_PATH ||
      "/internal/voice/inbound/route",
    eventPath:
      process.env.TELEPHONY_BRIDGE_ONELINK_EVENT_PATH ||
      "/internal/voice/inbound/event",
    timeoutMs: asNumber(process.env.TELEPHONY_BRIDGE_ONELINK_TIMEOUT_MS, 3000),
    maxRetries: asNumber(process.env.TELEPHONY_BRIDGE_ONELINK_MAX_RETRIES, 2),
    backoffMs: asNumber(process.env.TELEPHONY_BRIDGE_ONELINK_BACKOFF_MS, 250),
    circuitResetMs: asNumber(
      process.env.TELEPHONY_BRIDGE_ONELINK_CIRCUIT_RESET_MS,
      10000
    ),
    cacheTtlMs: asNumber(
      process.env.TELEPHONY_BRIDGE_ONELINK_CACHE_TTL_MS,
      30000
    )
  },
  outbound: {
    statusNotFoundGraceMs: asNumber(
      process.env.TELEPHONY_BRIDGE_OUTBOUND_STATUS_NOT_FOUND_GRACE_MS,
      15000
    )
  },
  defaults: {
    inboundAction:
      process.env.TELEPHONY_BRIDGE_DEFAULT_INBOUND_ACTION || "reject",
    rejectMessage:
      process.env.TELEPHONY_BRIDGE_DEFAULT_REJECT_MESSAGE ||
      "The Onelink integration is not connected yet.",
    operatorAgentAor:
      process.env.TELEPHONY_BRIDGE_DEFAULT_OPERATOR_AGENT_AOR || "",
    appRef: process.env.TELEPHONY_BRIDGE_DEFAULT_APP_REF || "",
    aiAppRef: process.env.TELEPHONY_BRIDGE_DEFAULT_AI_APP_REF || "",
    aiMode: process.env.TELEPHONY_BRIDGE_DEFAULT_AI_MODE || "fonoster_managed",
    fonosterAiAppRef:
      process.env.TELEPHONY_BRIDGE_FONOSTER_AI_APP_REF ||
      process.env.TELEPHONY_BRIDGE_DEFAULT_AI_APP_REF ||
      "",
    onelinkAiAppRef: process.env.TELEPHONY_BRIDGE_ONELINK_AI_APP_REF || "",
    onelinkAiAppEndpoint:
      process.env.TELEPHONY_BRIDGE_ONELINK_AI_APP_ENDPOINT ||
      process.env.ONELINK_AI_VOICE_APP_ENDPOINT ||
      "",
    onelinkOperatorAppRef:
      process.env.TELEPHONY_BRIDGE_ONELINK_OPERATOR_APP_REF || "",
    fallbackAiAppRef:
      process.env.TELEPHONY_BRIDGE_FALLBACK_AI_APP_REF ||
      process.env.TELEPHONY_BRIDGE_DEFAULT_AI_APP_REF ||
      "",
    runtimeAppRef:
      process.env.TELEPHONY_BRIDGE_RUNTIME_APP_REF ||
      process.env.VOICE_RUNTIME_APP_REF ||
      "",
    aiDirectAppExecutorEnabled: asBoolean(
      process.env.TELEPHONY_BRIDGE_AI_DIRECT_APP_EXECUTOR_ENABLED ||
        process.env.AI_DIRECT_APP_EXECUTOR_ENABLED,
      false
    ),
    aiChildHandoffFallbackEnabled: asBoolean(
      process.env.TELEPHONY_BRIDGE_AI_CHILD_HANDOFF_FALLBACK_ENABLED ||
        process.env.AI_CHILD_HANDOFF_FALLBACK_ENABLED,
      true
    ),
    nativeRouteEnabled: asBoolean(
      process.env.TELEPHONY_BRIDGE_NATIVE_ROUTE_ENABLED,
      true
    ),
    nativeRoutePreferLocal: asBoolean(
      process.env.TELEPHONY_BRIDGE_NATIVE_ROUTE_PREFER_LOCAL,
      false
    ),
    nativeRouteFallbackReasons: asList(
      process.env.TELEPHONY_BRIDGE_NATIVE_ROUTE_FALLBACK_REASONS,
      ["number_not_bound", "voice_inbox_not_bound", "onelink_unreachable"]
    )
  }
};

module.exports = { config };
