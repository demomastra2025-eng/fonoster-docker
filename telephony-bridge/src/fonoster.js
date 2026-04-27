const SDK = require("@fonoster/sdk");
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

async function getSdk() {
  const client = await getClient();

  return {
    client,
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
