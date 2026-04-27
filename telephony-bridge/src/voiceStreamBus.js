const { EventEmitter } = require("node:events");
const { randomUUID } = require("node:crypto");
const { Client, Pool } = require("pg");
const { config } = require("./config");
const { logger } = require("./logger");

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

function boundedInteger(value, fallback, min, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return min;
  return Math.min(parsed, max);
}

const streamConfig = config.stream || {};
const EVENTS_MAX_HISTORY = boundedInteger(streamConfig.maxHistory, 500, 25, 2000);
const HEARTBEAT_MS = Math.max(500, boundedInteger(streamConfig.heartbeatMs, 10000, 500));
const MAX_LONG_POLL_MS = boundedInteger(
  streamConfig.maxLongPollMs,
  30000,
  250,
  120000
);
const EVENT_DEDUP_TTL_MS = Math.max(
  1000,
  boundedInteger(streamConfig.dedupTtlMs, 120000, 1000)
);
const RETENTION_HOURS = Math.max(1, boundedInteger(streamConfig.retentionHours, 24, 1));
const EVENT_ID_KEY = "idempotency_key";
const TABLE_NAME = sanitizeDbIdentifier(streamConfig.tableName, "telephony_voice_events");
const LISTEN_CHANNEL_NAME = sanitizeDbIdentifierName(
  streamConfig.listenChannel,
  "telephony_voice_events"
);
const LISTEN_CHANNEL = quoteIdent(LISTEN_CHANNEL_NAME);
const DATABASE_URL = streamConfig.databaseUrl || "";
const PG_MAX_CONNECTIONS = boundedInteger(streamConfig.pgMaxConnections, 4, 1, 32);

let sequence = 0;
let initialized = false;
let initializing = null;
let persistenceEnabled = false;
let pool = null;
let listenClient = null;
let listenerReady = false;
let lastCleanupAt = 0;
const retentionMs = RETENTION_HOURS * 60 * 60 * 1000;
const instanceId = randomUUID();
const history = [];
const dedupeByKey = new Map();

const DEFAULT_DDL_COLUMNS = `
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL,
  call_ref TEXT NOT NULL DEFAULT '',
  media_session_ref TEXT NOT NULL DEFAULT '',
  number_ref TEXT NOT NULL DEFAULT '',
  account_id TEXT NOT NULL DEFAULT '',
  request_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  source_event_id TEXT NOT NULL DEFAULT '',
  idempotency_key TEXT NOT NULL DEFAULT '',
  dedupe_key TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
`;

const DEFAULT_DDL = `
CREATE TABLE IF NOT EXISTS ${TABLE_NAME} (
${DEFAULT_DDL_COLUMNS}
);
CREATE UNIQUE INDEX IF NOT EXISTS telephony_voice_events_dedupe_key_uq
ON ${TABLE_NAME} (dedupe_key)
WHERE dedupe_key IS NOT NULL AND dedupe_key <> '';
CREATE INDEX IF NOT EXISTS telephony_voice_events_ts_idx
ON ${TABLE_NAME} (ts DESC);
CREATE INDEX IF NOT EXISTS telephony_voice_events_call_ref_idx
ON ${TABLE_NAME} (call_ref);
CREATE INDEX IF NOT EXISTS telephony_voice_events_event_type_idx
ON ${TABLE_NAME} (event_type);
CREATE INDEX IF NOT EXISTS telephony_voice_events_number_ref_idx
ON ${TABLE_NAME} (number_ref);
CREATE INDEX IF NOT EXISTS telephony_voice_events_media_session_ref_idx
ON ${TABLE_NAME} (media_session_ref);
CREATE INDEX IF NOT EXISTS telephony_voice_events_account_id_idx
ON ${TABLE_NAME} (account_id);
`;

function sanitizeDbIdentifier(value, fallback) {
  return quoteIdent(sanitizeDbIdentifierName(value, fallback));
}

function sanitizeDbIdentifierName(value, fallback) {
  const raw = String(value || "").trim();
  const normalized = raw.replace(/[^a-zA-Z0-9_]/g, "_").replace(
    /^(\d)/,
    "_$1"
  );
  return normalized.length > 0 ? normalized : fallback;
}

function quoteIdent(raw) {
  return `"${String(raw).replace(/"/g, '""')}"`;
}

