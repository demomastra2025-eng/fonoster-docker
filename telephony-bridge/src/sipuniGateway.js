const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");
const { config } = require("./config");
const { logger } = require("./logger");

const configDir =
  process.env.TELEPHONY_BRIDGE_ASTERISK_CONFIG_DIR ||
  "/fonoster-asterisk-config";
const pjsipConfigPath =
  process.env.TELEPHONY_BRIDGE_SIPUNI_PJSIP_CONFIG_PATH ||
  path.join(configDir, "pjsip_sipuni.conf");
const extensionsConfigPath =
  process.env.TELEPHONY_BRIDGE_SIPUNI_EXTENSIONS_CONFIG_PATH ||
  path.join(configDir, "extensions.conf");
const registryPath =
  process.env.TELEPHONY_BRIDGE_SIPUNI_GATEWAY_REGISTRY_PATH ||
  path.join(configDir, "sipuni_gateways.json");

const MANAGED_PREFIX = "; BEGIN ONELINK MANAGED SIPUNI ";
const MANAGED_SUFFIX = "; END ONELINK MANAGED SIPUNI ";
const DEFAULT_HOST = "ats01.kz.sipuni.com";
const DEFAULT_PORT = 5060;
const DEFAULT_TRANSPORT = "udp";
const RELOAD_MODULES = [
  "res_pjsip.so",
  "res_pjsip_outbound_registration.so",
  "pbx_config.so"
];

let pool;
let registryCache = {
  mtimeMs: 0,
  entries: []
};

function getPool() {
  if (pool) return pool;
  if (!config.routr.databaseUrl) {
    throw new Error("TELEPHONY_BRIDGE_ROUTR_DATABASE_URL is not configured");
  }
  pool = new Pool({ connectionString: config.routr.databaseUrl });
  return pool;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const normalized = String(value).trim();
    if (normalized) return normalized;
  }
  return "";
}

function required(value, name) {
  const normalized = firstNonEmpty(value);
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function oneLine(value, name) {
  const normalized = String(value || "").trim();
  if (/[\r\n;]/.test(normalized)) {
    throw new Error(`${name} contains unsupported characters`);
  }
  return normalized;
}

function asteriskIdentifier(value, fallback) {
  const normalized = firstNonEmpty(value, fallback).replace(/[^A-Za-z0-9_-]/g, "-");
  return normalized || "gateway";
}

function markerIdFor(payload) {
  return asteriskIdentifier(
    payload.providerAccountNumber || payload.username || payload.gatewayRef,
    payload.numberRef
  );
}

function sectionBaseFor(markerId) {
  return `sipuni-onelink-${markerId}`;
}

async function readText(filePath) {
  try {
    return await fsp.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

async function writeTextPreservingMount(filePath, content) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

function stripManagedBlock(content, markerId) {
  const begin = `${MANAGED_PREFIX}${markerId}`;
  const end = `${MANAGED_SUFFIX}${markerId}`;
  const lines = String(content || "").split(/\r?\n/);
  const output = [];
  let skipping = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === begin) {
      skipping = true;
      continue;
    }
    if (skipping && trimmed === end) {
      skipping = false;
      continue;
    }
    if (!skipping) output.push(line);
  }

  return output.join("\n").replace(/\n{3,}$/g, "\n\n");
}

function upsertManagedBlock(content, markerId, block) {
  const stripped = stripManagedBlock(content, markerId).trimEnd();
  return `${stripped}\n\n${block.trimEnd()}\n`;
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, entry]) => entry !== undefined && entry !== null && entry !== "")
  );
}

async function credentialsFor(ref) {
  if (!ref) return null;
  const result = await getPool().query(
    "select ref, name, username, password from credentials where ref = $1 limit 1",
    [ref]
  );
  return result.rows[0] || null;
}

