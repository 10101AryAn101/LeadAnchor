import { env, linkBaseUrl } from "./config/env";
import { closeDatabase, pingDatabase } from "./db/client";
import { buildServer } from "./http/server";
import { startQueue, stopQueue } from "./jobs/queue";
import { startWorkers } from "./jobs/workers";
import { logger } from "./lib/logger";
import { serial } from "./lib/serial";
import { sleep } from "./lib/time";
import { ai, consentLedger, simulatorTelephony, telephony } from "./container";
import { TelnyxTelephony } from "./integrations/telephony/telnyx";
import { callEngine } from "./modules/calls";

async function waitForDatabase() {
  for (let attempt = 1; ; attempt++) {
    try {
      await pingDatabase();
      return;
    } catch (error) {
      if (attempt >= 30) throw error;
      if (attempt === 1) logger.info("waiting for PostgreSQL (run `pnpm db:start` if it isn't running)…");
      await sleep(1000);
    }
  }
}

async function main() {
  await waitForDatabase();
  await startQueue();
  await startWorkers();

  // Feed provider events into the call engine, one call at a time.
  simulatorTelephony.setEventSink((event) => serial(event.sessionId, () => callEngine.handle(event)));
  if (telephony instanceof TelnyxTelephony) {
    telephony.onSyntheticEvent((event) => void serial(event.sessionId, () => callEngine.handle(event)));
  }

  const app = await buildServer();
  await app.listen({ host: env.API_HOST, port: env.API_PORT });

  logger.info(
    {
      telephony: telephony.name,
      consentLedger: consentLedger.backend,
      ai: ai.configured ? ai.model : "not configured",
    },
    `LeadAnchor API ready on ${env.PUBLIC_API_URL}`,
  );
  if (linkBaseUrl !== env.PUBLIC_WEB_URL) {
    logger.info(`Others on your network can open ${linkBaseUrl} (links in texts use this address too)`);
  }
  if (env.TUNNEL_URL) {
    logger.info(`Provider webhooks reach this API at ${env.TUNNEL_URL}/api/webhooks/… while \`pnpm tunnel\` runs`);
  }

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received — shutting down`);
    await app.close().catch(() => {});
    await stopQueue().catch(() => {});
    await closeDatabase();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  logger.fatal({ err: error }, "API failed to start");
  process.exit(1);
});