function parseIntLike(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toIso(value) {
  if (!value) return new Date().toISOString();
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function toSet(value) {
  if (Array.isArray(value)) {
    return new Set(
      value
        .filter((entry) => entry !== undefined && entry !== null)
        .map((entry) => String(entry).trim())
        .filter(Boolean)
    );
  }

  if (typeof value === "string") {
    return new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
    );
  }

  return new Set();
}

function normalizeEnvelope(raw) {
  const event = raw && typeof raw === "object" ? raw : {};
  const callRef = event.callRef || event.call_ref || "";
  const mediaSessionRef = event.mediaSessionRef || event.media_session_ref || "";
  const eventType = event.eventType || event.event || event.event_type || "voice_event";
  const numberRef =
    event.numberRef || event.number_ref || event.ingressNumberRef || "";
  const eventId = event.id || event.eventId || event.event_id || "";
  const idempotencyKey = event.idempotencyKey || event[EVENT_ID_KEY] || "";
  const accountId = event.accountId || event.account_id || event.account || "";
  const requestId = event.requestId || event.request_id || "";

  return {
    ts: toIso(event.ts),
    callRef,
    mediaSessionRef,
    numberRef,
    accountId,
    requestId,
    eventType,
    source: event.source || "voice-runtime",
    sourceEventId: eventId || "",
    idempotencyKey: String(idempotencyKey || ""),
    dedupeKey: String(idempotencyKey || eventId || "").trim(),
    data: {
      ...event,
      callRef,
      mediaSessionRef,
      numberRef,
      accountId,
      requestId,
      eventType,
      idempotencyKey: String(idempotencyKey || ""),
      sourceEventId: eventId || ""
    }
  };
}

function withSeq(normalized) {
  const seq = ++sequence;
  return {
    ...normalized,
    id: String(seq),
    seq
  };
}

function buildDedupeKey(normalized) {
  return normalized.dedupeKey || `${normalized.seq}:${normalized.callRef}:${normalized.eventType}`;
}

function cleanupHistory(now = Date.now()) {
  for (const [key, item] of dedupeByKey.entries()) {
    if (now - item.timestamp > EVENT_DEDUP_TTL_MS) {
      dedupeByKey.delete(key);
    }
  }

  while (history.length > EVENTS_MAX_HISTORY) {
    history.shift();
  }
}

function applyInMemory(event, { emit = true } = {}) {
  const normalized = emit ? { ...event } : event;
  const dedupeKey = buildDedupeKey(normalized);
  const existing = dedupeByKey.get(dedupeKey);
  const now = Date.now();

  if (existing && now - existing.timestamp <= EVENT_DEDUP_TTL_MS) {
    return existing.event;
  }

  const withSeqEvent = normalized.seq ? normalized : withSeq(normalized);

  cleanupHistory(now);
  history.push(withSeqEvent);
  dedupeByKey.set(buildDedupeKey(withSeqEvent), {
    event: withSeqEvent,
    timestamp: now
  });
  sequence = Math.max(sequence, withSeqEvent.seq);

  if (emit) {
    emitter.emit("voice_event", withSeqEvent);
  }

  return withSeqEvent;
}

function parseFilters(filters = {}) {
  const callRefs = toSet(filters.callRef);
  const eventTypes = toSet(filters.eventType);
  const numberRefs = toSet(filters.numberRef || filters.numberRefs || filters.number_ref || filters.number_refs);
  const mediaSessionRefs = toSet(
    filters.mediaSessionRef ||
      filters.media_session_ref ||
      filters.mediaSessionRefs ||
      filters.media_session_refs
  );
  const accountRefs = toSet(filters.accountId || filters.account_id || filters.accountIds);
  const eventIdSet = new Set(
    toSet(filters.eventId || filters.id || filters.event_ids || filters.eventIds)
  );

  return (event) => {
    if (callRefs.size && !callRefs.has(event.callRef)) return false;
    if (numberRefs.size && !numberRefs.has(event.numberRef)) return false;
    if (
      mediaSessionRefs.size &&
      !mediaSessionRefs.has(event.mediaSessionRef || "")
    ) {
      return false;
    }
    if (accountRefs.size && !accountRefs.has(event.accountId || "")) return false;
    if (eventIdSet.size) {
      if (
        !eventIdSet.has(event.id) &&
        !eventIdSet.has(String(event.seq)) &&
        !eventIdSet.has(event.sourceEventId || "") &&
        !eventIdSet.has(event.dedupeKey || "")
      ) {
        return false;
      }
    }
    if (eventTypes.size && !eventTypes.has(event.eventType)) return false;
    return true;
  };
}

function listRecentFromMemory({
  sinceMs = 0,
  sinceId = 0,
  callRef,
  eventType,
  numberRef,
  mediaSessionRef,
  accountId,
  eventId,
  limit = 0
} = {}) {
  const sinceMsValue = parseIntLike(sinceMs) || 0;
  const sinceIdValue = parseIntLike(sinceId) || 0;
  const callRefs = toSet(callRef);
  const eventTypes = toSet(eventType);
  const numberRefs = toSet(numberRef);
  const mediaSessionRefs = toSet(mediaSessionRef);
  const accountRefs = toSet(accountId);
  const eventIdSet = toSet(eventId);

  const filtered = history.filter((item) => {
    const created = Date.parse(item.ts);
    if (sinceIdValue && item.seq <= sinceIdValue) return false;
    if (sinceMsValue && (Number.isNaN(created) || created < sinceMsValue)) return false;
    if (callRefs.size && !callRefs.has(item.callRef)) return false;
    if (eventTypes.size && !eventTypes.has(item.eventType)) return false;
    if (numberRefs.size && !numberRefs.has(item.numberRef)) return false;
    if (
      mediaSessionRefs.size &&
      !mediaSessionRefs.has(item.mediaSessionRef || "")
    ) {
      return false;
    }
    if (accountRefs.size && !accountRefs.has(item.accountId || "")) return false;
    if (eventIdSet.size) {
      if (
        !eventIdSet.has(item.id) &&
        !eventIdSet.has(String(item.seq)) &&
        !eventIdSet.has(item.sourceEventId || "") &&
        !eventIdSet.has(item.dedupeKey || "")
      ) {
        return false;
      }
    }
    return true;
  });

  if (limit && limit > 0) {
    return filtered.slice(-Number(limit));
  }
  return filtered;
}

function rowToEvent(row = {}) {
  const eventType = row.event_type || "voice_event";
  const callRef = row.call_ref || "";
  const mediaSessionRef = row.media_session_ref || "";
  const numberRef = row.number_ref || "";
  const accountId = row.account_id || "";
  const requestId = row.request_id || "";
  const source = row.source || "voice-runtime";
  const sourceEventId = row.source_event_id || "";
  const idempotencyKey = row.idempotency_key || "";
  const dedupeKey = row.dedupe_key || "";
  const ts = toIso(row.ts);

  const payload =
    row.payload && typeof row.payload === "object" ? row.payload : {};
  const seq = Number(row.id);

  return {
    id: String(seq),
    seq,
    ts,
    callRef,
    mediaSessionRef,
    numberRef,
    accountId,
    requestId,
    eventType,
    source,
    sourceEventId,
    idempotencyKey,
    dedupeKey,
    data: {
      ...(payload || {}),
      callRef,
      mediaSessionRef,
      numberRef,
      accountId,
      requestId,
      eventType,
      idempotencyKey,
      sourceEventId,
      ts
    }
  };
}

function parseEventIdSetForDb(eventId) {
  const set = toSet(eventId);
  const numeric = [];
  const text = [];
  for (const item of set) {
    const num = parseIntLike(item);
    if (Number.isFinite(num) && num > 0) {
      numeric.push(Math.trunc(num));
      continue;
    }
    text.push(item);
  }
  return { numeric, text };
}

function buildDbFilterConditions(params, {
  sinceMs = 0,
  sinceId = 0,
  callRef,
  eventType,
  numberRef,
  mediaSessionRef,
  accountId,
  eventId
} = {}) {
  const sinceMsValue = parseIntLike(sinceMs) || 0;
  const sinceIdValue = parseIntLike(sinceId) || 0;
  const callRefs = toSet(callRef);
  const eventTypes = toSet(eventType);
  const numberRefs = toSet(numberRef);
  const mediaSessionRefs = toSet(mediaSessionRef);
  const accountRefs = toSet(accountId);
  const { numeric: eventIdNumeric, text: eventIdText } = parseEventIdSetForDb(eventId);

  const conditions = [];
  if (sinceMsValue) {
    params.push(new Date(sinceMsValue));
    conditions.push(`ts > $${params.length}`);
  }
  if (sinceIdValue) {
    params.push(sinceIdValue);
    conditions.push(`id > $${params.length}`);
  }
  if (callRefs.size) {
    params.push(Array.from(callRefs));
    conditions.push(`call_ref = ANY($${params.length}::text[])`);
  }
  if (eventTypes.size) {
    params.push(Array.from(eventTypes));
    conditions.push(`event_type = ANY($${params.length}::text[])`);
  }
  if (numberRefs.size) {
    params.push(Array.from(numberRefs));
    conditions.push(`number_ref = ANY($${params.length}::text[])`);
  }
  if (mediaSessionRefs.size) {
    params.push(Array.from(mediaSessionRefs));
    conditions.push(`media_session_ref = ANY($${params.length}::text[])`);
  }
  if (accountRefs.size) {
    params.push(Array.from(accountRefs));
    conditions.push(`account_id = ANY($${params.length}::text[])`);
  }
  if (eventIdNumeric.length || eventIdText.length) {
    const clauses = [];
    if (eventIdNumeric.length) {
      params.push(eventIdNumeric);
      clauses.push(`id = ANY($${params.length}::bigint[])`);
    }
    if (eventIdText.length) {
      params.push(eventIdText);
      clauses.push(`source_event_id = ANY($${params.length}::text[])`);
      params.push(eventIdText);
      clauses.push(`dedupe_key = ANY($${params.length}::text[])`);
      params.push(eventIdText);
      clauses.push(`idempotency_key = ANY($${params.length}::text[])`);
    }
    conditions.push(`(${clauses.join(" OR ")})`);
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    values: params
  };
}

async function initializeDatabaseStore() {
  if (!streamConfig.pgEnablePersist || !DATABASE_URL) {
    return false;
  }

  if (initialized) {
    return persistenceEnabled;
  }

  if (initializing) {
    return initializing;
  }

  initializing = (async () => {
    try {
      pool = new Pool({
        connectionString: DATABASE_URL,
        max: PG_MAX_CONNECTIONS,
        application_name: "telephony-bridge-voice-stream"
      });

      listenClient = new Client({
        connectionString: DATABASE_URL,
        application_name: "telephony-bridge-voice-listener"
      });

      await listenClient.connect();

      await pool.query(DEFAULT_DDL);
      await loadRecentHistoryFromDb();
      await runRetentionCleanup();
      scheduleRetentionCleanup();

      await listenClient.query(`LISTEN ${LISTEN_CHANNEL}`);
      listenClient.on("notification", (msg) => {
        void processNotification(msg.payload).catch((error) =>
          logger.warn("failed processing stream notification", {
            error: error.message
          })
        );
      });

      listenerReady = true;
      persistenceEnabled = true;
      initialized = true;
      logger.info("voice stream bus persistence enabled", {
        table: TABLE_NAME,
        channel: LISTEN_CHANNEL,
        retentionHours: RETENTION_HOURS,
        maxHistory: EVENTS_MAX_HISTORY
      });
      return true;
    } catch (error) {
      persistenceEnabled = false;
      initialized = false;
      logger.warn("voice stream bus persistence unavailable, falling back", {
        error: error.message
      });
      if (listenClient) {
        await listenClient.end().catch(() => {});
        listenClient = null;
      }
      if (pool) {
        await pool.end().catch(() => {});
        pool = null;
      }
      return false;
    } finally {
      initializing = null;
    }
  })();

  return initializing;
}

async function loadRecentHistoryFromDb() {
  if (!pool) return;
  const rowsResult = await pool.query(
    `SELECT id, ts, call_ref, media_session_ref, number_ref, account_id, request_id, event_type, source, source_event_id, idempotency_key, dedupe_key, payload
     FROM ${TABLE_NAME}
     ORDER BY id DESC
     LIMIT $1`,
    [Math.max(EVENTS_MAX_HISTORY * 2, 100)]
  );
  const rows = rowsResult.rows || [];
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    const event = rowToEvent(row);
    if (!row || !row.id) continue;
    sequence = Math.max(sequence, Number(row.id) || sequence);
    if (typeof row.id === "number" && Number.isFinite(row.id)) {
      lastCleanupAt = Math.max(lastCleanupAt, Date.parse(row.ts) || 0);
    }
    applyInMemory(rowToEvent(row), { emit: false });
  }
}