function normalizeGatewayPayload(input = {}) {
  const metadata = input.metadata && typeof input.metadata === "object" ? input.metadata : {};
  const numberRef = required(
    firstNonEmpty(input.numberRef, input.number_ref, input.ref, input.gatewayRef, input.gateway_ref),
    "numberRef"
  );
  const providerAccountNumber = required(
    firstNonEmpty(
      input.providerAccountNumber,
      input.provider_account_number,
      input.username,
      metadata.provider_account_number,
      metadata.providerAccountNumber
    ),
    "providerAccountNumber"
  );
  const host = firstNonEmpty(input.host, metadata.host, DEFAULT_HOST);
  const port = Number(firstNonEmpty(input.port, metadata.port, DEFAULT_PORT)) || DEFAULT_PORT;
  const transport = firstNonEmpty(input.transport, metadata.transport, DEFAULT_TRANSPORT).toLowerCase();
  const markerId = markerIdFor({ ...input, providerAccountNumber, numberRef });
  const sectionBase = sectionBaseFor(markerId);

  return {
    gatewayRef: firstNonEmpty(input.gatewayRef, input.gateway_ref, input.ref, numberRef),
    numberRef,
    providerAccountNumber,
    username: providerAccountNumber,
    host,
    port,
    transport,
    credentialsRef: firstNonEmpty(input.credentialsRef, input.credentials_ref, metadata.credentialsRef, metadata.credentials_ref),
    ingressNumber: firstNonEmpty(input.ingressNumber, input.ingress_number, metadata.ingress_number, metadata.ingressNumber),
    displayPhoneNumber: firstNonEmpty(input.displayPhoneNumber, input.display_phone_number, metadata.display_phone_number),
    appRef: firstNonEmpty(input.appRef, input.app_ref, metadata.appRef, metadata.app_ref, config.defaults.runtimeAppRef),
    accountId: firstNonEmpty(input.accountId, input.account_id, metadata.onelink_account_id),
    inboxId: firstNonEmpty(input.inboxId, input.inbox_id, metadata.onelink_inbox_id),
    channelId: firstNonEmpty(input.channelId, input.channel_id, metadata.onelink_channel_id),
    callerId: firstNonEmpty(input.callerId, input.caller_id, config.asterisk?.sipuniOutboundCallerId, "207"),
    onelinkBaseUrl: firstNonEmpty(input.onelinkBaseUrl, input.onelink_base_url, metadata.onelinkBaseUrl, metadata.onelink_base_url),
    markerId,
    endpointName: `${sectionBase}-endpoint`,
    contextName: `from-sipuni-onelink-${markerId}`,
    authName: `${sectionBase}-auth`,
    aorName: `${sectionBase}-aor`,
    registrationName: `${sectionBase}-registration`,
    metadata
  };
}

function pjsipBlockFor(gateway, password) {
  const username = oneLine(gateway.username, "username");
  const safePassword = oneLine(password, "password");
  const host = oneLine(gateway.host, "host");
  const transport = oneLine(gateway.transport, "transport");
  const fromDomain = host;

  return `
${MANAGED_PREFIX}${gateway.markerId}
[${gateway.authName}]
type = auth
auth_type = userpass
username = ${username}
password = ${safePassword}

[${gateway.aorName}]
type = aor
contact = sip:${host}:${gateway.port}
qualify_frequency = 60
qualify_timeout = 3.0

[${gateway.endpointName}]
type = endpoint
transport = transport-sipuni-${transport}
context = ${gateway.contextName}
disallow = all
allow = alaw,ulaw,g722
outbound_auth = ${gateway.authName}
aors = ${gateway.aorName}
from_user = ${username}
from_domain = ${fromDomain}
timers = no
direct_media = no
rtp_symmetric = yes
force_rport = yes
rewrite_contact = yes
trust_id_inbound = yes
trust_id_outbound = yes
send_pai = yes
send_rpid = yes
dtmf_mode = rfc4733

[${gateway.registrationName}]
type = registration
transport = transport-sipuni-${transport}
outbound_auth = ${gateway.authName}
server_uri = sip:${host}:${gateway.port}
client_uri = sip:${username}@${host}
contact_user = ${username}
endpoint = ${gateway.endpointName}
line = yes
retry_interval = 10
forbidden_retry_interval = 60
expiration = 300
max_retries = 1000000
${MANAGED_SUFFIX}${gateway.markerId}
`;
}

