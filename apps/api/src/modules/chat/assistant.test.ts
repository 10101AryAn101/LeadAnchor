import { describe, expect, it, vi } from "vitest";

// Only the pure helpers are under test; the service's database and container aren't needed.
vi.mock("../../container", () => ({ ai: { configured: false }, consentLedger: {}, channels: {} }));
vi.mock("../../db/client", () => ({ systemDb: {}, withTenant: vi.fn() }));
vi.mock("../../db/unit-of-work", () => ({ tenantWork: vi.fn() }));
vi.mock("../../jobs/queue", () => ({ QUEUES: {}, enqueue: vi.fn() }));

const { pricesAllowed, withoutGreeting } = await import("./assistant");

const service = (priceCents: number | null) =>
  ({ priceCents }) as Parameters<typeof pricesAllowed>[1][number];

describe("assistant price guard (C-16, prices come from the owner)", () => {
  it("lets through replies with no prices, or only listed ones", () => {
    expect(pricesAllowed("We can help with that. What's going on?", [service(18500)], null)).toBe(
      true,
    );
    expect(pricesAllowed("Drain cleaning starts from $150.", [service(15000)], null)).toBe(true);
    expect(pricesAllowed("Leak repair is from $185.50.", [service(18550)], null)).toBe(true);
  });

  it("stops a price that isn't on the list or in the owner's notes", () => {
    expect(pricesAllowed("That would be about $99.", [service(15000)], null)).toBe(false);
    expect(
      pricesAllowed("The trip charge is $49.", [service(15000)], "We charge a $49 trip fee."),
    ).toBe(true);
    expect(pricesAllowed("It's usually $1,200.", [service(120000)], null)).toBe(true);
  });
});

describe("job titles from a first chat message", () => {
  const business = "Demo Plumbing & Heating";

  it("drops the greeting, including the business's name", () => {
    expect(withoutGreeting("Hi Demo Plumbing & Heating, my sink is slow", business)).toBe(
      "My sink is slow",
    );
    expect(withoutGreeting("Hello! Need a quote for a water heater", business)).toBe(
      "Need a quote for a water heater",
    );
    expect(withoutGreeting("hi there my toilet keeps running", business)).toBe(
      "My toilet keeps running",
    );
  });

  it("leaves other messages alone", () => {
    expect(withoutGreeting("High water bill this month", business)).toBe(
      "High water bill this month",
    );
    expect(withoutGreeting("Hi!", business)).toBe("Hi!");
    expect(withoutGreeting("Leak under the sink", business)).toBe("Leak under the sink");
  });
});
