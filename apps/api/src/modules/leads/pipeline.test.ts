import { AUTO_MOVE_REASONS, LEAD_STAGES, autoMoveTarget } from "@leadanchor/contracts";
import { describe, expect, it } from "vitest";

describe("automatic card moves", () => {
  it("moves a new lead to Contacted when the owner reaches out", () => {
    expect(autoMoveTarget("new", "owner_called")).toBe("contacted");
    expect(autoMoveTarget("new", "owner_texted")).toBe("contacted");
    expect(autoMoveTarget("new", "owner_answered")).toBe("contacted");
    expect(autoMoveTarget("new", "form_sent")).toBe("contacted");
  });

  it("moves to Quoted on a price and to Scheduled on a booked visit", () => {
    expect(autoMoveTarget("contacted", "price_set")).toBe("quoted");
    expect(autoMoveTarget("quoted", "visit_booked")).toBe("scheduled");
  });

  it("skips stages that were never used", () => {
    expect(autoMoveTarget("new", "price_set")).toBe("quoted");
    expect(autoMoveTarget("new", "visit_booked")).toBe("scheduled");
  });

  it("never moves a card backwards", () => {
    expect(autoMoveTarget("quoted", "owner_called")).toBeNull();
    expect(autoMoveTarget("scheduled", "price_set")).toBeNull();
    expect(autoMoveTarget("contacted", "owner_texted")).toBeNull();
  });

  it("never touches won or lost jobs, and never moves a card into them", () => {
    for (const reason of AUTO_MOVE_REASONS) {
      expect(autoMoveTarget("won", reason)).toBeNull();
      expect(autoMoveTarget("lost", reason)).toBeNull();
      for (const stage of LEAD_STAGES) expect(["won", "lost"]).not.toContain(autoMoveTarget(stage, reason));
    }
  });
});
