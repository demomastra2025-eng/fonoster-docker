#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const SDK = require("@fonoster/sdk");
const { config } = require("dotenv");

const DEFAULT_ENV_PATH = path.resolve(__dirname, "..", "..", ".env");
const envPath = process.env.FONOSTER_ENV_PATH || process.env.ENV_FILE || DEFAULT_ENV_PATH;
if (fs.existsSync(envPath)) {
  config({ path: envPath });
}

function getEnv(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value === null ? fallback : String(value);
}

function firstValue(...values) {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }

    const normalized = String(value).trim();
    if (normalized.length > 0) {
      return normalized;
    }
  }

  return "";
}

function parseBool(value, fallback = false) {
  const normalized = String(value).toLowerCase().trim();
  if (normalized === "") {
    return fallback;
  }

  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseNumber(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return parsed;
}

function parseJsonArray(value, fallback = []) {
  if (!value) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (_error) {
    return fallback;
  }
}

function parseCommandArgv(argv) {
  const options = {};
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const raw = arg.slice(2);
    const splitIndex = raw.indexOf("=");
    const key = splitIndex >= 0 ? raw.slice(0, splitIndex) : raw;

    if (splitIndex >= 0) {
      options[key] = raw.slice(splitIndex + 1);
      continue;
    }

    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      options[key] = next;
      i += 1;
    } else {
      options[key] = "true";
    }
  }

  return {
    command: positional[0] || "bootstrap",
    options
  };
}

function normalizeTel(value) {
  if (!value) {
    return "";
  }

  const trimmed = String(value).trim();
  if (trimmed.length === 0) {
    return "";
  }

  if (/^tel:/i.test(trimmed)) {
    return trimmed;
  }

  return `tel:${trimmed}`;
}

function cleanNumberFromTelUrl(value) {
  if (!value) {
    return "";
  }

  return String(value).replace(/^tel:/i, "");
}