async function runRetentionCleanup() {
  if (!pool || retentionMs <= 0) return;
  const cutoff = new Date(Date.now() - retentionMs).toISOString();
  try {
    await pool.query(`DELETE FROM ${TABLE_NAME} WHERE ts < $1`, [cutoff]);
  } catch (error) {
    logger.warn("voice stream retention cleanup failed", {
      error: error.message,
      table: TABLE_NAME
    });
  }
}

function scheduleRetentionCleanup() {
  const interval = Math.max(60_000, Math.min(1_800_000, Math.floor(retentionMs / 6)));
  setInterval(() => {
    void runRetentionCleanup();
  }, interval).unref();
}

async function persistEvent(normalized) {
  if (!pool) return null;
  if (!(await initializeDatabaseStore())) return null;
  const hasDedup = Boolean(normalized.dedupeKey);
  if (!hasDedup) {
    const insert = `
      INSERT INTO ${TABLE_NAME} (
        ts, call_ref, media_session_ref, number_ref, account_id, request_id, event_type,
        source, source_event_id, idempotency_key, dedupe_key, payload
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, $10, NULL, $11
      )
      RETURNING id, ts, call_ref, media_session_ref, number_ref, account_id, request_id, event_type, source, source_event_id, idempotency_key, dedupe_key, payload
    `;
    const result = await pool.query(insert, [
      normalized.ts,
      normalized.callRef,
      normalized.mediaSessionRef,
      normalized.numberRef,
      normalized.accountId,
      normalized.requestId,
      normalized.eventType,
      normalized.source,
      normalized.sourceEventId,
      normalized.idempotencyKey || "",
      normalized.data
    ]);
    return result.rows[0] ? rowToEvent(result.rows[0]) : null;
  }

  const upsert = `
    INSERT INTO ${TABLE_NAME} (
      ts, call_ref, media_session_ref, number_ref, account_id, request_id, event_type,
      source, source_event_id, idempotency_key, dedupe_key, payload
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7,
      $8, $9, $10, $11, $12
    )
    ON CONFLICT (dedupe_key)
    WHERE dedupe_key IS NOT NULL AND dedupe_key <> ''
    DO UPDATE SET
      ts = EXCLUDED.ts,
      source_event_id = EXCLUDED.source_event_id,
      payload = EXCLUDED.payload
    RETURNING id, ts, call_ref, media_session_ref, number_ref, account_id, request_id, event_type, source, source_event_id, idempotency_key, dedupe_key, payload
  `;
  const result = await pool.query(upsert, [
    normalized.ts,
    normalized.callRef,
    normalized.mediaSessionRef,
    normalized.numberRef,
    normalized.accountId,
    normalized.requestId,
    normalized.eventType,
    normalized.source,
    normalized.sourceEventId,
    normalized.idempotencyKey || "",
    normalized.dedupeKey,
    normalized.data
  ]);
  return result.rows[0] ? rowToEvent(result.rows[0]) : null;
}

