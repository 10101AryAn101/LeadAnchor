import { afterEach, describe, expect, it, vi } from "vitest";
import { MetaWhatsApp } from "./whatsapp";

afterEach(() => vi.unstubAllGlobals());

const graph = (displayNumber: string) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ display_phone_number: displayNumber }), { status: 200 }),
    ),
  );

describe("WhatsApp on Meta", () => {
  it("reads its own number from Meta, as +E.164", async () => {
    graph("+1 555-010-4242");
    await expect(new MetaWhatsApp("token", "pn_1").ownNumber()).resolves.toBe("+15550104242");
  });

  it("points chat links at the business's own number normally", () => {
    graph("+1 555-010-4242");
    const link = new MetaWhatsApp("token", "pn_1").chatLink("+15125550177", "Hi Demo, ");
    expect(link).toBe("https://wa.me/15125550177?text=Hi%20Demo%2C%20");
  });

  it("in test mode, points chat links at Meta's test number once it's known", async () => {
    graph("15550104242");
    const whatsapp = new MetaWhatsApp("token", "pn_1", { testMode: true });
    await vi.waitFor(() =>
      expect(whatsapp.chatLink("+15125550177", "Hi")).toBe("https://wa.me/15550104242?text=Hi"),
    );
  });
});
