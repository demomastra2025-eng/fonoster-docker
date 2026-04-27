const { Pool } = require("pg");
const { config } = require("./config");
const { logger } = require("./logger");

const APP_REF_HEADER = "x-app-ref";
const ROUTR_DEFAULT_PEER_AOR = "sip:voice@default";
const SIP_AOR_PATTERN = /^sip:([^@]+)@([^;>\s]+)$/i;

let pool;

function getPool() {
  if (pool) return pool;
  if (!config.routr.databaseUrl) {
    throw new Error("TELEPHONY_BRIDGE_ROUTR_DATABASE_URL is not configured");
  }

  pool = new Pool({
    connectionString: config.routr.databaseUrl
  });

  return pool;
}

async function getNumberRoute(numberRef) {
  const result = await getPool().query(
    `
      select
        ref,
        aor_link,
        extra_headers,
        extended
      from numbers
      where ref = $1
      limit 1
    `,
    [numberRef]
  );

  return result.rows[0] || null;
}

function parseSipAor(value) {
  const normalized = String(value || "").trim();
  const match = normalized.match(SIP_AOR_PATTERN);
  if (!match) return null;

  return {
    aor: normalized,
    username: match[1].toLowerCase(),
    domain: match[2].toLowerCase()
  };
}

async function assertOperatorAorExists(agentAor) {
  const parsed = parseSipAor(agentAor);
  if (!parsed) {
    throw new Error("agent_aor must be a valid SIP URI");
  }

  const peerResult = await getPool().query(
    `
      select 'peer' as resource_type
      from peers
      where lower(aor) = lower($1)
        and enabled = true
      limit 1
    `,
    [parsed.aor]
  );

  if (peerResult.rowCount > 0) {
    return peerResult.rows[0];
  }

  const agentResult = await getPool().query(
    `
      select 'agent' as resource_type
      from agents
      join domains on domains.ref = agents.domain_ref
      where lower(agents.username) = $1
        and lower(domains.domain_uri) = $2
        and agents.enabled = true
      limit 1
    `,
    [parsed.username, parsed.domain]
  );

  if (agentResult.rowCount > 0) {
    return agentResult.rows[0];
  }

  throw new Error(
    `agent_aor target not found in Routr: ${parsed.aor}`
  );
}

async function updateNumberRouteInRoutr({
  numberRef,
  mode,
  appRef,
  agentAor,
  accessKeyId
}) {
  let aorLink = null;
  let extraHeaders = null;
  const normalizedMode = mode === "agent" || mode === "ai-agent" ? "ai" : mode;

  if (normalizedMode === "ai" || normalizedMode === "app") {
    if (!appRef) throw new Error("app_ref is required");
    aorLink = ROUTR_DEFAULT_PEER_AOR;
    extraHeaders = JSON.stringify([{ name: APP_REF_HEADER, value: appRef }]);
  } else if (normalizedMode === "operator") {
    if (!agentAor) throw new Error("agent_aor is required");
    await assertOperatorAorExists(agentAor);
    aorLink = agentAor;
    extraHeaders = null;
  } else if (normalizedMode === "clear") {
    aorLink = null;
    extraHeaders = null;
  } else {
    throw new Error("unsupported mode");
  }

  const result = await getPool().query(
    `
      update numbers
      set
        aor_link = $2,
        extra_headers = $3::jsonb,
        updated_at = now()
      where
        ref = $1
        and (
          $4 = ''
          or extended->>'accessKeyId' = $4
        )
      returning ref, aor_link, extra_headers, updated_at
    `,
    [numberRef, aorLink, extraHeaders, accessKeyId || ""]
  );

  if (result.rowCount !== 1) {
    throw new Error("number route update did not affect exactly one row");
  }

  logger.info("updated number route through routr db fallback", {
    numberRef,
    mode,
    aorLink
  });

  return result.rows[0];
}

module.exports = {
  getNumberRoute,
  updateNumberRouteInRoutr
};
