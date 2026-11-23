import { aiVisibilityInput } from "@leadanchor/contracts";
import type { FastifyInstance } from "fastify";
import { parseInput } from "../../lib/errors";
import { getVisibility, runVisibilityCheck, setDiscoveryOptOut } from "../../modules/discovery/discovery.service";
import { tenantContext } from "../context";

/** Found by AI (C-42): the dashboard card, the check, and the one-tap opt-out. */
export async function discoveryRoutes(app: FastifyInstance) {
  app.get("/api/discovery", async (req) => {
    const ctx = await tenantContext(req);
    return getVisibility(ctx.tenantId);
  });

  /** Asks an AI assistant ten local questions now (at most once a day). */
  app.post("/api/discovery/check", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    return runVisibilityCheck(ctx.tenantId);
  });

  app.patch("/api/discovery", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    return setDiscoveryOptOut(ctx.tenantId, ctx.userId, parseInput(aiVisibilityInput, req.body).optedOut);
  });
}
