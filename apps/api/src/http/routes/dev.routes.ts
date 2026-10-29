import { simulatorScenarioInput, toE164, usPhone } from "@leadanchor/contracts";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { withTenant } from "../../db/client";
import { messages, phoneNumbers } from "../../db/schema";
import { HttpError, badRequest, parseInput } from "../../lib/errors";
import { simulatorTelephony, telephony } from "../../container";
import { getCallTrace } from "../../modules/calls/call.queries";
import { approveRegistrationForDev } from "../../modules/compliance/registration.service";
import { handleInboundMessage } from "../../modules/messaging/inbound";
import { tenantContext } from "../context";

/** Development-only tools: the call simulator, the simulated customer phone and fake carrier approval. */
export async function devRoutes(app: FastifyInstance) {
  async function trackingNumber(tenantId: string) {
    const [number] = await withTenant(tenantId, (tx) =>
      tx.select({ e164: phoneNumbers.e164 }).from(phoneNumbers).where(eq(phoneNumbers.status, "active")).limit(1),
    );
    if (!number) throw badRequest("This business has no phone number yet.");
    return number.e164;
  }

  app.post("/api/dev/simulator/calls", async (req, reply) => {
    const ctx = await tenantContext(req);
    if (telephony.name !== "simulator") throw new HttpError(409, "not_simulated", "The simulator is off because Telnyx is connected.");
    const scenario = parseInput(simulatorScenarioInput, req.body);
    const handle = simulatorTelephony.startCall(await trackingNumber(ctx.tenantId), scenario);
    return reply.status(202).send({ sessionId: handle.sessionId });
  });

  app.get("/api/dev/simulator/calls/:sessionId", async (req) => {
    const ctx = await tenantContext(req);
    const { sessionId } = parseInput(z.object({ sessionId: z.string().min(5) }), req.params);
    return getCallTrace(ctx.tenantId, { sessionId });
  });

  /** What the customer's phone would show: texts sent to that number by this business. */
  app.get("/api/dev/simulator/inbox", async (req) => {
    const ctx = await tenantContext(req);
    const { phone } = parseInput(z.object({ phone: usPhone }), req.query);
    const rows = await withTenant(ctx.tenantId, (tx) =>
      tx
        .select()
        .from(messages)
        .where(and(inArray(messages.status, ["sent", "delivered", "received"]), eq(messages.toAddress, phone)))
        .orderBy(desc(messages.createdAt))
        .limit(30),
    );
    const replies = await withTenant(ctx.tenantId, (tx) =>
      tx.select().from(messages).where(and(eq(messages.direction, "inbound"), eq(messages.fromAddress, phone))).orderBy(desc(messages.createdAt)).limit(30),
    );
    return {
      messages: [...rows, ...replies]
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((m) => ({ id: m.id, direction: m.direction, body: m.body, channel: m.channel, status: m.status, createdAt: m.createdAt.toISOString() })),
    };
  });

  /** The simulated customer texts the business back (e.g. "STOP"). */
  app.post("/api/dev/simulator/reply", async (req, reply) => {
    const ctx = await tenantContext(req);
    const { from, text } = parseInput(z.object({ from: z.string(), text: z.string().trim().min(1).max(500) }), req.body);
    const phone = toE164(from);
    if (!phone) throw badRequest("Enter a valid phone number.");
    await handleInboundMessage({ from: phone, to: await trackingNumber(ctx.tenantId), text, channel: "sms", provider: "simulator" });
    return reply.status(201).send({ ok: true });
  });

  app.post("/api/dev/simulator/registration/approve", async (req) => {
    const ctx = await tenantContext(req, ["owner"]);
    return approveRegistrationForDev(ctx.tenantId, ctx.userId);
  });
}
