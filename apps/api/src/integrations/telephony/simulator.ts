import { randomUUID } from "node:crypto";
import type { SimulatorScenarioInput } from "@leadanchor/contracts";
import { logger } from "../../lib/logger";
import type { CallHandle, ProvisionedNumber, TelephonyEvent, TelephonyProvider } from "./types";

type Scenario = Required<Omit<SimulatorScenarioInput, "callerName">> & { callerName?: string };

interface SimulatedCall {
  handle: CallHandle;
  scenario: Scenario;
  /** The LeadAnchor number the call came in on. */
  to: string;
  ended: boolean;
  timers: NodeJS.Timeout[];
}

type EventSink = (event: TelephonyEvent) => Promise<void>;

/**
 * A local stand-in for Telnyx. It plays the caller and the owner's phone
 * according to a scenario, emitting the same normalised events the Telnyx
 * adapter produces from real webhooks — so the call-capture engine runs
 * unchanged. Real seconds are compressed so a call plays out in a few seconds.
 */
export class SimulatorTelephony implements TelephonyProvider {
  readonly name = "simulator" as const;
  private sink: EventSink | null = null;
  private readonly calls = new Map<string, SimulatedCall>();
  /** Our own rings to the owner that their phone sent straight back (C-01): echo session → the call that rang them. */
  private readonly echoes = new Map<string, CallHandle>();

  setEventSink(sink: EventSink) {
    this.sink = sink;
  }

  /**
   * Starts a simulated inbound call to `toE164`. Returns the provider session id. A "forwarded" call
   * plays one the owner missed on their own cell (`forwardedFrom`), sent on by their carrier (C-01).
   */
  startCall(toE164: string, scenario: Scenario, forwardedFrom?: string): CallHandle {
    const handle: CallHandle = { sessionId: `sim-session-${randomUUID()}`, callControlId: `sim-call-${randomUUID()}` };
    this.calls.set(handle.sessionId, { handle, scenario, to: toE164, ended: false, timers: [] });
    const forwarded = scenario.route === "forwarded" && forwardedFrom ? { forwardedFrom } : {};
    this.emitLater(handle, 150, { kind: "call.incoming", from: scenario.callerPhone, to: toE164, ...forwarded });
    // Nothing rings on our side of a forwarded call, so a caller who gives up does so as it's picked up.
    if (forwardedFrom && scenario.route === "forwarded" && scenario.callerBehavior === "hangs_up_while_ringing") {
      this.emitLater(handle, 700, { kind: "caller.hangup", cause: "originator_cancel" });
    }
    return handle;
  }

  async provisionNumber({ areaCode }: { areaCode: string | null; state?: string | null }): Promise<ProvisionedNumber> {
    // 555-01XX numbers are reserved for fiction, so a simulated number can never ring a real person.
    const area = areaCode && /^[2-9]\d\d$/.test(areaCode) ? areaCode : "512";
    const line = String(Math.floor(Math.random() * 100)).padStart(2, "0");
    return { e164: `+1${area}55501${line}`, providerNumberId: null };
  }

  /** Simulated numbers are fictional (555-01XX): there's nothing to give back. */
  async releaseNumber() {}

  async ringOwner(call: CallHandle, input: { ownerE164: string; fromE164: string; timeoutSecs: number }) {
    const sim = this.get(call);
    if (!sim) return;
    const { ownerBehavior, callerBehavior } = sim.scenario;

    if (callerBehavior === "hangs_up_while_ringing") {
      this.emitLater(call, 1600, { kind: "caller.hangup", cause: "originator_cancel" });
      return;
    }
    if (ownerBehavior === "forwards_back") {
      // C-01: the owner's phone is off or busy and forwards calls to the LeadAnchor number, so our
      // ring comes straight back as a new incoming call, still showing the caller's number. An echo
      // that gets rung again just rings out, so a broken engine can't loop here forever.
      if (this.echoes.has(call.sessionId)) {
        this.emitLater(call, 1400, { kind: "owner.unavailable", reason: "no_answer" });
        return;
      }
      const echo: CallHandle = { sessionId: `sim-session-${randomUUID()}`, callControlId: `sim-call-${randomUUID()}` };
      this.calls.set(echo.sessionId, { handle: echo, scenario: sim.scenario, to: sim.to, ended: false, timers: [] });
      this.echoes.set(echo.sessionId, call);
      this.emitLater(echo, 900, { kind: "call.incoming", from: input.fromE164, to: sim.to, forwardedFrom: input.ownerE164 });
      return;
    }
    if (ownerBehavior === "answers") {
      this.emitLater(call, 1400, { kind: "owner.answered" });
      this.emitLater(call, 4200, { kind: "caller.hangup", cause: "normal_clearing" });
      return;
    }
    if (ownerBehavior === "carrier_voicemail") {
      // Answering-machine detection spots the owner's carrier voicemail and we take the call back.
      this.emitLater(call, 2000, { kind: "owner.unavailable", reason: "machine" });
      return;
    }
    this.emitLater(call, Math.min(input.timeoutSecs, 3) * 700, { kind: "owner.unavailable", reason: "no_answer" });
  }

  async answer() {
    // Nothing to emit: the engine continues when it issues its next command.
  }

  async say(call: CallHandle, input: { text: string; tag: string }) {
    const sim = this.get(call);
    if (!sim) return;
    if (sim.scenario.callerBehavior === "hangs_up_during_greeting" && input.tag === "greeting") {
      this.emitLater(call, 1100, { kind: "caller.hangup", cause: "normal_clearing" });
      return;
    }
    const ms = Math.min(2600, Math.max(700, input.text.length * 14));
    this.emitLater(call, ms, { kind: "playback.finished", tag: input.tag });
  }

