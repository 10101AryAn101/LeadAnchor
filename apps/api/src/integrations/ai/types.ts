import type { ChatChannel, ReplyTone, Trade, Urgency } from "@leadanchor/contracts";

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

/** C-16: one turn of a chat with a customer. Facts come only from the business's own settings. */
export interface ChatTurnInput {
  business: {
    name: string;
    trade: Trade;
    area: string | null;
    /** To call for emergencies and anything urgent. */
    phone: string | null;
    hours: string[];
    services: Array<{ ref: string; name: string; description: string | null; fromPrice: string | null; length: string | null }>;
    /** The owner's own statements, e.g. "Licensed and insured", "12 years in business". */
    claims: string[];
    canBookOnline: boolean;
    /** What the owner wants the assistant to know. */
    notes: string | null;
  };
  channel: ChatChannel;
  customer: { name: string | null; hasPhone: boolean; openJob: string | null };
  /** Oldest first; the last one is the customer's newest message. */
  history: Array<{ from: "customer" | "business"; text: string }>;
  timeoutMs: number;
}

export interface ChatTurn {
  reply: string;
  /** answer / ask: keep chatting; book: send the booking (or request) link; handoff: pass to the owner. */
  action: "answer" | "ask" | "book" | "handoff";
  /** The price-list entry their job matches. */
  serviceRef: string | null;
  urgency: Urgency;
  /** One line for the job card: what they need. */
  need: string | null;
  customerName: string | null;
  /** A phone number the customer typed (website chat). */
  phone: string | null;
  handoffReason: string | null;
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
  /** C-16: the assistant's next message in a chat, and what to do with the conversation. */
  chatTurn(input: ChatTurnInput): Promise<ChatTurn>;
}
