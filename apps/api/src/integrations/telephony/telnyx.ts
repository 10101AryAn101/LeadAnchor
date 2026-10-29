import { createPublicKey, verify as verifySignature } from "node:crypto";
import { randomUUID } from "node:crypto";
import { logger } from "../../lib/logger";
import type { CallHandle, ProvisionedNumber, TelephonyEvent, TelephonyProvider } from "./types";

/**
 * Telnyx Call Control v2 adapter (mandated by the spec). Reference notes for
 * every endpoint and event used here: docs/integrations/telnyx.md.
 *
 * Owner ringing strategy: answer the caller's leg, dial the owner as a separate
 * leg with answering-machine detection, and bridge only when a human answers.
 * This stops the owner's carrier voicemail from "answering" and swallowing the lead.
 */

const API = "https://api.telnyx.com/v2";

interface ClientState {
  role: "caller" | "owner";
  /** Caller leg id — lets owner-leg events find the leg to bridge. */
  aLeg?: string;
  tag?: string;
}

export interface TelnyxConfig {
  apiKey: string;
  connectionId: string;
  messagingProfileId?: string;
  /** Optional ringback audio played to the caller while the owner's phone rings. */
  ringbackUrl?: string;
  voice?: string;
}

const encodeState = (state: ClientState) => Buffer.from(JSON.stringify(state)).toString("base64");
function decodeState(raw: unknown): ClientState | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8")) as ClientState;
  } catch {
    return null;
  }
}

/** Telnyx webhook envelope (the fields this adapter reads). */
export interface TelnyxWebhook {
  data: {
    id: string;
    event_type: string;
    occurred_at: string;
    record_type: string;
    payload: Record<string, unknown> & {
      call_control_id?: string;
      call_session_id?: string;
      call_leg_id?: string;
      from?: string;
      to?: string;
      direction?: string;
      client_state?: string;
      hangup_cause?: string;
    };
  };
}

export class TelnyxTelephony implements TelephonyProvider {
  readonly name = "telnyx" as const;
  private readonly listenTimers = new Map<string, NodeJS.Timeout>();
  private readonly answered = new Set<string>();

  constructor(private readonly config: TelnyxConfig) {}

  /* ── Commands ──────────────────────────────────────────────────────────── */

  async provisionNumber({ areaCode }: { areaCode: string | null }): Promise<ProvisionedNumber> {
    const params = new URLSearchParams({
      "filter[country_code]": "US",
      "filter[features][]": "voice",
      "filter[limit]": "1",
      ...(areaCode ? { "filter[national_destination_code]": areaCode } : {}),
    });
    params.append("filter[features][]", "sms");
    const search = await this.request<{ data: Array<{ phone_number: string }> }>("GET", `/available_phone_numbers?${params}`);
    const candidate = search.data[0]?.phone_number;
    if (!candidate) throw new Error(`No Telnyx numbers available${areaCode ? ` in area code ${areaCode}` : ""}.`);

    const order = await this.request<{ data: { id: string } }>("POST", "/number_orders", {
      phone_numbers: [{ phone_number: candidate }],
      connection_id: this.config.connectionId,
      ...(this.config.messagingProfileId ? { messaging_profile_id: this.config.messagingProfileId } : {}),
    });
    return { e164: candidate, providerNumberId: order.data.id };
  }

  async ringOwner(call: CallHandle, input: { ownerE164: string; fromE164: string; timeoutSecs: number }) {
    await this.answer(call);
    if (this.config.ringbackUrl) {
      await this.command(call.callControlId, "playback_start", { audio_url: this.config.ringbackUrl, loop: "infinity" }, { role: "caller" });
    }
    await this.request("POST", "/calls", {
      connection_id: this.config.connectionId,
      to: input.ownerE164,
      from: input.fromE164,
      timeout_secs: input.timeoutSecs,
      link_to: call.callControlId,
      answering_machine_detection: "premium",
      client_state: encodeState({ role: "owner", aLeg: call.callControlId }),
      command_id: randomUUID(),
    });
  }

  async answer(call: CallHandle) {
    if (this.answered.has(call.callControlId)) return;
    await this.command(call.callControlId, "answer", {}, { role: "caller" });
    this.answered.add(call.callControlId);
  }

