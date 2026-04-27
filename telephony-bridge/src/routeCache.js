const cache = new Map();

function now() {
  return Date.now();
}

function normalizeValue(value) {
  if (!value) return "";
  return String(value).trim();
}

function buildCacheKeys(params = {}) {
  const keys = new Set();

  const ingressNumber =
    params.ingressNumber ||
    params.inbound?.ingressNumber ||
    params.metadata?.ingressNumber ||
    "";
  const numberRef =
    params.numberRef ||
    params.inbound?.metadata?.numberRef ||
    params.metadata?.numberRef ||
    "";
  const accountId =
    params.accountId ||
    params.inbound?.accountId ||
    params.metadata?.accountId ||
    params.metadata?.account_id ||
    "";

  const normalizedIngress = normalizeValue(ingressNumber);
  const normalizedNumberRef = normalizeValue(numberRef);
  const normalizedAccountId = normalizeValue(accountId);

  if (normalizedIngress) keys.add(`ingress:${normalizedIngress}`);
  if (normalizedNumberRef) keys.add(`numberRef:${normalizedNumberRef}`);
  if (normalizedAccountId) keys.add(`account:${normalizedAccountId}`);

  return [...keys];
}

function getCachedDecision(params = {}) {
  const keys = buildCacheKeys(params);

  for (const key of keys) {
    const entry = cache.get(key);
    if (!entry) continue;

    if (entry.expiresAt <= now()) {
      cache.delete(key);
      continue;
    }

    return entry.decision;
  }

  return null;
}

function setCachedDecision(params = {}, decision, ttlMs) {
  const keys = buildCacheKeys(params);
  if (keys.length === 0) return;

  const expiresAt = now() + ttlMs;

  for (const key of keys) {
    cache.set(key, { decision, expiresAt });
  }
}

function invalidateRouteCache(params = {}) {
  const keys = buildCacheKeys(params);

  if (keys.length === 0) {
    cache.clear();
    return { invalidated: "all", size: cache.size };
  }

  for (const key of keys) {
    cache.delete(key);
  }

  return { invalidated: keys, size: cache.size };
}

function getCacheStatus() {
  const snapshot = [];

  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now()) {
      cache.delete(key);
      continue;
    }

    snapshot.push({
      key,
      ttlMs: entry.expiresAt - now(),
      action: entry.decision?.action || null
    });
  }

  return {
    entries: snapshot.length,
    keys: snapshot
  };
}

module.exports = {
  buildCacheKeys,
  getCachedDecision,
  setCachedDecision,
  invalidateRouteCache,
  getCacheStatus
};
