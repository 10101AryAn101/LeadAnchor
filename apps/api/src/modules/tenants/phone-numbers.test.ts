import { paymentSettingsInput, settingsUpdateInput, toE164, toUsE164 } from "@leadanchor/contracts";
import { describe, expect, it } from "vitest";

describe("phone numbers typed into forms", () => {
  it("takes a US number however it's written", () => {
    expect(toUsE164("(512) 555-0150")).toBe("+15125550150");
    expect(toUsE164("512-555-0150")).toBe("+15125550150");
    expect(toUsE164("+1 512 555 0150")).toBe("+15125550150");
  });

  it("takes US territories, which share US carriers", () => {
    expect(toUsE164("+1 787 234 5678")).toBe("+17872345678");
  });

  it("refuses numbers from other countries, even ones that also start with +1", () => {
    expect(toUsE164("+91 91403 71702")).toBeNull();
    expect(toUsE164("+1 416 555 0123")).toBeNull();
    expect(toUsE164("+44 7911 123456")).toBeNull();
  });

  it("refuses a number without its area code", () => {
    expect(toUsE164("555-0154")).toBeNull();
  });

  it("still reads any valid number where a caller ID can be foreign", () => {
    expect(toE164("+91 91403 71702")).toBe("+919140371702");
  });

  it("holds every form to US numbers", () => {
    expect(settingsUpdateInput.safeParse({ ownerCell: "+91 91403 71702" }).success).toBe(false);
    expect(settingsUpdateInput.parse({ ownerCell: "(512) 555-0150" }).ownerCell).toBe(
      "+15125550150",
    );
    expect(paymentSettingsInput.safeParse({ zelle: "+91 91403 71702" }).success).toBe(false);
    expect(paymentSettingsInput.parse({ zelle: "Owner@Example.com" }).zelle).toBe(
      "owner@example.com",
    );
  });
});
