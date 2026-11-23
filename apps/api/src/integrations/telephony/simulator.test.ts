import { afterEach, describe, expect, it, vi } from "vitest";
import { SimulatorTelephony } from "./simulator";
import type { TelephonyEvent } from "./types";

const LINE = "+15125550177";
const OWNER = "+15125550199";
const CALLER = "+15125550142";

const scenario = {
  callerPhone: CALLER,
  route: "direct" as const,
  ownerBehavior: "no_answer" as const,
  callerBehavior: "talks_to_dispatcher" as const,
  utterance: "My water heater is leaking",
  consent: "yes" as const,
  voicemailText: "",
};

describe("simulated forwarding (C-01)", () => {
  afterEach(() => vi.useRealTimers());

  function setup() {
    vi.useFakeTimers();
    const sim = new SimulatorTelephony();
    const events: TelephonyEvent[] = [];
    sim.setEventSink(async (event) => {
      events.push(event);
    });
    return { sim, events };
  }

  it("plays a call the owner missed on their own cell as forwarded from it", async () => {
    const { sim, events } = setup();
    sim.startCall(LINE, { ...scenario, route: "forwarded" }, OWNER);
    await vi.advanceTimersByTimeAsync(200);
    expect(events).toMatchObject([{ kind: "call.incoming", from: CALLER, to: LINE, forwardedFrom: OWNER }]);
  });

  it("sends our ring straight back when the owner's phone forwards it, and ends that ring as busy once it's turned away", async () => {
    const { sim, events } = setup();
    const call = sim.startCall(LINE, { ...scenario, ownerBehavior: "forwards_back" });
    await vi.advanceTimersByTimeAsync(200);
    await sim.ringOwner(call, { ownerE164: OWNER, fromE164: CALLER, timeoutSecs: 18 });
    await vi.advanceTimersByTimeAsync(1000);
    const echo = events[1];
    expect(echo).toMatchObject({ kind: "call.incoming", from: CALLER, to: LINE, forwardedFrom: OWNER });
    expect(echo?.sessionId).not.toBe(call.sessionId);

    await sim.reject(echo!);
    await vi.advanceTimersByTimeAsync(400);
    expect(events[2]).toMatchObject({ kind: "owner.unavailable", reason: "busy", sessionId: call.sessionId });
  });
});