async function loadEventById(id) {
  if (!pool) return null;
  const rowResult = await pool.query(
    `SELECT id, ts, call_ref, media_session_ref, number_ref, account_id, request_id, event_type, source, source_event_id, idempotency_key, dedupe_key, payload
     FROM ${TABLE_NAME}
     WHERE id = $1`,
    [id]
  );
  return rowToEvent(rowResult.rows[0]);
}

async function processNotification(payload) {
  if (!pool || !persistenceEnabled) return;
  let parsed = {};
  try {
    parsed = typeof payload === "string" ? JSON.parse(payload) : {};
  } catch (_error) {
    return;
  }
  const origin = parsed.origin || "";
  if (origin === instanceId) return;
  const eventId = parseIntLike(parsed.id);
  if (!eventId) return;
  const event = await loadEventById(eventId);
  if (!event) return;
  applyInMemory(event);
}

function isPersistenceReady() {
  return (
    streamConfig.pgEnablePersist &&
    Boolean(DATABASE_URL) &&
    Boolean(persistenceEnabled)
  );
}

async function publishVoiceEvent(rawEvent) {
  const normalized = normalizeEnvelope(rawEvent);
  const useDb = await isPersistenceReady() || (await initializeDatabaseStore());

  if (!useDb) {
    return applyInMemory(normalized);
  }

  try {
    const persisted = await persistEvent(normalized);
    if (!persisted) {
      return applyInMemory(normalized);
    }
    const withSeqEvent = applyInMemory(persisted, { emit: true });
    void notifyFromPublished(persisted.id).catch((error) =>
      logger.warn("failed to notify stream listeners", {
        error: error.message,
        eventId: persisted.id
      })
    );
    return withSeqEvent;
  } catch (error) {
    logger.warn("failed to persist stream event, fallback to memory", {
      error: error.message,
      eventType: normalized.eventType
    });
    initialized = false;
    persistenceEnabled = false;
    return applyInMemory(normalized);
  }
}