  async say(call: CallHandle, input: { text: string; tag: string }) {
    await this.command(
      call.callControlId,
      "speak",
      { payload: input.text, payload_type: "text", voice: this.config.voice ?? "female", language: "en-US" },
      { role: "caller", tag: input.tag },
    );
  }

  async listen(call: CallHandle, input: { maxSecs: number; tag: string }) {
    await this.command(
      call.callControlId,
      "transcription_start",
      {
        transcription_engine: "Telnyx",
        transcription_engine_config: { language: "en", transcription_model: "openai/whisper-large-v3-turbo" },
        transcription_tracks: "inbound",
      },
      { role: "caller", tag: input.tag },
    );
    // The webhook handler turns the first final transcript into speech.result; this timer covers silence.
    const timer = setTimeout(() => {
      this.listenTimers.delete(call.callControlId);
      void this.command(call.callControlId, "transcription_stop", {}, { role: "caller", tag: input.tag }).catch(() => {});
      this.timeoutSink?.({ kind: "speech.timeout", tag: input.tag, ...call, eventId: randomUUID(), occurredAt: new Date() });
    }, input.maxSecs * 1000);
    timer.unref();
    this.listenTimers.set(call.callControlId, timer);
  }

  async stopListening(call: CallHandle) {
    const timer = this.listenTimers.get(call.callControlId);
    if (!timer) return;
    clearTimeout(timer);
    this.listenTimers.delete(call.callControlId);
    await this.command(call.callControlId, "transcription_stop", {}, { role: "caller" }).catch(() => {});
  }

  async recordVoicemail(call: CallHandle, input: { maxSecs: number }) {
    await this.command(
      call.callControlId,
      "record_start",
      {
        format: "mp3",
        channels: "single",
        play_beep: true,
        max_length: input.maxSecs,
        timeout_secs: 5,
        recording_track: "inbound",
        // C-13: Telnyx speech-to-text ("B" = Telnyx's in-house engine) → call.recording.transcription.saved
        transcription: true,
        transcription_engine: "B",
      },
      { role: "caller", tag: "voicemail" },
    );
  }

  async hangup(call: CallHandle) {
    await this.command(call.callControlId, "hangup", {}, { role: "caller" }).catch((error) => {
      // Hanging up a call that already ended is not an error for us.
      logger.debug({ err: error }, "telnyx hangup ignored");
    });
  }

  /* ── Webhooks ──────────────────────────────────────────────────────────── */

  /** Where speech timeouts (raised by this adapter, not by Telnyx) are delivered. */
  private timeoutSink: ((event: TelephonyEvent) => void) | null = null;
  onSyntheticEvent(sink: (event: TelephonyEvent) => void) {
    this.timeoutSink = sink;
  }

