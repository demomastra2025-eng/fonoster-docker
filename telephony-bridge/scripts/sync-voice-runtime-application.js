const SDK = require("@fonoster/sdk");

function required(name, fallback = "") {
  const value = process.env[name] || fallback;
  if (!value) {
    throw new Error(`missing required env: ${name}`);
  }
  return value;
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
  const allowInsecure =
    String(process.env.TELEPHONY_BRIDGE_FONOSTER_ALLOW_INSECURE || "false") ===
    "true";

  const appName = required("VOICE_RUNTIME_APP_NAME", "Onelink Voice Runtime");
  const endpointRef = required(
    "VOICE_RUNTIME_APP_ENDPOINT",
    "voice-runtime:50062"
  );
  const explicitRef = process.env.VOICE_RUNTIME_APP_REF || "";

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
      productRef: process.env.VOICE_RUNTIME_STT_PRODUCT_REF || "stt.deepgram",
      config: {
        languageCode:
          process.env.VOICE_RUNTIME_STT_LANGUAGE_CODE || "en-US",
        model:
          process.env.VOICE_RUNTIME_STT_MODEL || "nova-2-phonecall"
      }
    },
    textToSpeech: {
      productRef: process.env.VOICE_RUNTIME_TTS_PRODUCT_REF || "tts.deepgram",
      config: {
        voice: process.env.VOICE_RUNTIME_TTS_VOICE || "aura-asteria-en"
      }
    }
  };

  if (existing) {
    await applications.updateApplication({
      ref: existing.ref,
      ...request
    });

    console.log(
      JSON.stringify(
        {
          action: "updated",
          ref: existing.ref,
          name: appName,
          endpoint: endpointRef
        },
        null,
        2
      )
    );
    return;
  }

  const created = await applications.createApplication(request);
  console.log(
    JSON.stringify(
      {
        action: "created",
        ref: created.ref,
        name: appName,
        endpoint: endpointRef
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
