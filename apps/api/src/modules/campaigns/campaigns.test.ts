import { campaignProblems, fillMergeFields } from "@leadanchor/contracts";
import { describe, expect, it, vi } from "vitest";
import { SimulatorHolidays, usHolidays } from "../../integrations/holidays/simulator";

// The suggestion logic reads the forecast and the calendar; the database and the rest of the container aren't needed.
const forecast = vi.fn();
vi.mock("../../container", () => ({
  ai: { configured: false },
  consentLedger: {},
  channels: {},
  weather: { name: "simulator", forecast: (...args: unknown[]) => forecast(...args) },
  holidays: new SimulatorHolidays(),
}));
vi.mock("../../db/client", () => ({ systemDb: {}, withTenant: vi.fn() }));
vi.mock("../../db/unit-of-work", () => ({ tenantWork: vi.fn() }));
vi.mock("../../jobs/queue", () => ({ QUEUES: {}, enqueue: vi.fn() }));

const { holidayCopy, weatherCopy } = await import("./copy");
const { campaignHtml, campaignText } = await import("./render");
const { ideasFor } = await import("./signals");

const ctx = {
  business: "Demo Plumbing & Heating",
  ownerFirstName: "Dana",
  trade: "plumbing" as const,
};

describe("campaign copy checks (CAN-SPAM: honest subject lines)", () => {
  it("passes an ordinary campaign", () => {
    expect(
      campaignProblems({
        subject: "It's been a while, {first_name}",
        body: "Hi {first_name},\n\nThanks!",
      }),
    ).toEqual([]);
  });

  it("stops a fake reply, shouting, unknown fields and empty copy", () => {
    expect(campaignProblems({ subject: "Re: your water heater", body: "Hi" })[0]).toMatch(/Re:/);
    expect(campaignProblems({ subject: "HUGE SAVINGS TODAY", body: "Hi" })[0]).toMatch(/capitals/);
    expect(campaignProblems({ subject: "Hello {last_name}", body: "Hi" })[0]).toMatch(
      /\{last_name\}/,
    );
    expect(campaignProblems({ subject: "", body: "" })).toEqual([
      "Add a subject line.",
      "Write the message.",
    ]);
  });

  it("fills in the first name, or reads naturally without one", () => {
    expect(fillMergeFields("Hi {first_name},", "Maria", "body")).toBe("Hi Maria,");
    expect(fillMergeFields("Hi {first_name},", null, "body")).toBe("Hi there,");
    expect(fillMergeFields("It's been a while, {first_name}", null, "subject")).toBe(
      "It's been a while",
    );
  });
});

describe("holiday calendar (C-30)", () => {
  it("works out the moving holidays", () => {
    const dates = Object.fromEntries(
      usHolidays(2026).map((holiday) => [holiday.key, holiday.date]),
    );
    expect(dates).toMatchObject({
      mothers_day: "2026-05-10",
      memorial_day: "2026-05-25",
      fathers_day: "2026-06-21",
      labor_day: "2026-09-07",
      thanksgiving: "2026-11-26",
    });
  });

  it("only suggests what matters to the trade", () => {
    const thanksgiving = usHolidays(2026).find((holiday) => holiday.key === "thanksgiving")!;
    const valentines = usHolidays(2026).find((holiday) => holiday.key === "valentines")!;
    expect(holidayCopy(thanksgiving, ctx, "Thursday, November 26")?.subject).toBe(
      "Book before Thanksgiving",
    );
    expect(holidayCopy(valentines, ctx, "Saturday, February 14")).toBeNull();
    expect(weatherCopy("freeze", ctx, "Tue, Nov 3", 27)?.body).toContain(
      "a low of 27°F on Tue, Nov 3",
    );
    expect(weatherCopy("freeze", { ...ctx, trade: "salon" }, "Tue, Nov 3", 27)).toBeNull();
  });
});

describe("campaign email", () => {
  const email = {
    business: { name: "Demo Plumbing & Heating", phone: "+15125550177" },
    subject: "Protect your pipes",
    body: "Hi Maria,\n\n<b>Pipes</b> burst & cost a lot.",
    offer: "$20 off a pipe check",
    offerEnds: "Sunday, November 30",
    button: { label: "Book a time", url: "https://example.com/o/abc?x=1&y=2" },
  };

  it("escapes what the owner wrote and leaves room for the footer", () => {
    const html = campaignHtml(email);
    expect(html).toContain("&lt;b&gt;Pipes&lt;/b&gt; burst &amp; cost a lot.");
    expect(html).toContain('href="https://example.com/o/abc?x=1&amp;y=2"');
    expect(html).toContain("<!--footer-->");
    expect(html).not.toContain("<b>Pipes</b>");
  });

  it("has the offer, the button and the phone in plain text too", () => {
    const text = campaignText(email);
    expect(text).toContain("Your offer: $20 off a pipe check (until Sunday, November 30)");
    expect(text).toContain("Book a time: https://example.com/o/abc?x=1&y=2");
    expect(text).toContain("Or call (512) 555-0177");
  });
});

describe("offer ideas from the forecast and the calendar (C-30)", () => {
  const tenant = {
    id: "t1",
    name: "Demo Plumbing & Heating",
    ownerName: "Dana Reyes",
    trade: "plumbing",
    city: "Austin",
    state: "TX",
    postalCode: "78704",
  } as Parameters<typeof ideasFor>[0];

  it("suggests pipe protection before a freeze, and an offer before Thanksgiving", async () => {
    forecast.mockResolvedValueOnce([
      { date: "2026-11-09", lowF: 48, highF: 66 },
      { date: "2026-11-10", lowF: 44, highF: 60 },
      { date: "2026-11-11", lowF: 27, highF: 41 },
      { date: "2026-11-12", lowF: 30, highF: 45 },
    ]);
    const ideas = await ideasFor(tenant, "2026-11-08");
    expect(ideas.map((idea) => idea.key)).toEqual([
      "freeze:2026-11-11",
      "holiday:thanksgiving:2026",
    ]);
    expect(ideas[0]!.trigger).toMatchObject({
      kind: "freeze",
      title: "Freeze forecast for Wed, Nov 11",
      detail: "A low of 27°F in Austin, TX.",
    });
    expect(ideas[0]!.copy.subject).toBe("Protect your pipes before the freeze");
  });

  it("stays quiet in a mild week with no holiday near", async () => {
    forecast.mockResolvedValueOnce([{ date: "2026-08-02", lowF: 74, highF: 96 }]);
    expect(await ideasFor(tenant, "2026-08-01")).toEqual([]);
  });
});
