import pino from "pino";

let _level = process.env.LOG_LEVEL || "info";
export const logger = pino({
  level: _level,
  redact: {
    paths: ["*.apiKey", "*.token", "*.password", "*.secret", "*.Authorization"],
    censor: "[REDACTED]",
  },
});

export function setLogLevel(level: string) {
  _level = level;
  logger.level = level;
}
