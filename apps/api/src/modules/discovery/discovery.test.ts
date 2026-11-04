import { describe, expect, it } from "vitest";
import { type AiProfileFacts, aiProfileOf, answerFor, faqFor, hoursOf } from "./ai-profile";
import { PANEL_SIZE, mentions, panelQuestions } from "./panel";

const facts = (overrides: Partial<AiProfileFacts> = {}): AiProfileFacts => ({
  name: "Rivera Plumbing",
  trade: "plumbing",
  city: "Austin",
  state: "TX",
  postalCode: "78701",
  phone: "+15125550142",
  pageUrl: "https://app.example.com/p/rivera",
  bookingUrl: "https://app.example.com/b/rivera",
  licenseNumber: "M-40231",
  insuranceCarrier: "Hiscox",
  yearsInBusiness: 12,
  googleProfileUrl: null,
  website: null,
  rating: { average: 4.8, count: 37 },
  services: [
    { name: "Water heater repair", jobs: 14 },
    { name: "Drain cleaning", jobs: 9 },
  ],
  asks: [{ reason: "Leak repair", count: 21 }],
  zips: ["78701", "78702", "78704"],
  hours: { mon: { open: true, start: "08:00", end: "17:00" }, sat: { open: false, start: "09:00", end: "13:00" } },
  photoUrls: [],
  updatedAt: new Date("2026-11-01T12:00:00Z"),
  ...overrides,
});
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

describe("the AI-readable page (C-42)", () => {
  it("answers in 40 to 60 words, with or without the optional facts", () => {
    for (const each of [
      facts(),
      facts({ rating: null, yearsInBusiness: null, zips: [], licenseNumber: null, insuranceCarrier: null, bookingUrl: null }),
    ]) {
      const text = answerFor(each, each.services[0]!);
      expect(words(text)).toBeGreaterThanOrEqual(40);
      expect(words(text)).toBeLessThanOrEqual(60);
    }
  });

  it("only says what the records show: job counts, the owner's own licence claim, the real rating", () => {
    const text = answerFor(facts(), { name: "Water heater repair", jobs: 14 });
    expect(text).toContain("did 14 water heater repair jobs in the last year");
    expect(text).toContain("The owner states they're licensed (TX #M-40231) and insured with Hiscox.");
    expect(text).toContain("Rated 4.8 out of 5 from 37 Google reviews.");
    expect(answerFor(facts({ rating: null }), { name: "Drain cleaning", jobs: 9 })).not.toContain("Rated");
    expect(answerFor(facts(), { name: "Drain cleaning", jobs: 0 })).not.toMatch(/did \d/);
  });

  it("builds the FAQ from what people really asked, and never shows a street", () => {
    const faq = faqFor(facts(), hoursOf(facts()));
    expect(faq[0]).toEqual({
      question: "Do you handle leak repair in Austin, TX?",
      answer: "Yes. Rivera Plumbing handled 21 leak repair requests in the last year, including in ZIP 78701, 78702 and 78704.",
    });
    expect(faq.map((item) => item.question)).toContain("What are your hours?");
    const page = JSON.stringify(aiProfileOf(facts()));
    expect(page).not.toMatch(/streetAddress|Oak St/);
  });

  it("publishes LocalBusiness (as Plumber) with services, area, hours, rating and the FAQ", () => {
    const { jsonLd } = aiProfileOf(facts());
    const graph = jsonLd["@graph"] as Array<Record<string, unknown>>;
    expect(jsonLd["@context"]).toBe("https://schema.org");
    expect(graph[0]).toMatchObject({
      "@type": "Plumber",
      name: "Rivera Plumbing",
      telephone: "+15125550142",
      aggregateRating: { "@type": "AggregateRating", ratingValue: 4.8, reviewCount: 37 },
    });
    expect((graph[0]!.openingHoursSpecification as unknown[]).length).toBe(1);
    expect((graph[0]!.areaServed as unknown[]).length).toBe(3);
    expect(graph[1]).toMatchObject({ "@type": "FAQPage" });
    expect(aiProfileOf(facts({ rating: null })).jsonLd["@graph"]).not.toContainEqual(expect.objectContaining({ aggregateRating: expect.anything() }));
  });
});

describe("the monthly check (C-42)", () => {
  it("asks ten local questions", () => {
    const questions = panelQuestions({ trade: "plumbing", city: "Austin", state: "TX", zip: "78701", services: ["Drain cleaning"] });
    expect(questions).toHaveLength(PANEL_SIZE);
    expect(questions[0]).toBe("Who is the best plumber in Austin, TX?");
    expect(questions).toContain("Who can do drain cleaning in Austin, TX?");
  });

  it("recognises the business however the answer writes its name", () => {
    expect(mentions("Rivera Plumbing & Heating, LLC", ["Rivera Plumbing and Heating"], "")).toBe(true);
    expect(mentions("Rivera Plumbing", [], "I'd call Rivera Plumbing first.")).toBe(true);
    expect(mentions("Rivera Plumbing", ["Radiant Plumbing & Air Conditioning"], "Try Radiant.")).toBe(false);
  });
});