function buildConfig(options = {}) {
  const transport = firstValue(options.transport, getEnv("FONOSTER_TRUNK_TRANSPORT"), getEnv("TRUNK_TRANSPORT"), "UDP").toUpperCase();

  return {
    command: options.command,
    dryRun: parseBool(options.dry_run || options.dryRun || getEnv("FONOSTER_DRY_RUN"), false),
    authMode: firstValue(options.authMode, options["auth-mode"], getEnv("FONOSTER_AUTH_MODE"), "auto").toLowerCase(),
    api: {
      endpoint: firstValue(options.endpoint, getEnv("FONOSTER_API_ENDPOINT"), getEnv("TELEPHONY_BRIDGE_FONOSTER_ENDPOINT"), "envoy:8449"),
      accessKeyId: firstValue(options.accessKeyId, options["access-key-id"], getEnv("FONOSTER_ACCESS_KEY_ID"), getEnv("TELEPHONY_BRIDGE_FONOSTER_ACCESS_KEY_ID"), "WO00000000000000000000000000000000"),
      accessKeySecret: firstValue(options.accessKeySecret, options["access-key-secret"], getEnv("FONOSTER_ACCESS_KEY_SECRET"), getEnv("TELEPHONY_BRIDGE_FONOSTER_ACCESS_KEY_SECRET")),
      username: firstValue(options.username, getEnv("FONOSTER_USERNAME"), getEnv("TELEPHONY_BRIDGE_FONOSTER_USERNAME"), getEnv("APISERVER_OWNER_EMAIL")),
      password: firstValue(options.password, getEnv("FONOSTER_PASSWORD"), getEnv("TELEPHONY_BRIDGE_FONOSTER_PASSWORD"), getEnv("APISERVER_OWNER_PASSWORD")),
      allowInsecure: parseBool(firstValue(options.allowInsecure, options["allow-insecure"], getEnv("FONOSTER_ALLOW_INSECURE"), getEnv("TELEPHONY_BRIDGE_FONOSTER_ALLOW_INSECURE")), true)
    },
    voiceApp: {
      ref: firstValue(options.appRef, options["app-ref"], getEnv("VOICE_RUNTIME_APP_REF"), getEnv("FONOSTER_APP_REF")),
      name: firstValue(options.appName, options["app-name"], getEnv("VOICE_RUNTIME_APP_NAME"), "Onelink Voice Runtime"),
      endpoint: firstValue(options.appEndpoint, options["app-endpoint"], getEnv("VOICE_RUNTIME_APP_ENDPOINT"), "voice-runtime:50062"),
      type: firstValue(options.appType, options["app-type"], getEnv("VOICE_RUNTIME_APP_TYPE"), "EXTERNAL").toUpperCase(),
      sttProductRef: firstValue(options.sttProductRef, options["stt-product-ref"], getEnv("VOICE_RUNTIME_STT_PRODUCT_REF"), "stt.deepgram"),
      sttModel: firstValue(options.sttModel, options["stt-model"], getEnv("VOICE_RUNTIME_STT_MODEL"), "nova-2-phonecall"),
      sttLanguageCode: firstValue(options.sttLanguageCode, options["stt-language-code"], getEnv("VOICE_RUNTIME_STT_LANGUAGE_CODE"), "en-US"),
      ttsProductRef: firstValue(options.ttsProductRef, options["tts-product-ref"], getEnv("VOICE_RUNTIME_TTS_PRODUCT_REF"), "tts.deepgram"),
      ttsVoice: firstValue(options.ttsVoice, options["tts-voice"], getEnv("VOICE_RUNTIME_TTS_VOICE"), "aura-asteria-en")
    },
    voiceAgent: {
      enabled: parseBool(
        firstValue(
          options.agentAppEnabled,
          options["agent-app-enabled"],
          getEnv("VOICE_AGENT_APP_ENABLED")
        ),
        true
      ),
      ref: firstValue(
        options.agentAppRef,
        options["agent-app-ref"],
        getEnv("VOICE_AGENT_APP_REF"),
        getEnv("TELEPHONY_BRIDGE_DEFAULT_AI_APP_REF")
      ),
      name: firstValue(options.agentAppName, options["agent-app-name"], getEnv("VOICE_AGENT_APP_NAME"), "Fonoster AI Voice Agent"),
      endpoint: firstValue(options.agentAppEndpoint, options["agent-app-endpoint"], getEnv("VOICE_AGENT_APP_ENDPOINT"), "test-voiceapp:50061"),
      type: firstValue(options.agentAppType, options["agent-app-type"], getEnv("VOICE_AGENT_APP_TYPE"), "EXTERNAL").toUpperCase(),
      sttProductRef: firstValue(options.agentSttProductRef, options["agent-stt-product-ref"], getEnv("VOICE_AGENT_APP_STT_PRODUCT_REF"), getEnv("VOICE_RUNTIME_STT_PRODUCT_REF"), "stt.deepgram"),
      sttModel: firstValue(options.agentSttModel, options["agent-stt-model"], getEnv("VOICE_AGENT_APP_STT_MODEL"), getEnv("VOICE_RUNTIME_STT_MODEL"), "nova-2-phonecall"),
      sttLanguageCode: firstValue(options.agentSttLanguageCode, options["agent-stt-language-code"], getEnv("VOICE_AGENT_APP_STT_LANGUAGE_CODE"), getEnv("VOICE_RUNTIME_STT_LANGUAGE_CODE"), "en-US"),
      ttsProductRef: firstValue(options.agentTtsProductRef, options["agent-tts-product-ref"], getEnv("VOICE_AGENT_APP_TTS_PRODUCT_REF"), getEnv("VOICE_RUNTIME_TTS_PRODUCT_REF"), "tts.deepgram"),
      ttsVoice: firstValue(options.agentTtsVoice, options["agent-tts-voice"], getEnv("VOICE_AGENT_APP_TTS_VOICE"), getEnv("VOICE_RUNTIME_TTS_VOICE"), "aura-asteria-en")
    },
    operatorAgent: {
      ref: firstValue(options.agentRef, options["agent-ref"], getEnv("VOICE_RUNTIME_OPERATOR_AGENT_REF"), getEnv("LIVE_AGENT_REF")),
      name: firstValue(options.agentName, options["agent-name"], getEnv("VOICE_RUNTIME_OPERATOR_AGENT_NAME"), "Live Voice Operator"),
      username: firstValue(options.agentUsername, options["agent-username"], getEnv("VOICE_RUNTIME_OPERATOR_AGENT_USERNAME")),
      aor: firstValue(options.agentAor, options["agent-aor"], getEnv("VOICE_RUNTIME_OPERATOR_AGENT_AOR"), getEnv("TELEPHONY_BRIDGE_DEFAULT_OPERATOR_AGENT_AOR")),
      privacy: firstValue(options.agentPrivacy, options["agent-privacy"], getEnv("VOICE_RUNTIME_OPERATOR_AGENT_PRIVACY"), "NONE"),
      enabled: parseBool(firstValue(options.agentEnabled, options["agent-enabled"], getEnv("VOICE_RUNTIME_OPERATOR_AGENT_ENABLED")), true),
      maxContacts: parseNumber(firstValue(options.agentMaxContacts, options["agent-max-contacts"], getEnv("VOICE_RUNTIME_OPERATOR_AGENT_MAX_CONTACTS")), -1),
      expires: parseNumber(firstValue(options.agentExpires, options["agent-expires"], getEnv("VOICE_RUNTIME_OPERATOR_AGENT_EXPIRES")), 3600),
      domainRef: firstValue(options.agentDomainRef, options["agent-domain-ref"], getEnv("VOICE_RUNTIME_OPERATOR_AGENT_DOMAIN_REF")),
      credentialsRef: firstValue(options.agentCredentialsRef, options["agent-credentials-ref"], getEnv("VOICE_RUNTIME_OPERATOR_AGENT_CREDENTIALS_REF"))
    },
    trunk: {
      ref: firstValue(options.trunkRef, options["trunk-ref"], getEnv("FONOSTER_TRUNK_REF")),
      name: firstValue(options.trunkName, options["trunk-name"], getEnv("FONOSTER_TRUNK_NAME")),
      sendRegister: parseBool(firstValue(options.trunkSendRegister, options["trunk-send-register"], getEnv("FONOSTER_TRUNK_SEND_REGISTER")), false),
      inboundUri: firstValue(options.trunkInboundUri, options["trunk-inbound-uri"], getEnv("FONOSTER_TRUNK_INBOUND_URI")),
      host: firstValue(options.trunkHost, options["trunk-host"], getEnv("FONOSTER_TRUNK_HOST")),
      port: parseNumber(firstValue(options.trunkPort, options["trunk-port"], getEnv("FONOSTER_TRUNK_PORT")), 5060),
      transport,
      transportUser: firstValue(options.trunkTransportUser, options["trunk-transport-user"], getEnv("FONOSTER_TRUNK_TRANSPORT_USER")),
      uris: parseJsonArray(firstValue(options.trunkUris, options["trunk-uris"] , getEnv("FONOSTER_TRUNK_URIS")), [])
    },
    number: {
      ref: firstValue(options.numberRef, options["number-ref"], getEnv("FONOSTER_DID_REF"), getEnv("INBOUND_NUMBER_REF"), getEnv("VOICE_RUNTIME_INBOUND_NUMBER_REF")),
      telUrl: normalizeTel(firstValue(options.number, options.numberTelUrl, options["number-tel-url"], getEnv("FONOSTER_DID"), getEnv("INBOUND_DID"), getEnv("VOICE_RUNTIME_INBOUND_DID"))),
      name: firstValue(options.numberName, options["number-name"], getEnv("VOICE_RUNTIME_INBOUND_DID_NAME"), getEnv("INBOUND_NUMBER_NAME"), "Inbound number"),
      city: firstValue(options.numberCity, options["number-city"], getEnv("VOICE_RUNTIME_INBOUND_DID_CITY"), getEnv("INBOUND_NUMBER_CITY"), "Unknown"),
      country: firstValue(options.numberCountry, options["number-country"], getEnv("VOICE_RUNTIME_INBOUND_DID_COUNTRY"), getEnv("INBOUND_NUMBER_COUNTRY"), "United States"),
      countryIsoCode: firstValue(options.numberCountryIsoCode, options["number-country-iso"], getEnv("VOICE_RUNTIME_INBOUND_DID_COUNTRY_ISO"), getEnv("INBOUND_NUMBER_COUNTRY_ISO"), "US"),
      routeMode: firstValue(
        options.numberRouteMode,
        options["number-route-mode"],
        getEnv("VOICE_RUNTIME_NUMBER_ROUTE_MODE"),
        getEnv("INBOUND_ROUTE_MODE"),
        getEnv("VOICE_AGENT_ROUTE_MODE"),
        "agent"
      ).toLowerCase()
    },
    call: {
      from: firstValue(options.from, getEnv("CALL_FROM")),
      to: firstValue(options.to, getEnv("CALL_TO")),
      fromNumberRef: firstValue(options.fromNumberRef, options["from-number-ref"], getEnv("CALL_FROM_NUMBER_REF")),
      timeout: parseNumber(firstValue(options.callTimeout, options["call-timeout"], getEnv("CALL_TIMEOUT")), 60)
    },
    token: {
      displayName: firstValue(options.displayName, options["display-name"], getEnv("VOICE_RUNTIME_WEBPHONE_NAME"), "Fonoster Live Voice")
    }
  };
}

