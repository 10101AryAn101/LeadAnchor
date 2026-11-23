import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TelnyxTelephony, type TelnyxWebhook, diversionNumber, verifyTelnyxSignature } from "./telnyx";
import type { TelephonyEvent } from "./types";

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

  it("keeps the forwarding test call's own leg out of the call flow (C-01)", async () => {
    expect(await telnyx.ingest(webhook("call.hangup", { call_control_id: "t-leg", hangup_cause: "timeout", client_state: state({ role: "test" }) }))).toEqual([]);
  });

  it("reads the owner's cell off a forwarded call's Diversion header (C-01)", async () => {
    const [event] = await telnyx.ingest(
      webhook("call.initiated", {
        call_control_id: "a-leg",
        direction: "incoming",
        from: "+15125550111",
        to: "+15125550173",
        sip_headers: [{ name: "Diversion", value: "<sip:+15125550199@carrier.example.com;user=phone>;reason=no-answer;counter=1" }],
      }),
    );
    expect(event).toMatchObject({ kind: "call.incoming", from: "+15125550111", forwardedFrom: "+15125550199" });
  });

  it("leaves forwardedFrom off a call dialled straight to the LeadAnchor number", async () => {
    const [event] = await telnyx.ingest(webhook("call.initiated", { call_control_id: "a-leg", direction: "incoming", from: "+15125550111", to: "+15125550173" }));
    expect(event).not.toHaveProperty("forwardedFrom");
  });
});

describe("Telnyx Diversion header (C-01)", () => {
  it("accepts tel: URIs and 10-digit numbers", () => {
    expect(diversionNumber([{ name: "diversion", value: "<tel:5125550199>;reason=user-busy" }])).toBe("+15125550199");
  });

  it("ignores other headers, headers without a number, and missing headers", () => {
    expect(diversionNumber([{ name: "User-to-User", value: "<sip:+15125550199@carrier.example.com>" }])).toBeUndefined();
    expect(diversionNumber([{ name: "Diversion", value: "<sip:voicemail@carrier.example.com>" }])).toBeUndefined();
    expect(diversionNumber(undefined)).toBeUndefined();
  });
});

describe("Telnyx turning a call away (C-01)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects an unanswered call as busy", async () => {
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        requests.push({ url, body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
        return new Response("{}", { status: 200 });
      }),
    );
    const telnyx = new TelnyxTelephony({ apiKey: "test", connectionId: "conn" });
    await telnyx.reject({ sessionId: "sess-2", callControlId: "echo-leg" });
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe("https://api.telnyx.com/v2/calls/echo-leg/actions/reject");
    expect(requests[0]!.body).toMatchObject({ cause: "USER_BUSY" });
  });
});

describe("Telnyx listening (C-39)", () => {
  const webhook = (payload: Record<string, unknown>): TelnyxWebhook => ({
    data: { id: `evt-${Math.random()}`, event_type: "call.transcription", occurred_at: "2026-10-28T10:00:00Z", record_type: "event", payload: { call_session_id: "sess-1", ...payload } },
  });
  const handle = { sessionId: "sess-1", callControlId: "a-leg" };

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function listenThenTimeOut(transcripts: Array<{ transcript: string; is_final: boolean }>) {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const telnyx = new TelnyxTelephony({ apiKey: "test", connectionId: "conn" });
    const timeouts: TelephonyEvent[] = [];
    telnyx.onSyntheticEvent((event) => timeouts.push(event));
    await telnyx.listen(handle, { maxSecs: 20, tag: "need" });
    const results = [];
    for (const data of transcripts) results.push(...(await telnyx.ingest(webhook({ call_control_id: "a-leg", transcription_data: data }))));
    await vi.advanceTimersByTimeAsync(20_000);
    return { results, timeouts };
  }

  it("passes on what a caller was still saying when listening runs out", async () => {
    const { results, timeouts } = await listenThenTimeOut([
      { transcript: "My water heater", is_final: false },
      { transcript: "My water heater is leaking and also", is_final: false },
    ]);
    expect(results).toEqual([]);
    expect(timeouts).toMatchObject([{ kind: "speech.timeout", tag: "need", partial: "My water heater is leaking and also" }]);
  });

  it("times out with nothing when the caller stays silent", async () => {
    const { timeouts } = await listenThenTimeOut([]);
    expect(timeouts).toHaveLength(1);
    expect(timeouts[0]).not.toHaveProperty("partial");
  });

  it("answers with the finished sentence and never times out after it", async () => {
    const { results, timeouts } = await listenThenTimeOut([
      { transcript: "Leaking", is_final: false },
      { transcript: "Leaking water heater", is_final: true },
    ]);
    expect(results).toMatchObject([{ kind: "speech.result", transcript: "Leaking water heater" }]);
    expect(timeouts).toEqual([]);
  });
});

describe("Telnyx number ordering (C-02)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("falls back to the owner's state, then anywhere, when their area code has no numbers", async () => {
    const searches: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url);
        if (path.includes("/available_phone_numbers")) {
          searches.push(decodeURIComponent(path));
          const found = path.includes("administrative_area") ? [{ phone_number: "+15125550100" }] : [];
          return new Response(JSON.stringify({ data: found }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: { id: "order-1" } }), { status: 200 });
      }),
    );
    const telnyx = new TelnyxTelephony({ apiKey: "test", connectionId: "conn" });
    const number = await telnyx.provisionNumber({ areaCode: "737", state: "tx" });
    expect(number).toEqual({ e164: "+15125550100", providerNumberId: "order-1" });
    expect(searches[0]).toContain("filter[national_destination_code]=737");
    expect(searches[1]).toContain("filter[administrative_area]=TX");
    expect(searches).toHaveLength(2);
  });

  it("orders any US number as a last resort", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/available_phone_numbers")) {
          calls += 1;
          const found = String(url).includes("filter%5Bnational") || String(url).includes("filter%5Badministrative") ? [] : [{ phone_number: "+13125550100" }];
          return new Response(JSON.stringify({ data: found }), { status: 200 });
        }
        return new Response(JSON.stringify({ data: { id: "order-2" } }), { status: 200 });
      }),
    );
    const telnyx = new TelnyxTelephony({ apiKey: "test", connectionId: "conn" });
    expect((await telnyx.provisionNumber({ areaCode: "737", state: "TX" })).e164).toBe("+13125550100");
    expect(calls).toBe(3);
  });
});
