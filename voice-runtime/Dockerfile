FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev
RUN node - <<'EOF'
const fs = require("node:fs");
const path = "/app/node_modules/@fonoster/common/dist/protos/voice.proto";
const proto = fs.readFileSync(path, "utf8");

if (!proto.includes("string runtime_call_ref = 3;")) {
  fs.writeFileSync(path, proto.replace(
    "  Status status = 2;\n}",
    `  Status status = 2;

  // The runtime/app leg call reference created by app handoff.
  string runtime_call_ref = 3;

  // Transitional alias for runtime_call_ref.
  string child_call_ref = 4;

  // The target app reference used for app handoff.
  string app_ref = 5;

  // The current stream reference when a stream has been established.
  string stream_ref = 6;

  // Technical source for terminal dial statuses.
  string close_source = 7;
}`
  ));
}

const patched = fs.readFileSync(path, "utf8");
if (!patched.includes("bool saw_audio_in = 8;")) {
  fs.writeFileSync(path, patched.replace(
    "  // Technical source for terminal dial statuses.\n  string close_source = 7;\n}",
    `  // Technical source for terminal dial statuses.
  string close_source = 7;

  // Stream/media accounting for app handoff diagnostics.
  bool saw_audio_in = 8;
  bool saw_audio_out = 9;
  string first_audio_in_at = 10;
  string first_audio_out_at = 11;
  uint32 first_audio_in_bytes = 12;
  uint32 first_audio_out_bytes = 13;
  uint32 audio_in_bytes_total = 14;
  uint32 audio_out_bytes_total = 15;
  string start_stream_response_at = 16;
  uint32 first_audio_in_delta_ms = 17;
  uint32 first_audio_out_delta_ms = 18;
  string cancel_at = 19;
  string close_reason = 20;
}`
  ));
}
EOF

COPY src ./src

ENV NODE_ENV=production
CMD ["npm", "start"]