function findByRefOrNameOrEndpoint(items, cfg) {
  return (cfg.ref ? items.find((item) => item.ref === cfg.ref) : null)
    || (cfg.name ? items.find((item) => item.name === cfg.name) : null)
    || (cfg.endpoint ? items.find((item) => item.endpoint === cfg.endpoint) : null)
    || null;
}

function routeTargets(mode, cfg) {
  const routeMode = normalizeRouteMode(mode);

  return {
    appRef: routeMode === "operator"
      ? ""
      : routeMode === "clear"
      ? ""
      : (routeMode === "agent" || routeMode === "ai-agent"
        ? (cfg.voiceAgentRef || cfg.voiceAppRef)
        : cfg.voiceAppRef),
    agentAor: routeMode === "operator" ? cfg.operatorAgentAor : ""
  };
}

function normalizeRouteMode(mode) {
  const normalized = (mode || "agent").toLowerCase();
  switch (normalized) {
    case "agent":
    case "ai-agent":
    case "operator":
    case "clear":
    case "ai":
      return normalized;
    case "app":
      return "ai";
    default:
      return "agent";
  }
}

function resolveRouteMode(cfg, mode) {
  const requestedMode = normalizeRouteMode(mode);
  if ((requestedMode === "agent" || requestedMode === "ai-agent") && !cfg.voiceAgent.enabled) {
    return "ai";
  }

  if (requestedMode !== "agent" && requestedMode !== "ai-agent" && requestedMode !== "operator" && requestedMode !== "clear" && requestedMode !== "ai") {
    return "ai";
  }

  return requestedMode;
}

