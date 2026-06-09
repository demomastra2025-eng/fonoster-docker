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
  skipIdentity: config.skipIdentity,
  contractMarker: {
    version: "operator-observability-v1",
    decisionEvent: "decision_received",
    fields: [
      "operatorObservabilityKey",
      "operatorSlaClass",
      "recordingImportContract",
      "transcriptContract"
    ],
    recordingContracts: [
      "runtime_owned_no_fonoster_import",
      "fonoster_pull_recording_ready_required"
    ]
  }
});
