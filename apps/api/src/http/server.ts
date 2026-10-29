import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import Fastify, { type FastifyError } from "fastify";
import { devToolsEnabled, webOrigins } from "../config/env";
import { pingDatabase } from "../db/client";
import { RINGBACK_WAV } from "../integrations/telephony/ringback";
import { HttpError } from "../lib/errors";
import { logger } from "../lib/logger";
import { appRoutes } from "./routes/app.routes";
import { authRoutes } from "./routes/auth.routes";
import { devRoutes } from "./routes/dev.routes";
import { publicRoutes } from "./routes/public.routes";
import { webhookRoutes } from "./routes/webhook.routes";

declare module "fastify" {
  interface FastifyRequest {
    /** Exact request body as received — needed to verify provider webhook signatures. */
    rawBody?: string;
  }
}

export async function buildServer() {
  const app = Fastify({
    loggerInstance: logger,
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
    disableRequestLogging: true,
  });

  // Keep the raw JSON body alongside the parsed one (webhook signatures are computed over raw bytes).
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    const text = typeof body === "string" ? body : body.toString("utf8");
    req.rawBody = text;
    if (!text) return done(null, {});
    try {
      done(null, JSON.parse(text));
    } catch {
      const error = new Error("Request body is not valid JSON.") as FastifyError;
      error.statusCode = 400;
      done(error, undefined);
    }
  });

  await app.register(cors, {
    origin: webOrigins,
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
  });
  await app.register(multipart, { limits: { fileSize: 15 * 1024 * 1024, files: 5, fields: 20 } });

  app.addHook("onResponse", (req, reply, done) => {
    if (!req.url.startsWith("/api/events")) {
      req.log.info({ method: req.method, url: req.url.split("?")[0], status: reply.statusCode, ms: Math.round(reply.elapsedTime) }, "request");
    }
    done();
  });

  app.setErrorHandler((error: FastifyError | HttpError, req, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.status).send({ error: { code: error.code, message: error.message, ...(error.fields && { fields: error.fields }) } });
    }
    if (error.code === "FST_REQ_FILE_TOO_LARGE") {
      return reply.status(413).send({ error: { code: "file_too_large", message: "That photo is too large (15 MB max)." } });
    }
    if (error.statusCode && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: { code: error.code ?? "bad_request", message: error.message } });
    }
    req.log.error({ err: error }, "unhandled error");
    return reply.status(500).send({ error: { code: "internal", message: "Something went wrong on our side." } });
  });

  app.setNotFoundHandler((req, reply) =>
    reply.status(404).send({ error: { code: "not_found", message: `No route for ${req.method} ${req.url.split("?")[0]}` } }),
  );

  app.get("/health", async () => {
    await pingDatabase();
    return { ok: true, time: new Date().toISOString() };
  });

  // Ringback tone Telnyx plays to callers while the owner's phone rings.
  app.get("/static/ringback.wav", async (_req, reply) =>
    reply.header("Content-Type", "audio/wav").header("Cache-Control", "public, max-age=86400").send(RINGBACK_WAV),
  );

  await app.register(authRoutes);
  await app.register(publicRoutes);
  await app.register(webhookRoutes);
  await app.register(appRoutes);
  if (devToolsEnabled) await app.register(devRoutes);

  return app;
}
