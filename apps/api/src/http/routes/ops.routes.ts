import { opsEraseInput, opsSuspendInput, opsTrialInput } from "@leadanchor/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseInput } from "../../lib/errors";
import {
  eraseCustomerData,
  extendTrial,
  listTenants,
  overview,
  removeFromNetwork,
  suspendTenant,
  tenantDetail,
  unsuspendTenant,
} from "../../modules/ops/ops.service";
import { operatorContext } from "../context";

const idParam = z.object({ id: z.uuid() });

/** The operator console (module 14): LeadAnchor staff only, listed in OPERATOR_EMAILS. */
export async function opsRoutes(app: FastifyInstance) {
  app.get("/api/ops/overview", async (req) => {
    await operatorContext(req);
    return overview();
  });

  app.get("/api/ops/tenants", async (req) => {
    await operatorContext(req);
    const { q } = parseInput(z.object({ q: z.string().max(100).default("") }), req.query);
    return { tenants: await listTenants(q) };
  });

  app.get("/api/ops/tenants/:id", async (req) => {
    await operatorContext(req);
    return tenantDetail(parseInput(idParam, req.params).id);
  });

  app.post("/api/ops/tenants/:id/suspend", async (req) => {
    const staff = await operatorContext(req);
    return suspendTenant(parseInput(idParam, req.params).id, staff.email, parseInput(opsSuspendInput, req.body).reason);
  });

  app.post("/api/ops/tenants/:id/unsuspend", async (req) => {
    const staff = await operatorContext(req);
    return unsuspendTenant(parseInput(idParam, req.params).id, staff.email);
  });

  app.post("/api/ops/tenants/:id/trial", async (req) => {
    const staff = await operatorContext(req);
    return extendTrial(parseInput(idParam, req.params).id, staff.email, parseInput(opsTrialInput, req.body).days);
  });

  /** Data retention: a cancelled business's customer data, erased for good. */
  app.post("/api/ops/tenants/:id/erase", async (req) => {
    const staff = await operatorContext(req);
    return eraseCustomerData(parseInput(idParam, req.params).id, staff.email, parseInput(opsEraseInput, req.body).confirm);
  });

  app.post("/api/ops/tenants/:id/network/remove", async (req) => {
    const staff = await operatorContext(req);
    return removeFromNetwork(parseInput(idParam, req.params).id, staff.email, parseInput(opsSuspendInput, req.body).reason);
  });
}