async function authenticate(cfg) {
  const client = new SDK.Client({
    accessKeyId: cfg.api.accessKeyId,
    endpoint: cfg.api.endpoint,
    allowInsecure: cfg.api.allowInsecure
  });

  const requestedMode = cfg.authMode.toLowerCase();

  if (requestedMode === "user") {
    await client.login(cfg.api.username, cfg.api.password);
    return client;
  }

  if ((requestedMode === "apikey" || requestedMode === "api-key") && cfg.api.accessKeySecret) {
    await client.loginWithApiKey(cfg.api.accessKeyId, cfg.api.accessKeySecret);
    return client;
  }

  if (cfg.api.accessKeySecret && cfg.api.accessKeyId) {
    await client.loginWithApiKey(cfg.api.accessKeyId, cfg.api.accessKeySecret);
    return client;
  }

  if (!cfg.api.username || !cfg.api.password) {
    throw new Error("missing auth: provide API key (FONOSTER_ACCESS_KEY_ID + FONOSTER_ACCESS_KEY_SECRET) or username/password");
  }

  await client.login(cfg.api.username, cfg.api.password);
  return client;
}

function shouldProvisionVoiceAgent(cfg) {
  return Boolean(
    cfg.voiceAgent.enabled &&
      (cfg.voiceAgent.ref || cfg.voiceAgent.name || cfg.voiceAgent.endpoint)
  );
}

function resolveVoiceAppRef(existingApp, cfg, section = "voiceApp") {
  const payload = section === "voiceAgent" ? cfg.voiceAgent : cfg.voiceApp;
  if (!existingApp) {
    return payload.ref || "";
  }

  return existingApp.ref || payload.ref || "";
}

async function ensureExternalApplication(apps, cfg, section = "voiceApp", dryRun = false) {
  const payloadCfg = section === "voiceAgent" ? cfg.voiceAgent : cfg.voiceApp;
  const list = await apps.listApplications({ pageSize: 200 });
  const existing = findByRefOrNameOrEndpoint(list.items, payloadCfg);

  const payload = {
    name: payloadCfg.name,
    type: payloadCfg.type,
    endpoint: payloadCfg.endpoint,
    speechToText: {
      productRef: payloadCfg.sttProductRef,
      config: {
        languageCode: payloadCfg.sttLanguageCode,
        model: payloadCfg.sttModel
      }
    },
    textToSpeech: {
      productRef: payloadCfg.ttsProductRef,
      config: {
        voice: payloadCfg.ttsVoice
      }
    }
  };

  if (dryRun) {
    return {
      action: existing ? "preview-update" : "preview-create",
      ref: existing ? existing.ref : "",
      name: payloadCfg.name
    };
  }

  if (existing) {
    await apps.updateApplication({ ...payload, ref: existing.ref });
    return { action: "updated", ref: existing.ref, name: payloadCfg.name };
  }

  const created = await apps.createApplication(payload);
  return { action: "created", ref: created.ref, name: payloadCfg.name };
}

async function ensureVoiceApp(apps, cfg, dryRun = false) {
  return ensureExternalApplication(apps, cfg, "voiceApp", dryRun);
}

async function ensureVoiceAgentApp(apps, cfg, dryRun = false) {
  if (!shouldProvisionVoiceAgent(cfg)) {
    return {
      action: "skipped",
      ref: cfg.voiceAgent.ref || "",
      name: cfg.voiceAgent.name
    };
  }

  return ensureExternalApplication(apps, cfg, "voiceAgent", dryRun);
}

async function resolveVoiceApplicationByMode(applications, cfg, mode) {
  const targetMode = normalizeRouteMode(mode);
  const section = targetMode === "agent" || targetMode === "ai-agent" ? "voiceAgent" : "voiceApp";
  const list = await applications.listApplications({ pageSize: 200 });
  const candidateCfg = section === "voiceAgent" ? cfg.voiceAgent : cfg.voiceApp;
  const existing = findByRefOrNameOrEndpoint(list.items, candidateCfg);
  return resolveVoiceAppRef(existing, cfg, section);
}

