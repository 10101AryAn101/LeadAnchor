import type { Trade, Urgency } from "@leadanchor/contracts";

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
}
