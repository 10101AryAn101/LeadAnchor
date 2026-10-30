import type { ReplyTone, Trade, Urgency } from "@leadanchor/contracts";

/** What the AI pulls out of a voicemail, an AI Dispatcher answer or a web form (C-13, C-39). */
export interface CallerNeed {
  /** Short card title, e.g. "Water heater leaking in garage". */
  title: string;
  /** One or two plain sentences for the owner. */
  summary: string;
  serviceCategory: string | null;
  urgency: Urgency;
  callerName: string | null;
  address: string | null;
  preferredTime: string | null;
}

/** What the AI sees in a customer photo (C-09). */
export interface PhotoTriage {
  summary: string;
  issue: string;
  itemType: string | null;
  brand: string | null;
  model: string | null;
  urgency: Urgency;
  visibleRisks: string[];
  confidence: number;
}

export interface CallerNeedInput {
  transcript: string;
  source: "voicemail" | "ai_dispatcher" | "web_form";
  businessName: string;
  trade: Trade;
  services: string[];
}

export interface PhotoTriageInput {
  image: Buffer;
  mimeType: string;
  trade: Trade;
  customerNote?: string;
}

export interface QuoteDraftInput {
  businessName: string;
  trade: Trade;
  job: { title: string; summary: string | null; serviceCategory: string | null; customerNote: string | null };
  /** Small copies of the customer's photos, with what the photo reading (C-09) already found. */
  photos: Array<{ image: Buffer; mimeType: string; findings: string | null }>;
  /** The owner's price list. Prices are left out on purpose: the AI picks lines, it never sets a price (C-45). */
  priceList: Array<{ ref: string; name: string; description: string | null }>;
  /** Hard limit for this call; the quote falls back to the price list after it. */
  timeoutMs: number;
}

export interface QuoteDraftLine {
  /** The price-list entry this line uses, or null for work that isn't on the list (the owner prices it). */
  ref: string | null;
  description: string;
  quantity: number;
  /** False when the photos and description don't clearly show the line is needed. */
  sure: boolean;
  /** Why the AI isn't sure, or what the owner should check. */
  note: string | null;
}

export interface QuoteDraft {
  title: string;
  lines: QuoteDraftLine[];
  /** A short note to the customer about what the quote assumes. */
  notes: string | null;
}

export interface ReviewReplyInput {
  businessName: string;
  /** Signs the reply, e.g. "Dana"; the business name alone when null. */
  ownerFirstName: string | null;
  tone: ReplyTone;
  review: { reviewerFirstName: string | null; rating: number; text: string | null };
  /** From the CRM job record: the only job details a reply may mention (C-47 AC 4). */
  job: { service: string; month: string } | null;
  /** For low ratings: the number the customer can call to talk it through. */
  contactPhone: string | null;
  timeoutMs: number;
}

export interface ListingPostInput {
  businessName: string;
  trade: Trade;
  area: string | null;
  services: string[];
  /** Real recent work, e.g. "Water heater replacement": no customer details. */
  recentWork: string[];
  callToAction: "book" | "call";
  timeoutMs: number;
}

/**
 * AI provider port. Business code depends on this interface only, so the model
 * vendor can change without touching it (spec: "provider abstraction is a requirement").
 */
export interface AiProvider {
  readonly vendor: string;
  readonly model: string;
  readonly configured: boolean;
  extractCallerNeed(input: CallerNeedInput): Promise<CallerNeed>;
  triagePhoto(input: PhotoTriageInput): Promise<PhotoTriage>;
  /** C-45: a first draft of a quote, built only from the owner's price list. */
  draftQuote(input: QuoteDraftInput): Promise<QuoteDraft>;
  /** C-47: a first draft of the reply to a Google review; nothing posts until the owner approves. */
  draftReviewReply(input: ReviewReplyInput): Promise<{ reply: string }>;
  /** Module 9: an update for the Google listing, built from the business's real recent work. */
  draftListingPost(input: ListingPostInput): Promise<{ text: string }>;
}