function extensionsBlockFor(gateway) {
  const metadata = compactObject({
    source: "sipuni",
    source_id: `sipuni:${gateway.providerAccountNumber}`,
    number_ref: gateway.numberRef,
    chatwoot_inbox_id: gateway.inboxId,
    onelink_account_id: gateway.accountId,
    routeMode: "internal_asterisk_gateway",
    ...gateway.metadata
  });
  const ingress = firstNonEmpty(gateway.ingressNumber, gateway.displayPhoneNumber, gateway.providerAccountNumber);
  const display = firstNonEmpty(gateway.displayPhoneNumber, ingress);
  const metadataJson = JSON.stringify(metadata);

  return `
${MANAGED_PREFIX}${gateway.markerId}
[${gateway.contextName}]
exten => handle,1,NoOp(OneLink Sipuni inbound ${gateway.providerAccountNumber} via internal Fonoster Asterisk: \${EXTEN} from \${CALLERID(num)})
  same => n,Set(APP_REF=${gateway.appRef})
  same => n,Set(INGRESS_NUMBER=${ingress})
  same => n,Set(CALL_DIRECTION=from-pstn)
  same => n,Set(FONOSTER_RECORDING=on)
  same => n,Set(ONELINK_ACCOUNT_ID=${gateway.accountId})
  same => n,Set(ONELINK_MODE=operator)
  same => n,Set(ONELINK_NUMBER_REF=${gateway.numberRef})
  same => n,Set(METADATA=${metadataJson})
  same => n,GoSub(local-ctx-common,start,1)
  same => n,Hangup()
exten => _+X.,1,Goto(handle,1)
exten => _X.,1,Goto(handle,1)
exten => s,1,Goto(handle,1)
exten => ${gateway.providerAccountNumber},1,Goto(handle,1)
exten => ${ingress},1,Goto(handle,1)
exten => ${display},1,Goto(handle,1)
${MANAGED_SUFFIX}${gateway.markerId}
`;
}

function readRegistryEntriesSync() {
  try {
    const stat = fs.statSync(registryPath);
    if (stat.mtimeMs === registryCache.mtimeMs) {
      return registryCache.entries;
    }
    const parsed = JSON.parse(fs.readFileSync(registryPath, "utf8"));
    const entries = Array.isArray(parsed) ? parsed : Array.isArray(parsed.gateways) ? parsed.gateways : [];
    registryCache = { mtimeMs: stat.mtimeMs, entries };
    return entries;
  } catch {
    registryCache = { mtimeMs: 0, entries: [] };
    return [];
  }
}