async function ensureAgent(agents, cfg, appRef, dryRun = false) {
  if (!cfg.operatorAgent.username) {
    return { action: "skipped", ref: cfg.operatorAgent.ref || "", aor: cfg.operatorAgent.aor || "", name: cfg.operatorAgent.name };
  }

  const list = await agents.listAgents({ pageSize: 200 });
  const existing = (cfg.operatorAgent.ref ? list.items.find((item) => item.ref === cfg.operatorAgent.ref) : null)
    || list.items.find((item) => item.username === cfg.operatorAgent.username)
    || null;

  const basePayload = {
    name: cfg.operatorAgent.name,
    privacy: cfg.operatorAgent.privacy,
    enabled: cfg.operatorAgent.enabled,
    maxContacts: cfg.operatorAgent.maxContacts,
    expires: cfg.operatorAgent.expires
  };
  if (cfg.operatorAgent.domainRef) {
    basePayload.domainRef = cfg.operatorAgent.domainRef;
  }
  if (cfg.operatorAgent.credentialsRef) {
    basePayload.credentialsRef = cfg.operatorAgent.credentialsRef;
  }

  if (dryRun) {
    return {
      action: existing ? "preview-update" : "preview-create",
      ref: existing ? existing.ref : "",
      name: cfg.operatorAgent.name,
      aor: cfg.operatorAgent.aor
    };
  }

  if (existing) {
    await agents.updateAgent({ ...basePayload, ref: existing.ref });
    const current = await agents.getAgent(existing.ref);
    const domainUri = current?.domain?.domainUri;
    const username = current?.username || cfg.operatorAgent.username;
    const fallbackAor = cfg.operatorAgent.aor || (domainUri && username ? `sip:${username}@${domainUri}` : "");
    return { action: "updated", ref: current.ref, name: current.name, aor: fallbackAor };
  }

  const created = await agents.createAgent({ ...basePayload, username: cfg.operatorAgent.username });
  const current = await agents.getAgent(created.ref);
  const domainUri = current?.domain?.domainUri;
  const username = current?.username || cfg.operatorAgent.username;
  const fallbackAor = cfg.operatorAgent.aor || (domainUri && username ? `sip:${username}@${domainUri}` : "");

  return {
    action: "created",
    ref: created.ref,
    name: created.name,
    aor: fallbackAor,
    connectedAppRef: appRef
  };
}

function buildDerivedUris(cfg) {
  if (cfg.trunk.uris && cfg.trunk.uris.length > 0) {
    return cfg.trunk.uris;
  }

  if (!cfg.trunk.host) {
    return [];
  }

  return [
    {
      host: cfg.trunk.host,
      port: cfg.trunk.port,
      transport: cfg.trunk.transport,
      user: cfg.trunk.transportUser,
      weight: 1,
      priority: 1,
      enabled: true
    }
  ];
}

async function ensureTrunk(trunks, cfg, dryRun = false) {
  if (!cfg.trunk.name && !cfg.trunk.ref) {
    return { action: "skipped", ref: "", name: "" };
  }

  const list = await trunks.listTrunks({ pageSize: 200 });
  const existing = (cfg.trunk.ref ? list.items.find((item) => item.ref === cfg.trunk.ref) : null)
    || (cfg.trunk.name ? list.items.find((item) => item.name === cfg.trunk.name) : null)
    || null;

  const uris = buildDerivedUris(cfg);

  const payload = {
    name: cfg.trunk.name,
    sendRegister: cfg.trunk.sendRegister,
    inboundUri: cfg.trunk.inboundUri,
    uris
  };

  if (!payload.inboundUri) {
    throw new Error("trunk requires inbound URI; set FONOSTER_TRUNK_INBOUND_URI or --trunk-inbound-uri");
  }

  if (dryRun) {
    return {
      action: existing ? "preview-update" : "preview-create",
      ref: existing ? existing.ref : "",
      name: cfg.trunk.name
    };
  }

  if (existing) {
    await trunks.updateTrunk({ ...payload, ref: existing.ref });
    return { action: "updated", ref: existing.ref, name: existing.name };
  }

  const created = await trunks.createTrunk(payload);
  return { action: "created", ref: created.ref, name: created.name };
}

