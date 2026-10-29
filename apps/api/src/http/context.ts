import type { Role } from "@leadanchor/contracts";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyRequest } from "fastify";
import { auth } from "../auth/auth";
import { HttpError, forbidden } from "../lib/errors";
import { findMembership } from "../modules/tenants/tenant.service";

export interface UserContext {
  userId: string;
  name: string;
  email: string;
}

export interface TenantContext extends UserContext {
  tenantId: string;
  role: Role;
}

export async function userContext(req: FastifyRequest): Promise<UserContext> {
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) throw new HttpError(401, "unauthenticated", "Please sign in.");
  return { userId: session.user.id, name: session.user.name, email: session.user.email };
}

/** Signed-in user plus the business they belong to. Every tenant query is scoped by this tenantId. */
export async function tenantContext(req: FastifyRequest, allowed?: Role[]): Promise<TenantContext> {
  const user = await userContext(req);
  const membership = await findMembership(user.userId);
  if (!membership) throw new HttpError(409, "onboarding_required", "Finish setting up your business first.");
  if (allowed && !allowed.includes(membership.role)) throw forbidden();
  return { ...user, tenantId: membership.tenantId, role: membership.role };
}