async function readRegistryEntries() {
  try {
    const parsed = JSON.parse(await fsp.readFile(registryPath, "utf8"));
    return Array.isArray(parsed) ? parsed : Array.isArray(parsed.gateways) ? parsed.gateways : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function writeRegistryEntries(entries) {
  const payload = {
    managedBy: "onelink",
    updatedAt: new Date().toISOString(),
    gateways: entries
  };
  await writeTextPreservingMount(registryPath, `${JSON.stringify(payload, null, 2)}\n`);
  registryCache = { mtimeMs: 0, entries };
}

function publicGatewayEntry(gateway) {
  return compactObject({
    ref: gateway.gatewayRef,
    gatewayRef: gateway.gatewayRef,
    numberRef: gateway.numberRef,
    providerAccountNumber: gateway.providerAccountNumber,
    endpointName: gateway.endpointName,
    contextName: gateway.contextName,
    registrationName: gateway.registrationName,
    ingressNumber: gateway.ingressNumber,
    displayPhoneNumber: gateway.displayPhoneNumber,
    host: gateway.host,
    port: gateway.port,
    transport: gateway.transport,
    appRef: gateway.appRef,
    accountId: gateway.accountId,
    inboxId: gateway.inboxId,
    channelId: gateway.channelId,
    callerId: gateway.callerId,
    onelinkBaseUrl: gateway.onelinkBaseUrl,
    metadata: gateway.metadata,
    markerId: gateway.markerId,
    updatedAt: new Date().toISOString()
  });
}

async function updateRegistry(gateway) {
  const entries = await readRegistryEntries();
  const nextEntry = publicGatewayEntry(gateway);
  const next = entries
    .filter((entry) =>
      entry.numberRef !== gateway.numberRef &&
      entry.gatewayRef !== gateway.gatewayRef &&
      entry.providerAccountNumber !== gateway.providerAccountNumber
    )
    .concat(nextEntry);
  await writeRegistryEntries(next);
  return nextEntry;
}

async function removeRegistryEntry(gatewayRef) {
  const entries = await readRegistryEntries();
  const next = entries.filter((entry) =>
    entry.numberRef !== gatewayRef &&
    entry.gatewayRef !== gatewayRef &&
    entry.ref !== gatewayRef &&
    entry.providerAccountNumber !== gatewayRef &&
    entry.markerId !== gatewayRef
  );
  await writeRegistryEntries(next);
  return entries.length !== next.length;
}

function gatewayByNumberRef(numberRef) {
  const normalized = firstNonEmpty(numberRef);
  if (!normalized) return null;
  return readRegistryEntriesSync().find((entry) => entry.numberRef === normalized) || null;
}

function hasGateway(numberRef) {
  return Boolean(gatewayByNumberRef(numberRef));
}

async function reloadAsterisk() {
  if (!config.asterisk?.ariBaseUrl || !config.asterisk?.ariUsername || !config.asterisk?.ariSecret) {
    throw new Error("Asterisk ARI credentials are not configured");
  }

  const baseUrl = String(config.asterisk.ariBaseUrl).replace(/\/+$/, "");
  const authorization = `Basic ${Buffer.from(`${config.asterisk.ariUsername}:${config.asterisk.ariSecret}`).toString("base64")}`;
  const results = [];

  for (const moduleName of RELOAD_MODULES) {
    const response = await fetch(`${baseUrl}/asterisk/modules/${encodeURIComponent(moduleName)}`, {
      method: "PUT",
      headers: { Authorization: authorization }
    });
    const text = await response.text();
    if (!response.ok && response.status !== 409) {
      throw new Error(`Asterisk reload ${moduleName} failed: HTTP ${response.status} ${text}`);
    }
    results.push({ moduleName, status: response.status });
  }

  return results;
}

async function upsertSipuniGateway(rawPayload = {}) {
  const gateway = normalizeGatewayPayload(rawPayload);
  const credential = await credentialsFor(gateway.credentialsRef);
  const password = firstNonEmpty(rawPayload.password, credential?.password);
  if (!password) {
    throw new Error("Sipuni credentials password is required");
  }

  const pjsipContent = await readText(pjsipConfigPath);
  const extensionsContent = await readText(extensionsConfigPath);
  await writeTextPreservingMount(
    pjsipConfigPath,
    upsertManagedBlock(pjsipContent, gateway.markerId, pjsipBlockFor(gateway, password))
  );
  await writeTextPreservingMount(
    extensionsConfigPath,
    upsertManagedBlock(extensionsContent, gateway.markerId, extensionsBlockFor(gateway))
  );
  const registryEntry = await updateRegistry(gateway);
  const reload = await reloadAsterisk();

  logger.info("upserted Sipuni Asterisk gateway", {
    gatewayRef: gateway.gatewayRef,
    numberRef: gateway.numberRef,
    providerAccountNumber: gateway.providerAccountNumber,
    endpointName: gateway.endpointName
  });

  return {
    ok: true,
    ref: gateway.gatewayRef,
    gateway: registryEntry,
    reload
  };
}

async function deleteSipuniGateway(gatewayRef) {
  const ref = required(gatewayRef, "gatewayRef");
  const entries = await readRegistryEntries();
  const entry = entries.find((candidate) =>
    candidate.numberRef === ref ||
    candidate.gatewayRef === ref ||
    candidate.ref === ref ||
    candidate.providerAccountNumber === ref ||
    candidate.markerId === ref
  );
  const markerId = entry?.markerId || markerIdFor({ gatewayRef: ref, numberRef: ref });

  const pjsipContent = await readText(pjsipConfigPath);
  const extensionsContent = await readText(extensionsConfigPath);
  await writeTextPreservingMount(pjsipConfigPath, stripManagedBlock(pjsipContent, markerId));
  await writeTextPreservingMount(extensionsConfigPath, stripManagedBlock(extensionsContent, markerId));
  const registryDeleted = await removeRegistryEntry(ref);
  const reload = await reloadAsterisk();

  logger.info("deleted Sipuni Asterisk gateway", {
    gatewayRef: ref,
    markerId,
    registryDeleted
  });

  return {
    ok: true,
    deleted: ref,
    markerId,
    registryDeleted,
    reload
  };
}

module.exports = {
  upsertSipuniGateway,
  deleteSipuniGateway,
  gatewayByNumberRef,
  hasGateway
};
