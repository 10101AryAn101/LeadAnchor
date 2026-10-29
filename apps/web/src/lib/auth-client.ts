"use client";

import { createAuthClient } from "better-auth/react";

/** Better Auth client. Talks to /api/auth on this origin (proxied to the API). */
export const authClient = createAuthClient({
  basePath: "/api/auth",
});

export const { signIn, signUp, signOut, useSession } = authClient;
