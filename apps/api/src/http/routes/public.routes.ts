import { intakeSubmitFields, publicRequestFields } from "@leadanchor/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { storage } from "../../container";
import { badRequest, notFound, parseInput } from "../../lib/errors";
import { MAX_PHOTOS, getIntakeContext, getRequestContext, submitIntake, submitPublicRequest } from "../../modules/intake/intake.service";
import { findShowcasePhoto, getPublicProfile } from "../../modules/profile/profile";

const tokenParam = z.object({ token: z.string().min(20).max(64) });
const slugParam = z.object({ slug: z.string().min(3).max(80).regex(/^[a-z0-9-]+$/) });

/** Customer-facing endpoints. No login: the link token is the credential (C-07, C-08, C-09). */
export async function publicRoutes(app: FastifyInstance) {
  /** The business's public profile page data (C-41). */
  app.get("/api/public/profile/:slug", async (req, reply) => {
    const { slug } = parseInput(slugParam, req.params);
    const profile = await getPublicProfile(slug);
    if (!profile) throw notFound("Profile");
    reply.header("Cache-Control", "public, max-age=60");
    return profile;
  });

  /** A photo the owner chose for their public gallery; any other photo is "not found". */
  app.get("/api/public/profile/:slug/photos/:id", async (req, reply) => {
    const { slug, id } = parseInput(slugParam.extend({ id: z.uuid() }), req.params);
    const { variant } = parseInput(z.object({ variant: z.enum(["full", "thumb"]).default("thumb") }), req.query);
    const photo = await findShowcasePhoto(slug, id);
    if (!photo) throw notFound("Photo");
    const key = variant === "thumb" && photo.thumbKey ? photo.thumbKey : photo.storageKey;
    return reply.header("Content-Type", photo.mimeType).header("Cache-Control", "public, max-age=3600").send(await storage.get(key));
  });

  app.get("/api/public/intake/:token", async (req, reply) => {
    const { token } = parseInput(tokenParam, req.params);
    reply.header("Cache-Control", "no-store");
    return getIntakeContext(token);
  });

  app.post("/api/public/intake/:token", async (req, reply) => {
    const { token } = parseInput(tokenParam, req.params);
    const { fields, photos } = await readForm(req);
    const result = await submitIntake(token, parseInput(intakeSubmitFields, fields), photos, { ipAddress: req.ip ?? null });
    return reply.status(201).send(result);
  });

  /** C-10: the request form behind the website button, the Google profile link and shared links. */
  app.get("/api/public/request/:slug", async (req, reply) => {
    const { slug } = parseInput(slugParam, req.params);
    reply.header("Cache-Control", "no-store");
    return getRequestContext(slug);
  });

  app.post("/api/public/request/:slug", async (req, reply) => {
    const { slug } = parseInput(slugParam, req.params);
    const { fields, photos } = await readForm(req);
    const result = await submitPublicRequest(slug, parseInput(publicRequestFields, fields), photos, { ipAddress: req.ip ?? null });
    return reply.status(201).send(result);
  });
}

/** Reads a multipart form: text fields plus up to MAX_PHOTOS photos (extra files are drained and dropped). */
async function readForm(req: FastifyRequest) {
  if (!req.isMultipart()) throw badRequest("Expected a form submission.");
  const fields: Record<string, string> = {};
  const photos: Array<{ buffer: Buffer }> = [];
  for await (const part of req.parts()) {
    if (part.type === "file") {
      const buffer = await part.toBuffer();
      if (buffer.length > 0 && photos.length < MAX_PHOTOS) photos.push({ buffer });
    } else {
      fields[part.fieldname] = String(part.value ?? "");
    }
  }
  return { fields, photos };
}