async function notifyFromPublished(eventId) {
  if (!listenClient) return;
  await listenClient.query("SELECT pg_notify($1, $2)", [
    LISTEN_CHANNEL_NAME,
    JSON.stringify({
      eventId,
      origin: instanceId
    })
  ]);
}

async function listRecentEvents({
  sinceMs = 0,
  sinceId = 0,
  callRef,
  eventType,
  numberRef,
  mediaSessionRef,
  accountId,
  eventId,
  limit = 0
} = {}) {
  const params = [];
  const useDb = await initializeDatabaseStore();
  if (!useDb || !isPersistenceReady() || !pool) {
    return listRecentFromMemory({
      sinceMs,
      sinceId,
      callRef,
      eventType,
      numberRef,
      mediaSessionRef,
      accountId,
      eventId,
      limit
    });
  }

  const { where, values } = buildDbFilterConditions(params, {
    sinceMs,
    sinceId,
    callRef,
    eventType,
    numberRef,
    mediaSessionRef,
    accountId,
    eventId
  });
  const q = [
    "SELECT id, ts, call_ref, media_session_ref, number_ref, account_id, request_id, event_type, source, source_event_id, idempotency_key, dedupe_key, payload",
    `FROM ${TABLE_NAME}`,
    where,
    "ORDER BY id DESC"
  ];
  if (limit && Number(limit) > 0) {
    const limitValue = Math.max(1, Math.min(Number(limit), 1000));
    values.push(limitValue);
    q.push(`LIMIT $${values.length}`);
  }

  const result = await pool.query(q.join(" "), values);
  const rows = result.rows || [];
  const mapped = rows.map(rowToEvent).reverse();
  return mapped;
}