async function ensureNumber(numbers, cfg, appRef, operatorAor, trunkRef, dryRun = false) {
  if (!cfg.number.telUrl) {
    return { action: "skipped", ref: "", telUrl: "" };
  }

  const list = await numbers.listNumbers({ pageSize: 200 });
  const existing = (cfg.number.ref ? list.items.find((item) => item.ref === cfg.number.ref) : null)
    || list.items.find((item) => item.telUrl === cfg.number.telUrl)
    || list.items.find((item) => item.telUrl === normalizeTel(cleanNumberFromTelUrl(cfg.number.telUrl)));

  const targets = routeTargets(cfg.number.routeMode, {
    voiceAppRef: appRef,
    voiceAgentRef: cfg.voiceAgentRef,
    operatorAgentAor: operatorAor || cfg.operatorAgent.aor
  });

  if (dryRun) {
    return {
      action: existing ? "preview-update" : "preview-create",
      ref: existing ? existing.ref : "",
      telUrl: cfg.number.telUrl
    };
  }

  if (existing) {
    await numbers.updateNumber({
      ref: existing.ref,
      ...targets,
      trunkRef
    });

    return {
      action: "updated",
      ref: existing.ref,
      telUrl: cfg.number.telUrl
    };
  }

  const created = await numbers.createNumber({
    name: cfg.number.name,
    telUrl: cfg.number.telUrl,
    city: cfg.number.city,
    country: cfg.number.country,
    countryIsoCode: cfg.number.countryIsoCode,
    trunkRef,
    ...targets
  });

  return {
    action: "created",
    ref: created.ref,
    telUrl: cfg.number.telUrl
  };
}

async function resolveOperatorAor(agents, cfg) {
  if (cfg.operatorAgent.aor) {
    return cfg.operatorAgent.aor;
  }

  const list = await agents.listAgents({ pageSize: 200 });
  const resolved = (cfg.operatorAgent.ref ? list.items.find((item) => item.ref === cfg.operatorAgent.ref) : null)
    || (cfg.operatorAgent.username ? list.items.find((item) => item.username === cfg.operatorAgent.username) : null)
    || null;

  if (!resolved) {
    return "";
  }

  if (resolved.aor) {
    return resolved.aor;
  }

  const domainUri = resolved.domain?.domainUri || resolved.domainUri;
  const username = resolved.username || cfg.operatorAgent.username || "";
  return domainUri && username ? `sip:${username}@${domainUri}` : "";
}

async function runBootstrap(cfg) {
  const client = await authenticate(cfg);
  const services = {
    applications: new SDK.Applications(client),
    agents: new SDK.Agents(client),
    trunks: new SDK.Trunks(client),
    numbers: new SDK.Numbers(client)
  };

  const result = {
    action: "bootstrap",
    api: {
      endpoint: cfg.api.endpoint,
      authMode: cfg.api.accessKeySecret ? (cfg.authMode === "auto" ? "apikey" : cfg.authMode) : "user"
    }
  };

  const application = await ensureVoiceApp(services.applications, cfg, cfg.dryRun);
  result.voiceApp = application;

  const voiceAgent = await ensureVoiceAgentApp(services.applications, cfg, cfg.dryRun);
  result.voiceAgent = voiceAgent;

  const operator = await ensureAgent(services.agents, cfg, application.ref, cfg.dryRun);
  result.operatorAgent = operator;

  const trunk = await ensureTrunk(services.trunks, cfg, cfg.dryRun);
  result.trunk = trunk;

  const trunkRef = trunk.ref || "";
  const operatorAor = operator.aor || "";

  const routeMode = resolveRouteMode(cfg, cfg.number.routeMode);
  const resolvedVoiceAgentRef = routeMode === "agent" || routeMode === "ai-agent"
    ? (voiceAgent.ref || application.ref)
    : application.ref;
  const targetCfg = {
    ...cfg,
    number: {
      ...cfg.number,
      routeMode
    },
    voiceAppRef: application.ref,
    voiceAgentRef: routeMode === "agent" || routeMode === "ai-agent" ? resolvedVoiceAgentRef : application.ref,
    operatorAgentAor: operatorAor || cfg.operatorAgent.aor
  };

  const number = await ensureNumber(
    services.numbers,
    targetCfg,
    routeMode === "agent" || routeMode === "ai-agent"
      ? (resolvedVoiceAgentRef || application.ref)
      : application.ref,
    operatorAor,
    trunkRef,
    cfg.dryRun
  );

  if (routeMode === "agent" && !voiceAgent.ref) {
    result.warning = "voice-agent is enabled by route mode, but no explicit agent app is set; fallback to legacy voice app route";
  }

  result.number = number;
  result.routeMode = routeMode;

  if (cfg.dryRun) {
    result.note = "dry run: no objects were changed";
  }

  console.log(JSON.stringify(result, null, 2));
}

async function runBootstrapAgent(cfg) {
  const client = await authenticate(cfg);
  const applications = new SDK.Applications(client);
  const result = {
    action: "bootstrap-agent",
    api: {
      endpoint: cfg.api.endpoint,
      authMode: cfg.api.accessKeySecret ? (cfg.authMode === "auto" ? "apikey" : cfg.authMode) : "user"
    }
  };

  const agentApplication = await ensureVoiceAgentApp(applications, cfg, cfg.dryRun);
  result.voiceAgent = agentApplication;

  if (cfg.dryRun) {
    result.note = "dry run: no objects were changed";
  }

  console.log(JSON.stringify(result, null, 2));
}

