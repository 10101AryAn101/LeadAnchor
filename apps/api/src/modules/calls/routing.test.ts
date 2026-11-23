import { describe, expect, it } from "vitest";
import { missedOnOwnerCell, ringEchoOf } from "./routing";

const OWNER = "+15125550199";
const LINE = "+15125550177";
const CALLER = "+15125550142";

describe("calls forwarded from the owner's cell (C-01)", () => {
  it("knows a call the owner already missed on their own cell", () => {
    expect(missedOnOwnerCell({ forwardedFrom: OWNER }, OWNER)).toBe(true);
  });

  it("still rings the owner for a call dialled straight to the line, or forwarded from another phone", () => {
    expect(missedOnOwnerCell({}, OWNER)).toBe(false);
    expect(missedOnOwnerCell({ forwardedFrom: "+15125550100" }, OWNER)).toBe(false);
    expect(missedOnOwnerCell({ forwardedFrom: OWNER }, null)).toBe(false);
  });
});

describe("our own ring to the owner coming back (C-01)", () => {
  const ringing = [{ id: "call-1", fromE164: CALLER }];

  it("spots the echo by the caller's number", () => {
    expect(ringEchoOf({ from: CALLER, to: LINE, forwardedFrom: OWNER }, OWNER, ringing)).toEqual(ringing[0]);
    expect(ringEchoOf({ from: CALLER, to: LINE }, OWNER, ringing)).toEqual(ringing[0]);
  });

  it("spots an echo shown with the owner's own number or with the LeadAnchor number", () => {
    expect(ringEchoOf({ from: OWNER, to: LINE, forwardedFrom: OWNER }, OWNER, ringing)).toEqual(ringing[0]);
    expect(ringEchoOf({ from: LINE, to: LINE }, OWNER, ringing)).toEqual(ringing[0]);
  });

  it("lets another customer's forwarded call through while the owner is being rung", () => {
    expect(ringEchoOf({ from: "+15125550123", to: LINE, forwardedFrom: OWNER }, OWNER, ringing)).toBeNull();
  });

  it("finds nothing when no call is ringing the owner, or the business has no cell on file", () => {
    expect(ringEchoOf({ from: CALLER, to: LINE, forwardedFrom: OWNER }, OWNER, [])).toBeNull();
    expect(ringEchoOf({ from: CALLER, to: LINE }, null, ringing)).toBeNull();
  });
});
