import type { ConsentType } from "@leadanchor/contracts";
import { type Firestore, Timestamp, getFirestore } from "firebase-admin/firestore";
import type { ConsentInput, ConsentLedger, ConsentRecord } from "../../modules/compliance/consent-ledger";
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
