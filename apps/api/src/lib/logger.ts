import { pino } from "pino";
import { env, isDev } from "../config/env";

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    // Never log secrets or raw identity data.
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "*.password",
      "*.ein",
      "*.dateOfBirth",
      "*.apiKey",
    ],
    censor: "[redacted]",
  },
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss", ignore: "pid,hostname,reqId" },
        },
      }
    : {}),
});

export type Logger = typeof logger;