function waitForMatchingEvent(filters = {}, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || 0;
  if (timeoutMs <= 0) {
    return Promise.resolve([]);
  }

  const clampedTimeout = Math.max(1, Math.min(timeoutMs, MAX_LONG_POLL_MS));
  const matcher = parseFilters(filters);
  const sinceId = parseIntLike(options.sinceId) || 0;

  return new Promise((resolve) => {
    let finished = false;

    const finish = (items) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      emitter.off("voice_event", onEvent);
      resolve(items || []);
    };

    const onEvent = (event) => {
      if (!matcher(event)) return;
      if (sinceId && event.seq <= sinceId) return;
      finish([event]);
    };

    emitter.on("voice_event", onEvent);
    const timer = setTimeout(() => {
      finish([]);
    }, clampedTimeout);
  });
}

function subscribeVoiceEvents(handler, filters = {}) {
  const filteredHandler = (event) => {
    if (!parseFilters(filters)(event)) return;
    handler(event);
  };

  emitter.on("voice_event", filteredHandler);
  return () => emitter.off("voice_event", filteredHandler);
}

function buildSseStream(res, eventType, payload) {
  const safeType = String(eventType || "voice_event").replace(/[^a-z0-9_-]/gi, "-");
  res.write(`event: ${safeType}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function getStreamState() {
  return {
    backend: persistenceEnabled ? "postgresql" : "memory",
    table: TABLE_NAME,
    channel: LISTEN_CHANNEL,
    lastSeq: sequence,
    buffered: history.length,
    maxHistory: EVENTS_MAX_HISTORY,
    dedupeEntries: dedupeByKey.size,
    heartbeatMs: HEARTBEAT_MS,
    maxLongPollMs: MAX_LONG_POLL_MS,
    retentionHours: RETENTION_HOURS,
    listenerReady
  };
}

function startHeartbeat(res) {
  if (HEARTBEAT_MS <= 0) return null;
  return setInterval(() => {
    res.write(": keep-alive\n\n");
  }, HEARTBEAT_MS);
}

void initializeDatabaseStore();

module.exports = {
  publishVoiceEvent,
  subscribeVoiceEvents,
  listRecentEvents,
  buildSseStream,
  waitForMatchingEvent,
  getStreamState,
  startHeartbeat
};
