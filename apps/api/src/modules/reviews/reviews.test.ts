import {
  REVIEW_REQUEST_COPY,
  replyLint,
  reviewCopyLint,
  reviewRequestMessage,
} from "@leadanchor/contracts";
import { describe, expect, it, vi } from "vitest";

// The service's database and container imports aren't needed for these pure checks.
vi.mock("../../container", () => ({ ai: { configured: false }, listingProviders: {} }));
vi.mock("../../db/client", () => ({ systemDb: {}, withTenant: vi.fn() }));
vi.mock("../../db/unit-of-work", () => ({ tenantWork: vi.fn() }));
vi.mock("../../jobs/queue", () => ({ QUEUES: {}, enqueue: vi.fn() }));

const { namesMatch, templateReply } = await import("./reviews.service");

describe("review request wording (C-46)", () => {
  it("the approved copy passes the compliance lint", () => {
    expect(reviewCopyLint(REVIEW_REQUEST_COPY)).toEqual([]);
  });

  it("flags incentives, gating and anything that steers people away from a public review", () => {
    expect(reviewCopyLint("Leave us a review and get 10% off your next visit")).not.toEqual([]);
    expect(reviewCopyLint("Enter to win a $50 gift card when you review us")).not.toEqual([]);
    expect(reviewCopyLint("If you're happy with the job, please leave us a review")).not.toEqual(
      [],
    );
    expect(reviewCopyLint("Please rate us 5 stars on Google")).not.toEqual([]);
    expect(reviewCopyLint("Had a problem? Text us instead of leaving a review")).not.toEqual([]);
  });

  it("every request carries both links, the Google one first, whatever the job", () => {
    const { subject, body } = reviewRequestMessage({
      firstName: "Maria",
      business: "Demo Plumbing",
      googleLink: "https://g.page/r/review",
      privateLink: "https://example.test/f/token",
    });
    expect(subject).toBe("Thanks for choosing Demo Plumbing");
    expect(body.indexOf("https://g.page/r/review")).toBeGreaterThan(0);
    expect(body.indexOf("https://example.test/f/token")).toBeGreaterThan(
      body.indexOf("https://g.page/r/review"),
    );
    expect(body).toMatch(/^Hi Maria, thanks for choosing Demo Plumbing!/);
    expect(reviewCopyLint(body)).toEqual([]);
  });

  it("greets people with no name on file", () => {
    const { body } = reviewRequestMessage({
      firstName: null,
      business: "Demo",
      googleLink: "https://g",
      privateLink: "https://p",
    });
    expect(body).toMatch(/^Hi there,/);
  });
});

describe("review replies (C-47)", () => {
  it("never let a reply offer anything in return", () => {
    expect(replyLint("Thanks Maria! Here's 15% off your next service.")).not.toEqual([]);
    expect(replyLint("We'd love to send you a free tune-up.")).not.toEqual([]);
    expect(replyLint("Thanks! Feel free to call us any time.")).toEqual([]);
  });

  it("template replies are clean, mention the job, and de-escalate low ratings", () => {
    const base = {
      firstName: "Maria",
      business: "Demo Plumbing",
      owner: "Dana",
      service: "Water heater replacement",
      phone: "(512) 555-0177",
    };
    for (const tone of ["warm", "professional", "brief"] as const) {
      for (const rating of [1, 2, 3, 4, 5]) {
        const reply = templateReply({ ...base, tone, rating });
        expect(replyLint(reply)).toEqual([]);
        expect(reply).toContain("Dana, Demo Plumbing");
      }
    }
    expect(templateReply({ ...base, tone: "warm", rating: 5 })).toContain(
      "water heater replacement",
    );
    expect(templateReply({ ...base, tone: "warm", rating: 2 })).toContain(
      "call us at (512) 555-0177",
    );
    expect(templateReply({ ...base, tone: "professional", rating: 5 })).not.toContain("!");
  });

  it("matches reviewers to customers only on a clear name match", () => {
    expect(namesMatch("Maria Lopez", "Maria Lopez")).toBe(true);
    expect(namesMatch("maria lopez", "Maria  Lopez")).toBe(true);
    expect(namesMatch("Maria L.", "Maria Lopez")).toBe(true);
    expect(namesMatch("Maria", "Maria Lopez")).toBe(false);
    expect(namesMatch("Maria R.", "Maria Lopez")).toBe(false);
    expect(namesMatch("Mario Lopez", "Maria Lopez")).toBe(false);
  });
});
