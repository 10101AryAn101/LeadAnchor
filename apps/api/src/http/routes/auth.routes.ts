import { fromNodeHeaders } from "better-auth/node";
import type { FastifyInstance } from "fastify";
import { auth } from "../../auth/auth";
import { env } from "../../config/env";

/** Mounts Better Auth's handler (sign-up, sign-in, session, sign-out) at /api/auth/*. */
export async function authRoutes(app: FastifyInstance) {
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(req, reply) {
      const hasBody = req.method !== "GET" && req.method !== "HEAD";
      const request = new Request(new URL(req.url, env.PUBLIC_API_URL), {
        method: req.method,
        headers: fromNodeHeaders(req.headers),
        body: hasBody ? (req.rawBody ?? (req.body ? JSON.stringify(req.body) : undefined)) : undefined,
      });

      const response = await auth.handler(request);

      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key !== "set-cookie" && key !== "content-length" && key !== "content-encoding") reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header("set-cookie", cookies);
      return reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
    },
  });
}