async function runStatus(cfg) {
  const client = await authenticate(cfg);
  const applications = new SDK.Applications(client);
  const numbers = new SDK.Numbers(client);
  const trunks = new SDK.Trunks(client);
  const agents = new SDK.Agents(client);
  const calls = new SDK.Calls(client);

  const [applicationList, numberList, trunkList, agentList, callList] = await Promise.all([
    applications.listApplications({ pageSize: 20 }),
    numbers.listNumbers({ pageSize: 20 }),
    trunks.listTrunks({ pageSize: 20 }),
    agents.listAgents({ pageSize: 20 }),
    calls.listCalls({ pageSize: 20 })
  ]);

  console.log(
    JSON.stringify(
      {
        action: "status",
        totals: {
          applications: applicationList.items.length,
          numbers: numberList.items.length,
          trunks: trunkList.items.length,
          agents: agentList.items.length,
          calls: callList.items.length
        },
        samples: {
          applications: applicationList.items.slice(0, 3),
          numbers: numberList.items.slice(0, 3),
          trunks: trunkList.items.slice(0, 3),
          agents: agentList.items.slice(0, 3)
        }
      },
      null,
      2
    )
  );
}

async function runRoute(cfg) {
  const client = await authenticate(cfg);
  const numbers = new SDK.Numbers(client);
  const applications = new SDK.Applications(client);
  const agents = new SDK.Agents(client);
  const list = await numbers.listNumbers({ pageSize: 200 });

  const resolved = list.items.find((item) => item.ref === cfg.number.ref)
    || (cfg.number.telUrl ? list.items.find((item) => item.telUrl === cfg.number.telUrl) : null);

  if (!resolved) {
    throw new Error("number for route change was not found. set --number-ref or --number/--number-tel-url or INBOUND_DID");
  }

  const mode = resolveRouteMode(cfg, cfg.number.routeMode);
  let payload = { ref: resolved.ref };

  if (mode === "operator") {
    payload.agentAor = await resolveOperatorAor(agents, cfg);
    if (!payload.agentAor) {
      throw new Error("operator mode requires agent AOR. set --agent-aor or TELEPHONY_BRIDGE_DEFAULT_OPERATOR_AGENT_AOR");
    }
    payload.appRef = "";
  } else if (mode === "agent" || mode === "ai-agent") {
    payload.appRef = await resolveVoiceApplicationByMode(applications, cfg, mode);
    if (!payload.appRef) {
      throw new Error("agent mode requires voice agent ref. set --agent-app-ref or VOICE_AGENT_APP_REF / VOICE_AGENT_APP_NAME / VOICE_AGENT_APP_ENDPOINT");
    }
    payload.agentAor = "";
  } else if (mode === "ai") {
    payload.appRef = await resolveVoiceApplicationByMode(applications, cfg, mode);
    if (!payload.appRef) {
      throw new Error("ai mode requires voice app ref. set --app-ref or VOICE_RUNTIME_APP_REF / VOICE_RUNTIME_APP_NAME / VOICE_RUNTIME_APP_ENDPOINT");
    }
    payload.agentAor = "";
  } else if (mode === "clear") {
    payload.appRef = "";
    payload.agentAor = "";
  } else {
    throw new Error(`unsupported route mode '${mode}'. use ai|agent|ai-agent|operator|clear`);
  }

  if (cfg.dryRun) {
    console.log(JSON.stringify({ action: "preview-route", numberRef: resolved.ref, ...payload, mode }, null, 2));
    return;
  }

  await numbers.updateNumber(payload);
  console.log(JSON.stringify({ action: "routed", numberRef: resolved.ref, mode }, null, 2));
}

