import { consentLedger, telephony } from "../../container";
import { CallEngine } from "./call-engine";

/** The single call engine instance, driven by Telnyx webhooks or the local simulator. */
export const callEngine = new CallEngine(telephony, consentLedger);
