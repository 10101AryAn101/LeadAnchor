import { randomUUID } from "node:crypto";
import type { SimulatorScenarioInput } from "@leadanchor/contracts";
import { logger } from "../../lib/logger";
import type { CallHandle, ProvisionedNumber, TelephonyEvent, TelephonyProvider } from "./types";

type Scenario = Required<Omit<SimulatorScenarioInput, "callerName">> & { callerName?: string };

interface SimulatedCall {
  handle: CallHandle;
  scenario: Scenario;
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

  setEventSink(sink: EventSink) {
    this.sink = sink;
  }

  /** Starts a simulated inbound call to `toE164`. Returns the provider session id. */
  startCall(toE164: string, scenario: Scenario): CallHandle {
    const handle: CallHandle = { sessionId: `sim-session-${randomUUID()}`, callControlId: `sim-call-${randomUUID()}` };
    this.calls.set(handle.sessionId, { handle, scenario, ended: false, timers: [] });
    this.emitLater(handle, 150, { kind: "call.incoming", from: scenario.callerPhone, to: toE164 });
    return handle;
  }

  async provisionNumber({ areaCode }: { areaCode: string | null }): Promise<ProvisionedNumber> {
    // 555-01XX numbers are reserved for fiction, so a simulated number can never ring a real person.
    const area = areaCode && /^[2-9]\d\d$/.test(areaCode) ? areaCode : "512";
    const line = String(Math.floor(Math.random() * 100)).padStart(2, "0");
    return { e164: `+1${area}55501${line}`, providerNumberId: null };
  }

  async ringOwner(call: CallHandle, input: { timeoutSecs: number }) {
    const sim = this.get(call);
    if (!sim) return;
    const { ownerBehavior, callerBehavior } = sim.scenario;

    if (callerBehavior === "hangs_up_while_ringing") {
      this.emitLater(call, 1600, { kind: "caller.hangup", cause: "originator_cancel" });
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
      const transcript = sim.scenario.consent === "yes" ? "Yes, please text me." : "No thanks.";
      this.emitLater(call, 1300, { kind: "speech.result", tag: input.tag, transcript, confidence: 0.94 });
      return;
    }
    const utterance = sim.scenario.utterance.trim();
    if (!utterance) {
      this.emitLater(call, 1800, { kind: "speech.timeout", tag: input.tag });
      return;
    }
    this.emitLater(call, 1900, { kind: "speech.result", tag: input.tag, transcript: utterance, confidence: 0.91 });
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