async function runCall(cfg) {
  const client = await authenticate(cfg);
  const calls = new SDK.Calls(client);
  const numbers = new SDK.Numbers(client);
  const applications = new SDK.Applications(client);

  if (!cfg.call.to) {
    throw new Error("outbound call requires --to or CALL_TO");
  }

  let from = cfg.call.from;
  if (!from && cfg.call.fromNumberRef) {
    const resolved = await numbers.getNumber(cfg.call.fromNumberRef);
    from = resolved?.telUrl || "";
    if (!from) {
      throw new Error(`could not resolve caller from numberRef ${cfg.call.fromNumberRef}`);
    }
  }

  if (!from) {
    throw new Error("outbound call requires --from, --from-number-ref or CALL_FROM");
  }

  const routeMode = resolveRouteMode(cfg, cfg.number.routeMode);
  const appRef = routeMode === "agent" || routeMode === "ai-agent"
    ? await resolveVoiceApplicationByMode(applications, cfg, routeMode)
    : (routeMode === "ai" ? await resolveVoiceApplicationByMode(applications, cfg, routeMode) : undefined);
  if (routeMode === "operator" || routeMode === "clear") {
    throw new Error("outbound call does not support operator/clear mode. use ai, agent or ai-agent");
  }

  if ((routeMode === "agent" || routeMode === "ai-agent") && !appRef) {
    throw new Error("outbound call in agent mode requires voice agent ref. set --agent-app-ref or VOICE_AGENT_APP_REF / VOICE_AGENT_APP_NAME / VOICE_AGENT_APP_ENDPOINT");
  }
  if (routeMode === "ai" && !appRef) {
    throw new Error("outbound call in ai mode requires app ref. set --app-ref or VOICE_RUNTIME_APP_REF / VOICE_RUNTIME_APP_NAME / VOICE_RUNTIME_APP_ENDPOINT");
  }
  const body = {
    from,
    to: cfg.call.to,
    timeout: cfg.call.timeout,
    ...(appRef ? { appRef } : {}),
    metadata: {
      requestedBy: "fonoster-control.js"
    }
  };

  const created = await calls.createCall(body);
  console.log(JSON.stringify({ action: "outbound-call-created", ref: created.ref, from, to: cfg.call.to }, null, 2));
}

async function runToken(cfg) {
  const client = await authenticate(cfg);
  const applications = new SDK.Applications(client);

  const token = await applications.createTestToken();
  console.log(JSON.stringify({
    action: "test-token",
    displayName: cfg.token.displayName,
    token: token.token || token,
    targetAor: token.targetAor || token.username || "",
    signalingServer: token.signalingServer || "",
    domain: token.domain || ""
  }, null, 2));
}

function printHelp() {
  console.log(`\nUsage:\n  node fonoster-control.js <command> [--key value]\n\nCommands:\n  bootstrap            Create/update voice app, ai-agent app, trunk and number\n  bootstrap-agent      Create/update only AI voice agent app\n  status               Show counts and recent entities\n  route                Update route mode for number (ai|agent|ai-agent|operator|clear)\n  call                 Place outbound API test call (from --from/--from-number-ref to --to)\n  token                Create a SIP/WebSocket test token\n  help                 Print this message\n\nCommon env vars:\n  FONOSTER_API_ENDPOINT, FONOSTER_ACCESS_KEY_ID, FONOSTER_ACCESS_KEY_SECRET\n  TELEPHONY_BRIDGE_FONOSTER_ENDPOINT, TELEPHONY_BRIDGE_FONOSTER_ACCESS_KEY_ID, TELEPHONY_BRIDGE_FONOSTER_ALLOW_INSECURE\n  FONOSTER_USERNAME / FONOSTER_PASSWORD (or TELEPHONY_BRIDGE_FONOSTER_USERNAME / TELEPHONY_BRIDGE_FONOSTER_PASSWORD)\n\nOptional provisioning vars:\n  VOICE_RUNTIME_APP_NAME, VOICE_RUNTIME_APP_ENDPOINT, VOICE_RUNTIME_APP_REF\n  VOICE_AGENT_APP_NAME, VOICE_AGENT_APP_ENDPOINT, VOICE_AGENT_APP_REF, VOICE_AGENT_APP_ENABLED\n  VOICE_RUNTIME_OPERATOR_AGENT_USERNAME, VOICE_RUNTIME_OPERATOR_AGENT_AOR\n  FONOSTER_TRUNK_NAME, FONOSTER_TRUNK_INBOUND_URI, FONOSTER_TRUNK_HOST\n  INBOUND_DID, INBOUND_DID_COUNTRY_ISO, INBOUND_ROUTE_MODE (agent|ai-agent|ai|operator|clear)\n`);
}

async function main() {
  const { command, options } = parseCommandArgv(process.argv.slice(2));
  const cfg = buildConfig({ ...options, command });

  if (command === "help" || command === "-h" || command === "--help") {
    printHelp();
    return;
  }

  if (command === "bootstrap") {
    await runBootstrap(cfg);
    return;
  }

  if (command === "bootstrap-agent") {
    await runBootstrapAgent(cfg);
    return;
  }

  if (command === "status") {
    await runStatus(cfg);
    return;
  }

  if (command === "route") {
    await runRoute(cfg);
    return;
  }

  if (command === "call") {
    await runCall(cfg);
    return;
  }

  if (command === "token") {
    await runToken(cfg);
    return;
  }

  printHelp();
}

main().catch((error) => {
  const info = {
    error: error?.message || String(error)
  };
  console.error(JSON.stringify(info, null, 2));
  process.exit(1);
});
