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
  | (EventBase & {
      kind: "call.incoming";
      from: string;
      to: string;
      /**
       * The number the caller first dialled, when their call was forwarded here (the SIP Diversion
       * header). It's the owner's own cell when they missed it and their forwarding sent it on (C-01);
       * absent on a call dialled straight to the LeadAnchor number (C-02).
       */
      forwardedFrom?: string;
    })
  | (EventBase & { kind: "owner.answered" })
  | (EventBase & { kind: "owner.unavailable"; reason: "no_answer" | "busy" | "machine" | "failed" })
  | (EventBase & { kind: "caller.hangup"; cause: string })
  | (EventBase & { kind: "playback.finished"; tag: string })
  | (EventBase & { kind: "speech.result"; tag: string; transcript: string; confidence: number | null })
  /** Listening ended without a finished sentence; `partial` is what the caller was still saying, if anything (C-39). */
  | (EventBase & { kind: "speech.timeout"; tag: string; partial?: string })
  /** A keypad press (DTMF), e.g. "press 1 to get a text" (C-06). */
  | (EventBase & { kind: "dtmf"; digit: string })
  | (EventBase & { kind: "recording.saved"; recordingUrl: string | null; durationSecs: number | null })
  | (EventBase & { kind: "recording.transcribed"; text: string });

export type TelephonyEventKind = TelephonyEvent["kind"];

export interface ProvisionedNumber {
  e164: string;
  providerNumberId: string | null;
}

export interface TelephonyProvider {
  readonly name: TelephonyProviderName;

  /**
   * Orders a local number for a new business (C-02): in the owner's area code, or when none is free
   * there, elsewhere in their state, then anywhere in the US, so sign-up never fails on it.
   */
  provisionNumber(input: { areaCode: string | null; state?: string | null }): Promise<ProvisionedNumber>;

  /** Gives a number back to the carrier once the business that had it has left. */
  releaseNumber(number: { e164: string; providerNumberId: string | null }): Promise<void>;

  /** Rings the owner's cell with a timeout and answering-machine detection (C-02). */
  ringOwner(call: CallHandle, input: { ownerE164: string; fromE164: string; timeoutSecs: number }): Promise<void>;

  answer(call: CallHandle): Promise<void>;

  /** Speaks text to the caller; emits playback.finished with the same tag. */
  say(call: CallHandle, input: { text: string; tag: string }): Promise<void>;

  /** Listens for one spoken answer; emits speech.result or speech.timeout with the same tag. */
  listen(call: CallHandle, input: { maxSecs: number; tag: string }): Promise<void>;

  /** Stops listening early, e.g. when the caller answered with the keypad instead. */
  stopListening(call: CallHandle): Promise<void>;

  /** Records a voicemail and transcribes it with the provider's speech-to-text (C-13). */
  recordVoicemail(call: CallHandle, input: { maxSecs: number }): Promise<void>;

  hangup(call: CallHandle): Promise<void>;

  /**
   * Turns an incoming call away unanswered, as a busy line (C-01). Used when our own ring to the
   * owner comes straight back because their phone forwards calls to their LeadAnchor number.
   */
  reject(call: CallHandle): Promise<void>;

  /**
   * Forwarding test (C-01): calls the owner's cell from their LeadAnchor number and lets it
   * ring out. If forwarding is on, their carrier sends it straight back to the LeadAnchor
   * number, which arrives as an incoming call from the LeadAnchor number to itself.
   */
  placeTestCall(input: { from: string; to: string; ringSecs: number }): Promise<void>;
}
