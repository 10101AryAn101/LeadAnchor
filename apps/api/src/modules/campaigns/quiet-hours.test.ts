import { CAMPAIGN_SEND_RATES, campaignSendInput } from "@leadanchor/contracts";
import { describe, expect, it } from "vitest";
import { quietUntil, recipientZone } from "./quiet-hours";

describe("quiet hours by the customer's own clock (C-44 AC 4)", () => {
  it("reads the customer's time zone from their address, else uses the business's", () => {
    expect(recipientZone("12 Oak St, Denver, CO 80202", "America/Chicago")).toBe("America/Denver");
    expect(recipientZone("Apt 4, 9 Main St, Brooklyn, ny 11201", "America/Chicago")).toBe(
      "America/New_York",
    );
    expect(recipientZone("400 Pine Ave, Fresno, CA", "America/Chicago")).toBe(
      "America/Los_Angeles",
    );
    expect(recipientZone("12 Oak St 78704", "America/Chicago")).toBe("America/Chicago");
    expect(recipientZone(null, "America/Los_Angeles")).toBe("America/Los_Angeles");
  });

  it("holds an email due in quiet hours until 8 am their time, and lets the rest go", () => {
    // 10 pm in New York (EST) waits for 8 am the next morning.
    expect(quietUntil(new Date("2026-11-06T03:00:00Z"), "America/New_York")?.toISOString()).toBe(
      "2026-11-06T13:00:00.000Z",
    );
    // 6 am in Los Angeles (PST) waits for 8 am the same morning.
    expect(quietUntil(new Date("2026-11-06T14:00:00Z"), "America/Los_Angeles")?.toISOString()).toBe(
      "2026-11-06T16:00:00.000Z",
    );
    // 2 pm in Chicago goes now; so does 8 am sharp.
    expect(quietUntil(new Date("2026-11-06T20:00:00Z"), "America/Chicago")).toBeNull();
    expect(quietUntil(new Date("2026-11-06T14:00:00Z"), "America/Chicago")).toBeNull();
  });
});

describe("the send rate approved with a campaign (C-44 AC 5)", () => {
  it("takes one of the offered rates, or none for the usual pace", () => {
    expect(CAMPAIGN_SEND_RATES).toEqual([20, 60, 120]);
    expect(campaignSendInput.parse({ when: "now", perMinute: 20 })).toEqual({
      when: "now",
      perMinute: 20,
    });
    expect(campaignSendInput.parse({ when: "now" })).toEqual({ when: "now" });
    expect(campaignSendInput.safeParse({ when: "now", perMinute: 500 }).success).toBe(false);
  });
});
