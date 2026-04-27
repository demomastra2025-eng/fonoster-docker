const VoiceServer = require("@fonoster/voice").default;
const { config } = require("./config");
const { logger } = require("./logger");
const { handleIncomingCall } = require("./runtime");

new VoiceServer({
  skipIdentity: config.skipIdentity,
  port: config.port
}).listen(async (req, voice) => {
  await handleIncomingCall(req, voice);
});

logger.info("voice runtime started", {
  port: config.port,
  bridgeBaseUrl: config.bridgeBaseUrl,
  skipIdentity: config.skipIdentity
});
