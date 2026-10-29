/**
 * Telephony port. The call-capture engine only speaks this vocabulary;
 * adapters translate it to a provider (Telnyx in production, the local
 * simulator in development).
 */

export type TelephonyProviderName = "telnyx" | "simulator";

/** Identifies the caller's leg of one call at the provider. */
export interface CallHandle {
  /** Provider call session id (shared by all legs). */
  sessionId: string;
  /** Provider id of the caller's leg (Telnyx call_control_id). */
  callControlId: string;
}

interface EventBase extends CallHandle {
  /** Provider event id — used to drop duplicate webhook deliveries. */
  eventId: string;
  occurredAt: Date;
}

/** Normalised events, regardless of provider. */
export type TelephonyEvent =
  | (EventBase & { kind: "call.incoming"; from: string; to: string })
  | (EventBase & { kind: "owner.answered" })
  | (EventBase & { kind: "owner.unavailable"; reason: "no_answer" | "busy" | "machine" | "failed" })
  | (EventBase & { kind: "caller.hangup"; cause: string })
  | (EventBase & { kind: "playback.finished"; tag: string })
  | (EventBase & { kind: "speech.result"; tag: string; transcript: string; confidence: number | null })
  | (EventBase & { kind: "speech.timeout"; tag: string })
  | (EventBase & { kind: "recording.saved"; recordingUrl: string | null; durationSecs: number | null })
  | (EventBase & { kind: "recording.transcribed"; text: string });

export type TelephonyEventKind = TelephonyEvent["kind"];

export interface ProvisionedNumber {
  e164: string;
  providerNumberId: string | null;
}

export interface TelephonyProvider {
  readonly name: TelephonyProviderName;

  /** Orders a local number for a new business (C-02). */
  provisionNumber(input: { areaCode: string | null }): Promise<ProvisionedNumber>;

  /** Rings the owner's cell with a timeout and answering-machine detection (C-02). */
  ringOwner(call: CallHandle, input: { ownerE164: string; fromE164: string; timeoutSecs: number }): Promise<void>;

  answer(call: CallHandle): Promise<void>;

  /** Speaks text to the caller; emits playback.finished with the same tag. */
  say(call: CallHandle, input: { text: string; tag: string }): Promise<void>;

  /** Listens for one spoken answer; emits speech.result or speech.timeout with the same tag. */
  listen(call: CallHandle, input: { maxSecs: number; tag: string }): Promise<void>;

  /** Records a voicemail and transcribes it with the provider's speech-to-text (C-13). */
  recordVoicemail(call: CallHandle, input: { maxSecs: number }): Promise<void>;

  hangup(call: CallHandle): Promise<void>;
}
