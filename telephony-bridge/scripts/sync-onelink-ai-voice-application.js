const SDK = require("@fonoster/sdk");

function value(name, fallback = "") {
  return process.env[name] || fallback;
}

function required(name, fallback = "") {
  const result = value(name, fallback).trim();
  if (!result) {
    throw new Error(`missing required env: ${name}`);
  }
  return result;
}

function asBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function assertProductionEndpoint(endpoint) {
  const normalized = String(endpoint || "").trim().toLowerCase();
  if (!normalized) {
    throw new Error("Onelink AI Voice endpoint is empty");
  }

  const allowLocal = asBoolean(process.env.ONELINK_AI_VOICE_ALLOW_LOCAL_ENDPOINT, false);
  if (!allowLocal && (normalized.includes("test-voiceapp") || normalized.includes("localhost"))) {
    throw new Error(
      "refusing to sync local test voice app as production Onelink AI endpoint"
    );
  }
}

async function main() {
  const accessKeyId = required(
    "TELEPHONY_BRIDGE_FONOSTER_ACCESS_KEY_ID",
    "WO00000000000000000000000000000000"
  );
  const endpoint = required(
    "TELEPHONY_BRIDGE_FONOSTER_ENDPOINT",
    "cloud.vconsult.kz:443"
  );
  const username = required("TELEPHONY_BRIDGE_FONOSTER_USERNAME");
  const password = required("TELEPHONY_BRIDGE_FONOSTER_PASSWORD");
  const allowInsecure = asBoolean(
    process.env.TELEPHONY_BRIDGE_FONOSTER_ALLOW_INSECURE,
    false
  );

  const appName = value(
    "ONELINK_AI_VOICE_APP_NAME",
    value("VOICE_AGENT_APP_NAME", "Onelink Gemini Live Voice Agent")
  );
  const endpointRef = required(
    "ONELINK_AI_VOICE_APP_ENDPOINT",
    value("VOICE_AGENT_APP_ENDPOINT", "")
  );
  const explicitRef =
    value("ONELINK_AI_VOICE_APP_REF") ||
    value("TELEPHONY_BRIDGE_ONELINK_AI_APP_REF") ||
    value("VOICE_AGENT_APP_REF");

  assertProductionEndpoint(endpointRef);

  const client = new SDK.Client({ accessKeyId, endpoint, allowInsecure });
  await client.login(username, password);

  const applications = new SDK.Applications(client);
  const list = await applications.listApplications({ pageSize: 100 });

  const existing =
    list.items.find((item) => explicitRef && item.ref === explicitRef) ||
    list.items.find((item) => item.name === appName) ||
    list.items.find((item) => item.endpoint === endpointRef);

  const request = {
    name: appName,
    type: "EXTERNAL",
    endpoint: endpointRef,
    speechToText: {
      productRef: value("VOICE_AGENT_APP_STT_PRODUCT_REF", "stt.deepgram"),
      config: {
        languageCode: value("VOICE_AGENT_APP_STT_LANGUAGE_CODE", "en-US"),
        model: value("VOICE_AGENT_APP_STT_MODEL", "nova-2-phonecall")
      }
    },
    textToSpeech: {
      productRef: value("VOICE_AGENT_APP_TTS_PRODUCT_REF", "tts.deepgram"),
      config: {
        voice: value("VOICE_AGENT_APP_TTS_VOICE", "aura-asteria-en")
      }
    }
  };

  let ref;
  let action;
  if (existing) {
    await applications.updateApplication({
      ref: existing.ref,
      ...request
    });
    ref = existing.ref;
    action = "updated";
  } else {
    const created = await applications.createApplication(request);
    ref = created.ref;
    action = "created";
  }

  console.log(
    JSON.stringify(
      {
        action,
        ref,
        name: appName,
        endpoint: endpointRef,
        recommended_env: {
          TELEPHONY_BRIDGE_DEFAULT_AI_MODE: "onelink_managed",
          TELEPHONY_BRIDGE_ONELINK_AI_APP_REF: ref,
          TELEPHONY_BRIDGE_DEFAULT_AI_APP_REF: ref
        }
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        error: error.message,
        stack: error.stack
      },
      null,
      2
    )
  );
  process.exit(1);
});
