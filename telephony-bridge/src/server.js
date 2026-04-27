const express = require("express");
const { randomUUID } = require("node:crypto");
const { config } = require("./config");
const { logger } = require("./logger");
const { withSdkRetry } = require("./fonoster");
const onelink = require("./chatwoot");
const {
  buildInboundDecision,
  buildOutboundAppRefDecision
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

const ONELINK_DIAL_STATUS_MAP = {
  ANSWER: "answered",
  ANSWERED: "answered",
  IN_PROGRESS: "answered",
  NOANSWER: "no-answer",
  NO_ANSWER: "no-answer",
  BUSY: "busy",
  FAILED: "failed",
  CANCEL: "failed",
  CANCELED: "failed",
  CANCELLED: "failed"
};

function normalizeOnelinkDialStatus(status) {
  const raw = String(status || "").trim();

  if (!raw) return "";

  const key = raw.toUpperCase().replace(/[\s-]+/g, "_");

  return ONELINK_DIAL_STATUS_MAP[key] || raw.toLowerCase().replace(/[\s_]+/g, "-");
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

  buildSseStream(res, "call_created", {
    callRef,
    createdAt: new Date().toISOString(),
    ...requestContext
  });

  (async () => {
    try {
      for await (const statusUpdate of statusStream) {
        if (closed) {
          break;
        }

        buildSseStream(res, "call_status", {
          callRef,
          status: statusUpdate && statusUpdate.status,
          streamState: getStreamState()
        });
      }

      if (!closed) {
        buildSseStream(res, "call_status", {
          callRef,
          status: "completed",
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
    mediaSessionRef: ["media_session_ref", "mediaSessionReference"],
    numberRef: ["number_ref", "numberRef", "ingressNumberRef", "ingress_number_ref"],
    ingressNumber: ["ingress_number", "ingressNumber"],
    callerNumber: ["caller_number", "callerNumber"],
    eventType: ["event", "event_type", "type"],
    accountId: ["account_id", "accountId", "x-account-id"],
    idempotencyKey: ["idempotency_key", "idempotencyKey"]
  });

  const eventType = String(normalized.eventType || "").toLowerCase();

  if (eventType === "dial_status") {
    normalizeEventStatusField(normalized, "status");
  }

  if (eventType === "session_completed") {
    normalizeEventStatusField(normalized, "outcome");
  }

  return normalized;
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
        status: "test_grade",
        productionReady: false,
        notes: [
          "telephony/webphone/token currently returns Fonoster test-token style data",
          "wss/browser hardening is not completed on this deployment"
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
  "/telephony/events/state",
  (req, res) => {
    res.json({
      streamState: getStreamState()
    });
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
  const payload = normalizeBody(req.body, {
    from: ["from_number"],
    fromNumberRef: ["from_number_ref"],
    appRef: ["app_ref", "application_ref", "applicationRef"],
    aiEnabled: ["ai_enabled"],
    aiAppRef: ["ai_app_ref"],
    metadata: ["meta"]
  });
  const accountId = req.accountId || req.body.account_id || req.body.accountId || "";
  const requestId = req.requestId || randomUUID();
  const idempotencyKey =
    req.get("x-idempotency-key") ||
    req.body.idempotency_key ||
    req.body.idempotencyKey ||
    "";

  const outboundMetadata = {
    ...(payload.metadata || {}),
    request_id: requestId,
    account_id: accountId,
    idempotency_key: idempotencyKey
  };

  const from = await withSdkRetry((sdk) => resolveFromNumber(sdk, payload));
  if (!from) {
    throw new Error("from or from_number_ref is required");
  }

  if (!payload.to) {
    throw new Error("to is required");
  }

  const appDecision = buildOutboundAppRefDecision(payload);
  if (!appDecision.appRef) {
    throw new Error("app_ref or appRef is required");
  }

  const created = await withSdkRetry((sdk) =>
    sdk.calls.createCall({
      from,
      to: payload.to,
      appRef: appDecision.appRef || undefined,
      timeout: payload.timeout || undefined,
      metadata: outboundMetadata
    })
  );

  const published = await publishVoiceEvent({
    eventType: "call_created",
    callRef: created.ref,
    accountId,
    requestId,
    idempotencyKey,
    source: "bridge.api",
    data: {
      from,
      to: payload.to,
      appRef: appDecision.appRef || "",
      requestId,
      accountId,
      idempotencyKey,
      outboundMeta: {
        requestedAt: new Date().toISOString(),
        requestType: "outbound"
      }
    }
  });

  return {
    response: created,
    statusStream: created.statusStream,
    published,
    request: {
      from,
      to: payload.to,
      appRef: appDecision.appRef || "",
      accountId,
      requestId,
      idempotencyKey
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
          idempotencyKey: request.idempotencyKey || null
        }
      );
      return;
    }

    res.status(201).json({
      ref: response.ref,
      callRef: response.ref,
      from: request.from,
      to: request.to,
      appRef: request.appRef,
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
  asyncRoute(async (_req, res) => {
    const token = await withSdkRetry((sdk) =>
      sdk.applications.createTestToken()
    );
    res.json(token);
  })
);

app.post(
  "/internal/voice/inbound/route",
  verifySharedSecret,
  asyncRoute(async (req, res) => {
    const inbound = {
      callRef: req.body.call_ref || req.body.callRef || null,
      appRef: req.body.app_ref || req.body.appRef || null,
      mediaSessionRef:
        req.body.media_session_ref || req.body.mediaSessionRef || null,
      ingressNumber: req.body.ingress_number || req.body.ingressNumber || null,
      callerNumber: req.body.caller_number || req.body.callerNumber || null,
      direction: req.body.direction || null,
      receivedAt: req.body.received_at || req.body.receivedAt || null,
      metadata: req.body.metadata || {},
      accountId: req.accountId || req.body.account_id || req.body.accountId || req.get("x-account-id") || null
    };

    const chatwootContext = await onelink.lookupInboundContext(inbound, {
      accountId: req.accountId,
      requestId: req.requestId
    });
    const decision = await buildInboundDecision({ inbound, chatwootContext });
    await publishVoiceEvent({
      source: "bridge.route",
      eventType: "route_decision",
      callRef: inbound.callRef || null,
      mediaSessionRef: inbound.mediaSessionRef || null,
      accountId: inbound.accountId,
      requestId: req.requestId,
      inbound,
      action: decision.action,
      reason: decision.reason || null,
      sourcePolicy: decision.source || null
    });

    logger.info("resolved inbound decision", {
      callRef: inbound.callRef,
      ingressNumber: inbound.ingressNumber,
      action: decision.action,
      source: decision.source,
      requestId: req.requestId,
      accountId: inbound.accountId || null,
      reason: decision.reason
    });

    res.json(decision);
  })
);

app.post(
  "/internal/voice/inbound/event",
  verifySharedSecret,
  asyncRoute(async (req, res) => {
    const normalized = normalizeInboundEvent(req.body || {});
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

    const published = await publishVoiceEvent({
      ...normalized,
      requestId: req.requestId,
      accountId,
      source: normalized.source || "voice-runtime",
      eventType: normalized.eventType || "voice_event"
    });

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

    void onelink.forwardInboundEvent(normalized, {
        idempotencyKey,
        accountId,
        requestId: req.requestId
      })
      .catch((error) => {
        logger.warn("failed to forward runtime event to onelink", {
          requestId: req.requestId,
          eventType: normalized.eventType || normalized.event_type || null,
          callRef: routeRef || null,
          type: error.type || "unknown",
          message: error.message,
          accountId
        });
      });

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
    stream: config.stream || {},
    security: {
      requireInternalSecret: config.security?.requireInternalSecret
    }
  });
});
