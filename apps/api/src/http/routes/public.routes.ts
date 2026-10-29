import { intakeSubmitFields } from "@leadanchor/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { badRequest, parseInput } from "../../lib/errors";
import { MAX_PHOTOS, getIntakeContext, submitIntake } from "../../modules/intake/intake.service";

const tokenParam = z.object({ token: z.string().min(20).max(64) });

/** Customer-facing endpoints. No login: the link token is the credential (C-07, C-08, C-09). */
export async function publicRoutes(app: FastifyInstance) {
  app.get("/api/public/intake/:token", async (req, reply) => {
    const { token } = parseInput(tokenParam, req.params);
    reply.header("Cache-Control", "no-store");
    return getIntakeContext(token);
  });

  app.post("/api/public/intake/:token", async (req, reply) => {
    const { token } = parseInput(tokenParam, req.params);
    if (!req.isMultipart()) throw badRequest("Expected a form submission.");

    const fields: Record<string, string> = {};
    const photos: Array<{ buffer: Buffer }> = [];
    for await (const part of req.parts()) {
      if (part.type === "file") {
        if (photos.length >= MAX_PHOTOS) {
          await part.toBuffer();
          continue;
        }
        const buffer = await part.toBuffer();
        if (buffer.length > 0) photos.push({ buffer });
      } else {
        fields[part.fieldname] = String(part.value ?? "");
      }
    }

    const input = parseInput(intakeSubmitFields, fields);
    const result = await submitIntake(token, input, photos, { ipAddress: req.ip ?? null });
    return reply.status(201).send(result);
  });
}
