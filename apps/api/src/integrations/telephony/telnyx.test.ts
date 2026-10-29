import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TelnyxTelephony, type TelnyxWebhook, verifyTelnyxSignature } from "./telnyx";

describe("Telnyx webhook signature (ed25519 over `${timestamp}|${rawBody}`)", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  // Telnyx shows the raw 32-byte key, base64-encoded: the last 32 bytes of the SPKI DER.
  const publicKeyBase64 = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
  const rawBody = JSON.stringify({ data: { id: "evt_1", event_type: "call.initiated" } });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = sign(null, Buffer.from(`${timestamp}|${rawBody}`), privateKey).toString("base64");

  it("accepts a genuine webhook", () => {
    expect(verifyTelnyxSignature({ rawBody, signature, timestamp, publicKeyBase64, toleranceSecs: 300 })).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyTelnyxSignature({ rawBody: rawBody.replace("evt_1", "evt_2"), signature, timestamp, publicKeyBase64, toleranceSecs: 300 })).toBe(false);
  });

  it("rejects a replayed (old) webhook", () => {
    const old = String(Math.floor(Date.now() / 1000) - 3600);
    const oldSignature = sign(null, Buffer.from(`${old}|${rawBody}`), privateKey).toString("base64");
    expect(verifyTelnyxSignature({ rawBody, signature: oldSignature, timestamp: old, publicKeyBase64, toleranceSecs: 300 })).toBe(false);
  });

  it("rejects a missing signature", () => {
    expect(verifyTelnyxSignature({ rawBody, signature: undefined, timestamp, publicKeyBase64, toleranceSecs: 300 })).toBe(false);
  });
});

describe("Telnyx event translation", () => {
  const telnyx = new TelnyxTelephony({ apiKey: "test", connectionId: "conn" });
  const state = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64");
  const webhook = (event_type: string, payload: Record<string, unknown>): TelnyxWebhook => ({
    data: { id: `evt-${event_type}`, event_type, occurred_at: "2026-10-28T10:00:00Z", record_type: "event", payload: { call_session_id: "sess-1", ...payload } },
  });

  it("turns an inbound call.initiated into call.incoming", async () => {
    const [event] = await telnyx.ingest(webhook("call.initiated", { call_control_id: "a-leg", direction: "incoming", from: "+15125550111", to: "+15125550173" }));
    expect(event).toMatchObject({ kind: "call.incoming", from: "+15125550111", to: "+15125550173", sessionId: "sess-1", callControlId: "a-leg" });
  });

  it("ignores outbound legs it dialled itself", async () => {
    expect(await telnyx.ingest(webhook("call.initiated", { call_control_id: "b-leg", direction: "outgoing" }))).toEqual([]);
  });

  it("treats the owner leg timing out as 'owner unavailable', pointing back at the caller's leg", async () => {
    const [event] = await telnyx.ingest(
      webhook("call.hangup", { call_control_id: "b-leg", hangup_cause: "timeout", client_state: state({ role: "owner", aLeg: "a-leg" }) }),
    );
    expect(event).toMatchObject({ kind: "owner.unavailable", reason: "no_answer", callControlId: "a-leg" });
  });

  it("carries the speak tag through client_state", async () => {
    const [event] = await telnyx.ingest(webhook("call.speak.ended", { call_control_id: "a-leg", client_state: state({ role: "caller", tag: "greeting" }) }));
    expect(event).toMatchObject({ kind: "playback.finished", tag: "greeting" });
  });

  it("maps the Telnyx voicemail transcript (C-13)", async () => {
    const [event] = await telnyx.ingest(webhook("call.recording.transcription.saved", { call_control_id: "a-leg", transcription_text: " Pipe burst " }));
    expect(event).toMatchObject({ kind: "recording.transcribed", text: "Pipe burst" });
  });

  it("maps a keypad press (C-06 'press 1')", async () => {
    const [event] = await telnyx.ingest(webhook("call.dtmf.received", { call_control_id: "a-leg", digit: "1" }));
    expect(event).toMatchObject({ kind: "dtmf", digit: "1", callControlId: "a-leg" });
  });

  it("maps a caller hang-up with its cause", async () => {
    const [event] = await telnyx.ingest(webhook("call.hangup", { call_control_id: "a-leg", hangup_cause: "originator_cancel" }));
    expect(event).toMatchObject({ kind: "caller.hangup", cause: "originator_cancel" });
  });
});
