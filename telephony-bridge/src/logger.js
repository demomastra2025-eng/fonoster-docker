const { config } = require("./config");

const levels = ["error", "warn", "info", "debug"];

function shouldLog(level) {
  return levels.indexOf(level) <= levels.indexOf(config.logLevel);
}

function emit(level, message, extra) {
  if (!shouldLog(level)) return;
  const payload = {
    ts: new Date().toISOString(),
    level,
    service: "telephony-bridge",
    message
  };

  if (extra !== undefined) payload.extra = extra;

  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

const logger = {
  error: (message, extra) => emit("error", message, extra),
  warn: (message, extra) => emit("warn", message, extra),
  info: (message, extra) => emit("info", message, extra),
  debug: (message, extra) => emit("debug", message, extra)
};

module.exports = { logger };
