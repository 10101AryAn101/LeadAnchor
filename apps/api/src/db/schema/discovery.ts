import { boolean, index, integer, jsonb, pgTable } from "drizzle-orm/pg-core";
import { createdAt, pk } from "./columns";
import { tenantRef } from "./tenancy";

/** One question of a monthly check: asked of an AI assistant, and whether the answer named the business. */
export interface AskedQuestion {
  question: string;
  mentioned: boolean;
  named: string[];
}

/** Where the business's name, phone, address or website disagree between LeadAnchor, Google and its site. */
export interface Mismatch {
  field: "name" | "phone" | "address" | "website";
  detail: string;
}

/** C-42: a monthly check of how often AI assistants mention the business, and whether its details agree. */
export const aiVisibilityChecks = pgTable(
  "ai_visibility_checks",
  {
    id: pk(),
    tenantId: tenantRef(),
    asked: integer("asked").notNull(),
    mentioned: integer("mentioned").notNull(),
    questions: jsonb("questions").$type<AskedQuestion[]>().notNull(),
    mismatches: jsonb("mismatches").$type<Mismatch[]>().notNull(),
    /** Answered by the simulator, not a real AI assistant. */
    simulated: boolean("simulated").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("ai_visibility_checks_tenant_idx").on(t.tenantId, t.createdAt)],
);
