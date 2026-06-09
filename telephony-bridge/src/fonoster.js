const SDK = require("@fonoster/sdk");
const { Struct } = require("google-protobuf/google/protobuf/struct_pb");
const { makeRpcRequest } = require("@fonoster/sdk/dist/node/client/makeRpcRequest");
const {
  CreateCallRequest,
  TrackCallRequest
} = require("@fonoster/sdk/dist/node/generated/node/calls_pb");
const { dialStatusToString } = require("@fonoster/sdk/dist/node/utils");
const { config } = require("./config");
const { logger } = require("./logger");

let cachedClient;
let loginPromise;

function resetClient() {
  cachedClient = null;
  loginPromise = null;
}

function isExpiredTokenError(error) {
  const message = error?.message || "";
  const details = error?.details || "";
  const stack = error?.stack || "";
  const code = Number(error?.code);

  return (
    message.includes("UNAUTHENTICATED") ||
    message.includes("Invalid or expired token") ||
    details.includes("Invalid or expired token") ||
    (
      code === 13 &&
      (
        message.includes("Internal server error") ||
        details.includes("Internal server error")
      ) &&
      (
        stack.includes("exchangeRefreshToken") ||
        stack.includes("TokenRefresher")
      )
    )
  );
}

async function getClient() {
  if (cachedClient) return cachedClient;
  if (loginPromise) return loginPromise;

  loginPromise = (async () => {
    logger.info("initializing fonoster sdk client", {
      endpoint: config.fonoster.endpoint
    });

    const client = new SDK.Client({
      accessKeyId: config.fonoster.accessKeyId,
      endpoint: config.fonoster.endpoint,
      allowInsecure: config.fonoster.allowInsecure
    });

    await client.login(config.fonoster.username, config.fonoster.password);
    cachedClient = client;
    logger.info("fonoster sdk client is ready");
    return client;
  })();

  try {
    return await loginPromise;
  } catch (error) {
    resetClient();
    throw error;
  }
}

async function createCallWithoutTracking(client, request) {
  const callsClient = client.getCallsClient();
  const response = await makeRpcRequest({
    method: callsClient.createCall.bind(callsClient),
    requestPBObjectConstructor: CreateCallRequest,
    metadata: client.getMetadata(),
    request: {
      ...request,
      metadata: Struct.fromJavaScript(request.metadata || {})
    }
  });

  return { ref: response.ref, statusStream: null };
}

function statusStreamIdleTimeoutMs() {
  const value = Number(process.env.TELEPHONY_BRIDGE_STATUS_STREAM_IDLE_TIMEOUT_MS || 12000);
  return Number.isFinite(value) && value > 0 ? value : 12000;
}

function createSafeStatusStream(client, ref) {
  const callsClient = client.getCallsClient();
  const trackCallRequest = new TrackCallRequest();
  const queue = [];
  let streamError = null;
  let done = false;
  let wake = null;
  let idleTimer = null;

  const notify = () => {
    if (!wake) return;

    const resolve = wake;
    wake = null;
    resolve();
  };

  const clearIdleTimer = () => {
    if (!idleTimer) return;
    clearTimeout(idleTimer);
    idleTimer = null;
  };

  const finish = (error = null) => {
    if (done) return;
    streamError = error;
    done = true;
    clearIdleTimer();
    notify();
  };

  const cancelStream = () => {
    if (typeof call?.cancel === "function") {
      call.cancel();
    }
  };

  const refreshIdleTimer = () => {
    clearIdleTimer();
    const timeoutMs = statusStreamIdleTimeoutMs();
    idleTimer = setTimeout(() => {
      const error = new Error(`status stream idle timeout after ${timeoutMs}ms`);
      finish(error);
      cancelStream();
    }, timeoutMs);
  };

  trackCallRequest.setRef(ref);
  const call = callsClient.trackCall(trackCallRequest, client.getMetadata());
  refreshIdleTimer();

  call.on("data", (response) => {
    const data = response.toObject();
    queue.push({ status: dialStatusToString(data.status), providerPayload: data });
    refreshIdleTimer();
    notify();
  });

  call.on("end", () => {
    finish();
  });

  call.on("error", (error) => {
    finish(error);
  });

  return (async function* statusStreamGenerator() {
    while (!done || queue.length > 0) {
      if (queue.length > 0) {
        yield queue.shift();
        continue;
      }

      await new Promise((resolve) => {
        wake = resolve;
      });
    }

    if (streamError) {
      throw streamError;
    }
  })();
}

async function createCallWithSafeTracking(client, request) {
  const created = await createCallWithoutTracking(client, request);
  return {
    ...created,
    statusStream: createSafeStatusStream(client, created.ref)
  };
}

async function getSdk() {
  const client = await getClient();

  return {
    client,
    createCallWithoutTracking: (request) => createCallWithoutTracking(client, request),
    createCallWithSafeTracking: (request) => createCallWithSafeTracking(client, request),
    calls: new SDK.Calls(client),
    applications: new SDK.Applications(client),
    numbers: new SDK.Numbers(client),
    trunks: new SDK.Trunks(client),
    agents: new SDK.Agents(client),
    domains: new SDK.Domains(client),
    credentials: new SDK.Credentials(client),
    secrets: new SDK.Secrets(client)
  };
}

async function withSdkRetry(fn) {
  try {
    return await fn(await getSdk());
  } catch (error) {
    if (!isExpiredTokenError(error)) {
      throw error;
    }

    logger.warn("fonoster token expired, retrying with fresh login");
    resetClient();

    return await fn(await getSdk());
  }
}

module.exports = { getSdk, withSdkRetry, resetClient };