  /**
   * Translates one Telnyx webhook into zero or more normalised events. Owner-leg
   * events are resolved here (bridge on human, hang up on machine) because they
   * are an implementation detail of ringOwner().
   */
  async ingest(webhook: TelnyxWebhook): Promise<TelephonyEvent[]> {
    const { data } = webhook;
    const p = data.payload;
    const state = decodeState(p.client_state);
    const sessionId = String(p.call_session_id ?? "");
    const base = { eventId: data.id, occurredAt: new Date(data.occurred_at), sessionId };

    if (state?.role === "owner") {
      const callerLeg = state.aLeg ?? "";
      const handle = { ...base, callControlId: callerLeg };
      switch (data.event_type) {
        case "call.machine.premium.detection.ended":
        case "call.machine.detection.ended": {
          // Premium AMD results: human_residence | human_business | machine | silence | fax_detected | not_sure.
          // Only a confirmed machine or fax is treated as "owner unavailable" — when unsure, connect the owner.
          const result = String((p as { result?: string }).result ?? "");
          if (result !== "machine" && result !== "fax_detected") {
            await this.command(String(p.call_control_id), "bridge", { call_control_id: callerLeg }, state).catch((e) =>
              logger.error({ err: e }, "telnyx bridge failed"),
            );
            return [{ kind: "owner.answered", ...handle }];
          }
          await this.command(String(p.call_control_id), "hangup", {}, state).catch(() => {});
          return [{ kind: "owner.unavailable", reason: "machine", ...handle }];
        }
        case "call.hangup": {
          // hangup_cause: call_rejected | normal_clearing | originator_cancel | timeout | time_limit | user_busy | not_found | no_answer | unspecified
          const cause = String(p.hangup_cause ?? "");
          if (cause === "normal_clearing" || cause === "originator_cancel") return []; // owner hung up after talking, or we hung up a machine
          const reason = cause === "user_busy" || cause === "call_rejected" ? "busy" : cause === "timeout" || cause === "no_answer" ? "no_answer" : "failed";
          return [{ kind: "owner.unavailable", reason, ...handle }];
        }
        default:
          return [];
      }
    }

    const callControlId = String(p.call_control_id ?? "");
    const handle = { ...base, callControlId };

    switch (data.event_type) {
      case "call.initiated":
        if (p.direction !== "incoming") return [];
        return [{ kind: "call.incoming", from: String(p.from ?? ""), to: String(p.to ?? ""), ...handle }];
      case "call.speak.ended":
        return [{ kind: "playback.finished", tag: state?.tag ?? "", ...handle }];
      case "call.transcription": {
        const td = (p as { transcription_data?: { transcript?: string; is_final?: boolean; confidence?: number } }).transcription_data;
        if (!td?.is_final || !td.transcript?.trim()) return [];
        const timer = this.listenTimers.get(callControlId);
        if (!timer) return []; // already resolved
        clearTimeout(timer);
        this.listenTimers.delete(callControlId);
        await this.command(callControlId, "transcription_stop", {}, state ?? { role: "caller" }).catch(() => {});
        return [{ kind: "speech.result", tag: state?.tag ?? "", transcript: td.transcript.trim(), confidence: td.confidence ?? null, ...handle }];
      }
      case "call.dtmf.received": {
        const digit = String((p as { digit?: string }).digit ?? "").trim();
        return digit ? [{ kind: "dtmf", digit, ...handle }] : [];
      }
      case "call.recording.saved": {
        const urls = (p as { recording_urls?: { mp3?: string } }).recording_urls;
        const started = Date.parse(String((p as { recording_started_at?: string }).recording_started_at ?? ""));
        const ended = Date.parse(String((p as { recording_ended_at?: string }).recording_ended_at ?? ""));
        const durationSecs = Number.isFinite(started) && Number.isFinite(ended) ? Math.round((ended - started) / 1000) : null;
        return [{ kind: "recording.saved", recordingUrl: urls?.mp3 ?? null, durationSecs, ...handle }];
      }
      case "call.recording.transcription.saved": {
        const text = String((p as { transcription_text?: string }).transcription_text ?? "").trim();
        return text ? [{ kind: "recording.transcribed", text, ...handle }] : [];
      }
      case "call.hangup":
        this.answered.delete(callControlId);
        return [{ kind: "caller.hangup", cause: String(p.hangup_cause ?? "unknown"), ...handle }];
      default:
        return [];
    }
  }

  /* ── HTTP ──────────────────────────────────────────────────────────────── */

  private command(callControlId: string, action: string, body: Record<string, unknown>, state: ClientState) {
    return this.request("POST", `/calls/${encodeURIComponent(callControlId)}/actions/${action}`, {
      ...body,
      client_state: encodeState(state),
      command_id: randomUUID(),
    });
  }

  private async request<T = unknown>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await response.json().catch(() => ({}))) as { errors?: Array<{ detail?: string }> };
    if (!response.ok) {
      throw new Error(`Telnyx ${method} ${path} failed (${response.status}): ${json.errors?.[0]?.detail ?? "unknown error"}`);
    }
    return json as T;
  }
}

/**
 * Verifies a Telnyx webhook: ed25519 signature over `${timestamp}|${rawBody}`,
 * using the account's public key (Mission Control → Keys & Credentials → Public Key).
 */
export function verifyTelnyxSignature(input: {
  rawBody: string;
  signature: string | undefined;
  timestamp: string | undefined;
  publicKeyBase64: string;
  toleranceSecs: number;
}): boolean {
  const { rawBody, signature, timestamp, publicKeyBase64, toleranceSecs } = input;
  if (!signature || !timestamp) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSecs) return false;

  // Wrap the raw 32-byte key in an SPKI header so Node can load it.
  const raw = Buffer.from(publicKeyBase64, "base64");
  const spki = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]);
  const key = createPublicKey({ key: spki, format: "der", type: "spki" });
  return verifySignature(null, Buffer.from(`${timestamp}|${rawBody}`), key, Buffer.from(signature, "base64"));
}
