import {
  MAX_QUOTE_LINES,
  QUOTE_DRAFT_AI_BUDGET_MS,
  type QuoteDraftSource,
  type QuoteLineOrigin,
  type Trade,
} from "@leadanchor/contracts";
import { ai } from "../../container";
import type { QuoteDraft } from "../../integrations/ai/types";

export interface PriceListEntry {
  id: string;
  name: string;
  description: string | null;
  priceCents: number | null;
}

export interface DraftLine {
  serviceId: string | null;
  description: string;
  quantity: number;
  unitPriceCents: number | null;
  flagged: boolean;
  flagReason: string | null;
  origin: QuoteLineOrigin;
}

export interface DraftResult {
  title: string;
  notes: string | null;
  lines: DraftLine[];
  source: QuoteDraftSource;
  model: string | null;
  ms: number;
  photos: number;
  /** Why the AI didn't write it, in plain words. */
  note: string | null;
}

export interface DraftContext {
  businessName: string;
  trade: Trade;
  job: {
    title: string;
    summary: string | null;
    serviceCategory: string | null;
    customerNote: string | null;
  };
  photos: Array<{ image: Buffer; mimeType: string; findings: string | null }>;
  /** Active services only. */
  priceList: PriceListEntry[];
}

/**
 * C-45: the first draft of a quote. The AI reads the photos and the request and picks lines
 * from the owner's price list; every price is then copied from that list, never from the AI.
 * When the AI can't help in time, the draft comes from the price list alone, so a draft is
 * always ready within 15 seconds.
 */
export async function draftQuote(context: DraftContext): Promise<DraftResult> {
  const started = Date.now();
  const refs = context.priceList.map((entry, index) => ({ ...entry, ref: `s${index + 1}` }));
  let reason: string;

  if (ai.configured) {
    try {
      const draft = await ai.draftQuote({
        businessName: context.businessName,
        trade: context.trade,
        job: context.job,
        photos: context.photos,
        priceList: refs.map((entry) => ({
          ref: entry.ref,
          name: entry.name,
          description: entry.description,
        })),
        timeoutMs: QUOTE_DRAFT_AI_BUDGET_MS,
      });
      return {
        title: draft.title.trim() || context.job.title,
        notes: draft.notes?.trim() || null,
        lines: priceAiDraft(draft, refs),
        source: "ai",
        model: ai.model,
        ms: Date.now() - started,
        photos: context.photos.length,
        note: null,
      };
    } catch (error) {
      reason = aiFailureReason(error);
    }
  } else {
    reason = "AI drafting is off";
  }

  const lines = priceListDraft(context.job, context.priceList);
  return {
    // A missed call's card title says what happened, not what the work is.
    title: context.job.serviceCategory ?? lines[0]?.description ?? context.job.title,
    notes: null,
    lines,
    source: lines.length > 0 ? "price_list" : "blank",
    model: null,
    ms: Date.now() - started,
    photos: 0,
    note:
      lines.length > 0
        ? `${reason}, so this draft comes from your price list.`
        : `${reason}, and nothing on your price list matched the request. Add the lines yourself.`,
  };
}

/** Turns the AI's picks into lines. The price always comes from the owner's own list (C-45 AC2). */
export function priceAiDraft(
  draft: QuoteDraft,
  priceList: Array<PriceListEntry & { ref: string }>,
): DraftLine[] {
  const byRef = new Map(priceList.map((entry) => [entry.ref, entry]));
  return draft.lines.slice(0, MAX_QUOTE_LINES).map((line) => {
    const entry = line.ref ? byRef.get(line.ref) : undefined;
    const reasons: string[] = [];
    // AC3: anything the AI isn't sure about is marked for the owner instead of guessed.
    if (!line.sure) reasons.push(line.note?.trim() || "The AI wasn't sure this is needed.");
    if (!entry) reasons.push("Not on your price list: add a price.");
    else if (entry.priceCents == null)
      reasons.push(`“${entry.name}” has no price on your list yet.`);
    return {
      serviceId: entry?.id ?? null,
      description: (line.description.trim() || entry?.name || "Work").slice(0, 200),
      quantity: line.quantity,
      unitPriceCents: entry?.priceCents ?? null,
      flagged: reasons.length > 0,
      flagReason: reasons.length > 0 ? reasons.join(" ") : null,
      origin: "ai",
    };
  });
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "my",
  "our",
  "a",
  "an",
  "of",
  "in",
  "on",
  "is",
  "it",
  "to",
  "or",
  "new",
  "service",
  "repair",
  "need",
  "needs",
  "under",
  "this",
  "that",
  "have",
  "has",
  "was",
  "are",
  "but",
  "not",
  "from",
  "please",
]);
/** "leaking" and "leaks" both count as "leak". */
const stem = (word: string) => (word.length > 4 ? word.replace(/(ing|ed|es|s)$/, "") : word);
const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !STOP_WORDS.has(word))
      .map(stem),
  );

/**
 * The draft without AI: the service the customer picked on the form, or the price-list entry
 * that shares the most words with the request (marked for checking), or nothing.
 */
export function priceListDraft(
  job: {
    title: string;
    serviceCategory: string | null;
    summary?: string | null;
    customerNote?: string | null;
  },
  priceList: PriceListEntry[],
): DraftLine[] {
  const picked = job.serviceCategory?.trim().toLowerCase();
  const exact = picked
    ? priceList.find((entry) => entry.name.trim().toLowerCase() === picked)
    : undefined;
  if (exact) return [fromList(exact, null)];

  const asked = words(
    [job.title, job.serviceCategory, job.summary, job.customerNote].filter(Boolean).join(" "),
  );
  let best: { entry: PriceListEntry; score: number } | null = null;
  for (const entry of priceList) {
    const offered = words(`${entry.name} ${entry.description ?? ""}`);
    const score = [...asked].filter((word) => offered.has(word)).length;
    if (score > 0 && (!best || score > best.score)) best = { entry, score };
  }
  return best
    ? [
        fromList(
          best.entry,
          "Picked from your price list by matching words in the request: check it fits.",
        ),
      ]
    : [];
}

function fromList(entry: PriceListEntry, check: string | null): DraftLine {
  const reasons = [
    check,
    entry.priceCents == null ? `“${entry.name}” has no price on your list yet.` : null,
  ].filter(Boolean);
  return {
    serviceId: entry.id,
    description: entry.name,
    quantity: 1,
    unitPriceCents: entry.priceCents,
    flagged: reasons.length > 0,
    flagReason: reasons.length > 0 ? reasons.join(" ") : null,
    origin: "price_list",
  };
}

function aiFailureReason(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/429|quota|exhausted/i.test(message)) return "The AI's daily limit was reached";
  if (/503|high demand|overloaded|unavailable/i.test(message))
    return "The AI was too busy just now";
  if (/abort|timeout|timed out/i.test(message)) return "The AI took too long";
  return "The AI couldn't draft this one";
}
