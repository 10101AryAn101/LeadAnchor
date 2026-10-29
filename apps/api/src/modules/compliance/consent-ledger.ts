import type { ConsentAction, ConsentSource, ConsentType } from "@leadanchor/contracts";
import { and, desc, eq, sql } from "drizzle-orm";
import { type Tx, withTenant } from "../../db/client";
import { consentLedger } from "../../db/schema";
import { sha256 } from "../../lib/crypto";

/** Version of the words the caller agreed to. Bump whenever the consent prompt changes (C-27). */
export const CONSENT_TEXT_VERSION = "dispatcher-sms-v1";

export interface ConsentInput {
  tenantId: string;
  phoneE164: string;
  type: ConsentType;
  action: ConsentAction;
  source: ConsentSource;
  textVersion: string;
  /** What proves it: the transcribed "yes", the ticked checkbox text, the STOP message… */
  evidence?: string | null;
  ipAddress?: string | null;
  grantedTo: string;
  callId?: string | null;
}

export interface ConsentRecord extends ConsentInput {
  id: string;
  recordedAt: Date;
}

/**
 * The consent ledger (C-27): immutable records of who agreed to what, when, how and
 * under which wording. Every send checks it (modules/messaging/policy.ts).
 */
export interface ConsentLedger {
  readonly backend: "local" | "firestore";
  /** Appends a record. Pass `tx` to write inside the caller's transaction (local backend only). */
  record(input: ConsentInput, tx?: Tx): Promise<{ id: string }>;
  /** The most recent record for this phone + consent type, or null. */
  latest(tenantId: string, phoneE164: string, type: ConsentType, tx?: Tx): Promise<ConsentRecord | null>;
  list(tenantId: string, filter?: { phoneE164?: string; limit?: number }): Promise<ConsentRecord[]>;
}

/** Interim ledger in PostgreSQL: append-only (no UPDATE/DELETE grants) and hash-chained per business. */
export class LocalConsentLedger implements ConsentLedger {
  readonly backend = "local" as const;

  async record(input: ConsentInput, tx?: Tx) {
    const write = async (t: Tx) => {
      await t.execute(sql`select pg_advisory_xact_lock(hashtext(${`consent:${input.tenantId}`}))`);
      const [last] = await t
        .select({ hash: consentLedger.hash })
        .from(consentLedger)
        .where(eq(consentLedger.tenantId, input.tenantId))
        .orderBy(desc(consentLedger.recordedAt), desc(consentLedger.id))
        .limit(1);
      const recordedAt = new Date();
      const prevHash = last?.hash ?? null;
      const hash = sha256(JSON.stringify([prevHash, input, recordedAt.toISOString()]));
      const [row] = await t
        .insert(consentLedger)
        .values({
          tenantId: input.tenantId,
          phoneE164: input.phoneE164,
          type: input.type,
          action: input.action,
          source: input.source,
          textVersion: input.textVersion,
          evidence: input.evidence ?? null,
          ipAddress: input.ipAddress ?? null,
          grantedTo: input.grantedTo,
          callId: input.callId ?? null,
          prevHash,
          hash,
          recordedAt,
        })
        .returning({ id: consentLedger.id });
      return { id: row!.id };
    };
    return tx ? write(tx) : withTenant(input.tenantId, write);
  }

  async latest(tenantId: string, phoneE164: string, type: ConsentType, tx?: Tx) {
    const read = async (t: Tx) => {
      const [row] = await t
        .select()
        .from(consentLedger)
        .where(and(eq(consentLedger.tenantId, tenantId), eq(consentLedger.phoneE164, phoneE164), eq(consentLedger.type, type)))
        .orderBy(desc(consentLedger.recordedAt))
        .limit(1);
      return row ? toRecord(row) : null;
    };
    return tx ? read(tx) : withTenant(tenantId, read);
  }

  async list(tenantId: string, filter: { phoneE164?: string; limit?: number } = {}) {
    return withTenant(tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(consentLedger)
        .where(
          filter.phoneE164
            ? and(eq(consentLedger.tenantId, tenantId), eq(consentLedger.phoneE164, filter.phoneE164))
            : eq(consentLedger.tenantId, tenantId),
        )
        .orderBy(desc(consentLedger.recordedAt))
        .limit(filter.limit ?? 100);
      return rows.map(toRecord);
    });
  }
}

function toRecord(row: typeof consentLedger.$inferSelect): ConsentRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    phoneE164: row.phoneE164,
    type: row.type,
    action: row.action,
    source: row.source,
    textVersion: row.textVersion,
    evidence: row.evidence,
    ipAddress: row.ipAddress,
    grantedTo: row.grantedTo,
    callId: row.callId,
    recordedAt: row.recordedAt,
  };
}