  async listen(call: CallHandle, input: { tag: string }) {
    const sim = this.get(call);
    if (!sim) return;
    if (input.tag === "consent") {
      if (sim.scenario.consent === "press1") {
        this.emitLater(call, 1100, { kind: "dtmf", digit: "1" });
        return;
      }
      if (sim.scenario.consent === "hangs_up") {
        this.emitLater(call, 1000, { kind: "caller.hangup", cause: "normal_clearing" });
        return;
      }
      const transcript = sim.scenario.consent === "yes" ? "Yes, please text me." : "No thanks.";
      this.emitLater(call, 1300, { kind: "speech.result", tag: input.tag, transcript, confidence: 0.94 });
      return;
    }
    const utterance = sim.scenario.utterance.trim();
    if (sim.scenario.callerBehavior === "talks_too_long") {
      // Never pauses, so listening runs out with the sentence unfinished (C-39).
      const partial = utterance || "Hi, so my water heater started leaking yesterday and then this morning";
      this.emitLater(call, 1900, { kind: "speech.timeout", tag: input.tag, partial });
      return;
    }
    if (!utterance) {
      this.emitLater(call, 1800, { kind: "speech.timeout", tag: input.tag });
      return;
    }
    this.emitLater(call, 1900, { kind: "speech.result", tag: input.tag, transcript: utterance, confidence: 0.91 });
  }

  /** Whether each simulated owner phone has call forwarding switched on (C-01). Defaults to on. */
  private readonly forwarding = new Map<string, boolean>();

  simulateForwarding(ownerE164: string, forwards: boolean) {
    this.forwarding.set(ownerE164, forwards);
  }

  async placeTestCall(input: { from: string; to: string; ringSecs: number }) {
    if (this.forwarding.get(input.to) === false) return; // the cell just rings out; nothing comes back
    // Unanswered, the owner's carrier forwards it to the LeadAnchor number: a call from our own number.
    const handle: CallHandle = { sessionId: `sim-session-${randomUUID()}`, callControlId: `sim-call-${randomUUID()}` };
    const scenario: Scenario = {
      callerPhone: input.from,
      route: "direct",
      ownerBehavior: "no_answer",
      callerBehavior: "hangs_up_while_ringing",
      utterance: "",
      consent: "no",
      voicemailText: "",
    };
    this.calls.set(handle.sessionId, { handle, scenario, to: input.from, ended: false, timers: [] });
    this.emitLater(handle, Math.min(input.ringSecs, 4) * 700, { kind: "call.incoming", from: input.from, to: input.from });
  }

  async stopListening() {
    // The simulated caller answers with either speech or the keypad, never both.
  }

  async recordVoicemail(call: CallHandle) {
    const sim = this.get(call);
    if (!sim) return;
    const text = sim.scenario.voicemailText.trim();
    if (!text) {
      this.emitLater(call, 1500, { kind: "caller.hangup", cause: "normal_clearing" });
      return;
    }
    const seconds = Math.max(4, Math.round(text.split(/\s+/).length / 2.5));
    this.emitLater(call, 1800, { kind: "recording.saved", recordingUrl: null, durationSecs: seconds });
    this.emitLater(call, 2000, { kind: "caller.hangup", cause: "normal_clearing" });
    // Speech-to-text arrives after the call ends, as with Telnyx.
    this.emitLater(call, 3200, { kind: "recording.transcribed", text }, { afterEnd: true });
  }

  async hangup(call: CallHandle) {
    this.emitLater(call, 250, { kind: "caller.hangup", cause: "normal_clearing" });
  }

  async reject(call: CallHandle) {
    // Never answered, so nothing more happens on it.
    const sim = this.calls.get(call.sessionId);
    if (sim) {
      sim.ended = true;
      setTimeout(() => this.calls.delete(call.sessionId), 10_000);
    }
    // An echo turned away as busy: the owner's carrier ends our ring to them the same way (C-01).
    const original = this.echoes.get(call.sessionId);
    this.echoes.delete(call.sessionId);
    if (original) this.emitLater(original, 300, { kind: "owner.unavailable", reason: "busy" });
  }

  private get(call: CallHandle) {
    const sim = this.calls.get(call.sessionId);
    return sim && !sim.ended ? sim : null;
  }

  private emitLater(
    handle: CallHandle,
    delayMs: number,
    event: DistributiveOmit<TelephonyEvent, "eventId" | "occurredAt" | "sessionId" | "callControlId">,
    opts: { afterEnd?: boolean } = {},
  ) {
    const sim = this.calls.get(handle.sessionId);
    if (!sim) return;
    const timer = setTimeout(async () => {
      if (sim.ended && !opts.afterEnd) return;
      if (event.kind === "caller.hangup") {
        sim.ended = true;
        // Let late events (transcription) finish, then forget the call.
        setTimeout(() => this.calls.delete(handle.sessionId), 10_000);
      }
      const full = { ...event, ...handle, eventId: randomUUID(), occurredAt: new Date() } as TelephonyEvent;
      try {
        await this.sink?.(full);
      } catch (error) {
        logger.error({ err: error, kind: event.kind }, "simulator: engine failed to handle event");
      }
    }, delayMs);
    sim.timers.push(timer);
  }
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
