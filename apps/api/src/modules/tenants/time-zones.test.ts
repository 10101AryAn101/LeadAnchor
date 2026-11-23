import {
  onboardingInput,
  settingsUpdateInput,
  suggestTimeZone,
  usTimeZoneLike,
} from "@leadanchor/contracts";
import { describe, expect, it } from "vitest";

describe("time zone for a new business", () => {
  it("follows the business's state, not where the owner happens to be", () => {
    expect(suggestTimeZone("TX", "Asia/Kolkata")).toBe("America/Chicago");
    expect(suggestTimeZone("ca", "Asia/Kolkata")).toBe("America/Los_Angeles");
    expect(suggestTimeZone("AZ", null)).toBe("America/Phoenix");
  });

  it("lets the browser settle a state that spans two zones", () => {
    expect(suggestTimeZone("TX", "America/Denver")).toBe("America/Denver");
    expect(suggestTimeZone("TX", "America/New_York")).toBe("America/Chicago");
    expect(suggestTimeZone("IN", "America/Chicago")).toBe("America/Chicago");
  });

  it("uses the browser's US clock without a state, and Central otherwise", () => {
    expect(suggestTimeZone("", "America/Detroit")).toBe("America/New_York");
    expect(suggestTimeZone(undefined, "Europe/London")).toBe("America/Chicago");
    expect(suggestTimeZone("", "Not/AZone")).toBe("America/Chicago");
  });

  it("matches a zone to the US one that keeps the same clock all year", () => {
    expect(usTimeZoneLike("America/Indiana/Indianapolis")).toBe("America/New_York");
    expect(usTimeZoneLike("America/Boise")).toBe("America/Denver");
    expect(usTimeZoneLike("America/Phoenix")).toBe("America/Phoenix");
    expect(usTimeZoneLike("Asia/Kolkata")).toBeNull();
  });

  it("refuses a time zone that doesn't exist", () => {
    expect(settingsUpdateInput.safeParse({ timezone: "Mars/Olympus" }).success).toBe(false);
    expect(settingsUpdateInput.safeParse({ timezone: "America/Denver" }).success).toBe(true);
    const signup = {
      businessName: "Rivera Plumbing",
      trade: "plumbing",
      ownerName: "Luis",
      ownerCell: "(512) 555-0150",
    } as const;
    expect(onboardingInput.parse(signup).timezone).toBe("America/Chicago");
  });
});
