import type { ConsentType } from "@leadanchor/contracts";
import { type Firestore, Timestamp, getFirestore } from "firebase-admin/firestore";
import type { ConsentInput, ConsentLedger, ConsentRecord, LocalConsentLedger } from "../../modules/compliance/consent-ledger";
import { logger } from "../../lib/logger";
import { firebaseApp } from "./app";

/**
 * Consent ledger on Firestore — the "Firebase ledger" named in the spec (C-27).
 * Layout: tenants/{tenantId}/consent_ledger/{autoId}. Documents are only ever
 * created; Firestore security rules deny update/delete for clients.
 */
export class FirestoreConsentLedger implements ConsentLedger {
  readonly backend = "firestore" as const;
  private readonly db: Firestore;

  constructor() {
    this.db = getFirestore(firebaseApp());
  }

  private collection(tenantId: string) {
    return this.db.collection("tenants").doc(tenantId).collection("consent_ledger");
  }

  async record(input: ConsentInput) {
    const ref = await this.collection(input.tenantId).add({
      ...input,
      evidence: input.evidence ?? null,
      ipAddress: input.ipAddress ?? null,
      callId: input.callId ?? null,
      recordedAt: Timestamp.now(),
    });
    return { id: ref.id };
  }

  /** Stores a copy of a record kept elsewhere, under the same id, so copying twice changes nothing. */
  async copy(record: ConsentRecord) {
    await this.collection(record.tenantId)
      .doc(record.id)
      .set({
        tenantId: record.tenantId,
        phoneE164: record.phoneE164,
        type: record.type,
        action: record.action,
        source: record.source,
        textVersion: record.textVersion,
        evidence: record.evidence ?? null,
        ipAddress: record.ipAddress ?? null,
        grantedTo: record.grantedTo,
        callId: record.callId ?? null,
        recordedAt: Timestamp.fromDate(record.recordedAt),
      });
  }

  async latest(tenantId: string, phoneE164: string, type: ConsentType) {
    const snapshot = await this.collection(tenantId)
      .where("phoneE164", "==", phoneE164)
      .where("type", "==", type)
      .orderBy("recordedAt", "desc")
      .limit(1)
      .get();
    const doc = snapshot.docs[0];
    return doc ? toRecord(doc.id, doc.data()) : null;
  }

  async list(tenantId: string, filter: { phoneE164?: string; limit?: number } = {}) {
    let query = this.collection(tenantId).orderBy("recordedAt", "desc").limit(filter.limit ?? 100);
    if (filter.phoneE164) query = query.where("phoneE164", "==", filter.phoneE164);
    const snapshot = await query.get();
    return snapshot.docs.map((doc) => toRecord(doc.id, doc.data()));
  }
}

function toRecord(id: string, data: FirebaseFirestore.DocumentData): ConsentRecord {
  return {
    id,
    tenantId: data.tenantId,
    phoneE164: data.phoneE164,
    type: data.type,
    action: data.action,
    source: data.source,
    textVersion: data.textVersion,
    evidence: data.evidence ?? null,
    ipAddress: data.ipAddress ?? null,
    grantedTo: data.grantedTo,
    callId: data.callId ?? null,
    recordedAt: (data.recordedAt as Timestamp).toDate(),
  };
}

/**
 * The local ledger stays the record every consent check reads (so nothing recorded before
 * Firebase was connected is lost, and checks need no Firestore indexes), and each new record is
 * copied to the Firebase ledger the spec names. Records are often written inside a larger
 * transaction, so the copy waits until the record can be read back, i.e. has committed.
 */
export class MirroredConsentLedger implements ConsentLedger {
  readonly backend = "local-and-firestore" as const;

  constructor(
    private readonly local: LocalConsentLedger,
    private readonly firestore: FirestoreConsentLedger,
  ) {}

  async record(input: ConsentInput, tx?: Parameters<ConsentLedger["record"]>[1]) {
    const result = await this.local.record(input, tx);
    void this.copyOnceCommitted(input.tenantId, result.id);
    return result;
  }

  latest(...args: Parameters<ConsentLedger["latest"]>) {
    return this.local.latest(...args);
  }

  list(...args: Parameters<ConsentLedger["list"]>) {
    return this.local.list(...args);
  }

  private async copyOnceCommitted(tenantId: string, id: string) {
    for (const waitMs of [300, 2_000, 10_000]) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      try {
        const record = await this.local.byId(tenantId, id);
        if (!record) continue;
        await this.firestore.copy(record);
        return;
      } catch (error) {
        logger.warn({ err: error, consentId: id }, "consent copy to Firestore failed");
        return;
      }
    }
  }
}
