import { handoffInput, networkJoinInput, networkUpdateInput } from "@leadanchor/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseInput } from "../../lib/errors";
import {
  acceptOffer,
  getNetwork,
  joinNetwork,
  leaveNetwork,
  listOffers,
  passLead,
  passOffer,
  updateNetwork,
  withdrawHandoff,
} from "../../modules/network/network.service";
import { tenantContext } from "../context";

const idParam = z.object({ id: z.uuid() });

/** The trusted pros network (C-24) and referral credits (C-25). */
export async function networkRoutes(app: FastifyInstance) {
  app.get("/api/network", async (req) => {
    const ctx = await tenantContext(req);
    return getNetwork(ctx.tenantId);
  });

  /** Joining is accepting the partner terms, so only the owner can. */
  app.post("/api/network/join", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    return joinNetwork(ctx.tenantId, ctx.userId, parseInput(networkJoinInput, req.body));
  });

  app.patch("/api/network", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    return updateNetwork(ctx.tenantId, parseInput(networkUpdateInput, req.body));
  });

  app.delete("/api/network", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    return leaveNetwork(ctx.tenantId, ctx.userId);
  });

  app.get("/api/network/offers", async (req) => {
    const ctx = await tenantContext(req);
    return listOffers(ctx.tenantId);
  });

  app.post("/api/network/offers/:id/accept", async (req) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    const { id } = parseInput(idParam, req.params);
    return acceptOffer(ctx.tenantId, ctx.userId, id);
  });

  app.post("/api/network/offers/:id/pass", async (req) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    const { id } = parseInput(idParam, req.params);
    return passOffer(ctx.tenantId, id);
  });

  /** Passes a job on: shared with up to three pros, first to accept takes it. */
  app.post("/api/leads/:id/handoff", async (req, reply) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    const { id } = parseInput(idParam, req.params);
    return reply.status(201).send(await passLead(ctx.tenantId, ctx.userId, id, parseInput(handoffInput, req.body)));
  });

  app.post("/api/handoffs/:id/withdraw", async (req) => {
    const ctx = await tenantContext(req, ["owner", "manager"]);
    const { id } = parseInput(idParam, req.params);
    return withdrawHandoff(ctx.tenantId, ctx.userId, id);
  });
}
