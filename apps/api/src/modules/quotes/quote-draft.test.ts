import { describe, expect, it } from "vitest";
import { balanceOf, canMove, cardLabel, quoteTotal, receiptNumber } from "../payments/money";
import { type PriceListEntry, priceAiDraft, priceListDraft } from "./quote-draft";
import { lineChanges } from "./quote.service";

const priceList: Array<PriceListEntry & { ref: string }> = [
  {
    ref: "s1",
    id: "svc-drain",
    name: "Drain cleaning",
    description: "Kitchen or bathroom drain",
    priceCents: 15_000,
  },
  {
    ref: "s2",
    id: "svc-heater",
    name: "Water heater repair",
    description: null,
    priceCents: 22_500,
  },
  {
    ref: "s3",
    id: "svc-fixture",
    name: "Fixture installation",
    description: null,
    priceCents: null,
  },
];

describe("AI quote drafts (C-45)", () => {
  it("takes every price from the owner's list, never from the AI", () => {
    const lines = priceAiDraft(
      {
        title: "Clear kitchen drain",
        notes: null,
        lines: [
          {
            ref: "s1",
            description: "Clear the kitchen sink drain",
            quantity: 1,
            sure: true,
            note: null,
          },
        ],
      },
      priceList,
    );
    expect(lines).toEqual([
      {
        serviceId: "svc-drain",
        description: "Clear the kitchen sink drain",
        quantity: 1,
        unitPriceCents: 15_000,
        flagged: false,
        flagReason: null,
        origin: "ai",
      },
    ]);
  });

  it("flags what the AI isn't sure about, and anything off the price list or unpriced", () => {
    const lines = priceAiDraft(
      {
        title: "Water heater",
        notes: null,
        lines: [
          {
            ref: "s2",
            description: "Replace the drain valve",
            quantity: 1,
            sure: false,
            note: "The photo doesn't show the valve clearly.",
          },
          {
            ref: null,
            description: "New drain valve (part)",
            quantity: 1,
            sure: true,
            note: "Part cost",
          },
          { ref: "s3", description: "Install a new faucet", quantity: 2, sure: true, note: null },
          { ref: "s9", description: "Made-up ref", quantity: 1, sure: true, note: null },
        ],
      },
      priceList,
    );
    expect(lines.map((line) => [line.unitPriceCents, line.flagged])).toEqual([
      [22_500, true],
      [null, true],
      [null, true],
      [null, true],
    ]);
    expect(lines[0]!.flagReason).toBe("The photo doesn't show the valve clearly.");
    expect(lines[1]!.flagReason).toBe("Not on your price list: add a price.");
    expect(lines[2]!.flagReason).toContain("has no price on your list yet");
    expect(lines[3]!.serviceId).toBeNull();
  });

  it("without AI, uses the service the customer picked, or the closest match marked for checking", () => {
    expect(
      priceListDraft({ title: "Sink backed up", serviceCategory: "drain cleaning" }, priceList)[0],
    ).toMatchObject({
      serviceId: "svc-drain",
      unitPriceCents: 15_000,
      flagged: false,
      origin: "price_list",
    });
    const guessed = priceListDraft(
      { title: "My water heater is leaking", serviceCategory: null },
      priceList,
    );
    expect(guessed[0]).toMatchObject({ serviceId: "svc-heater", flagged: true });
    expect(priceListDraft({ title: "Fence painting", serviceCategory: null }, priceList)).toEqual(
      [],
    );
  });
});

describe("quote edit history (C-45)", () => {
  it("describes each change in the owner's words", () => {
    const before = [
      {
        id: "a",
        description: "Drain cleaning",
        quantity: 1,
        unitPriceCents: 15_000,
        flagged: false,
      },
      { id: "b", description: "New valve", quantity: 1, unitPriceCents: null, flagged: true },
      { id: "c", description: "Haul away", quantity: 1, unitPriceCents: 5_000, flagged: false },
    ];
    const after = [
      {
        id: "a",
        description: "Drain cleaning",
        quantity: 2,
        unitPriceCents: 17_500,
        flagged: false,
      },
      {
        id: "b",
        description: "New drain valve",
        quantity: 1,
        unitPriceCents: 4_200,
        flagged: false,
      },
      { description: "Camera inspection", quantity: 1, unitPriceCents: 9_900, flagged: false },
    ];
    expect(lineChanges(before, after)).toEqual([
      "Removed “Haul away”",
      "“Drain cleaning”: quantity from 1 to 2",
      "“Drain cleaning”: price from $150 to $175",
      "Renamed “New valve” to “New drain valve”",
      "“New drain valve”: priced at $42",
      "Checked “New drain valve”",
      "Added “Camera inspection” at $99",
    ]);
  });
});

describe("money", () => {
  it("adds up priced lines only", () => {
    expect(
      quoteTotal([
        { quantity: 2, unitPriceCents: 15_000 },
        { quantity: 1, unitPriceCents: null },
      ]),
    ).toBe(30_000);
  });

  it("counts holds as covered, so the customer isn't asked twice", () => {
    const payments = [
      { status: "held" as const, amountCents: 5_000 },
      { status: "paid" as const, amountCents: 10_000 },
      { status: "released" as const, amountCents: 5_000 },
    ];
    expect(balanceOf(32_500, payments)).toEqual({
      jobValueCents: 32_500,
      paidCents: 10_000,
      heldCents: 5_000,
      dueCents: 17_500,
    });
    expect(balanceOf(null, payments).dueCents).toBeNull();
    expect(balanceOf(8_000, payments).dueCents).toBe(0);
  });

  it("only moves a payment forward", () => {
    expect(canMove("open", "held")).toBe(true);
    expect(canMove("held", "paid")).toBe(true);
    expect(canMove("held", "released")).toBe(true);
    expect(canMove("paid", "released")).toBe(false);
    expect(canMove("paid", "paid")).toBe(false);
    expect(canMove("released", "held")).toBe(false);
    // Money that lands after the owner closed the link still counts.
    expect(canMove("canceled", "paid")).toBe(true);
  });

  it("labels cards and receipts without card numbers", () => {
    expect(cardLabel("visa", "4242")).toBe("Visa •••• 4242");
    expect(cardLabel(null, null)).toBeNull();
    expect(receiptNumber("01937a2b-7c1d-7e3f-8a9b-0c1d2e3f4a5b")).toBe("R-2E3F4A5B");
  });
});

describe("price-list drafts without AI", () => {
  it("reads the customer's own words when the card title is a missed call's", () => {
    const lines = priceListDraft(
      {
        title: "Hung up before leaving a message",
        serviceCategory: null,
        customerNote: "Kitchen sink is leaking under the cabinet",
      },
      [
        { id: "svc-leak", name: "Leak repair", description: null, priceCents: 18_500 },
        { id: "svc-sewer", name: "Sewer line", description: null, priceCents: 45_000 },
      ],
    );
    expect(lines[0]).toMatchObject({
      serviceId: "svc-leak",
      unitPriceCents: 18_500,
      flagged: true,
    });
  });
});
