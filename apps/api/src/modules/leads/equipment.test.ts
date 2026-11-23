import { describe, expect, it } from "vitest";
import { equipmentOf } from "./equipment";

describe("the brand and model on the board card (C-09)", () => {
  it("names the equipment from what the AI read", () => {
    expect(equipmentOf({ brand: "Rheem", model: "XG40T06", itemType: "Water heater" })).toBe(
      "Rheem XG40T06 water heater",
    );
    expect(equipmentOf({ brand: "Kohler", itemType: "Toilet" })).toBe("Kohler toilet");
    expect(equipmentOf({ model: "XR13" })).toBe("XR13");
  });

  it("shows nothing without a brand or model", () => {
    expect(equipmentOf({ itemType: "Toilet" })).toBeNull();
    expect(equipmentOf(null)).toBeNull();
    expect(equipmentOf({ brand: "  " })).toBeNull();
  });
});
