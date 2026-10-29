import {
  QUOTE_VALID_DAYS,
  type PublicQuote,
  type PublicQuoteState,
  type QuoteAcceptResult,
  type QuoteDetail,
  type QuoteSendResult,
  type QuoteSummary,
  type QuoteUpdateInput,
  TRADE_LABELS,
  formatPhone,
} from "@leadanchor/contracts";
import { and, asc, desc, eq, inArray, max } from "drizzle-orm";
import { linkBaseUrl } from "../../config/env";
import { pdf, storage } from "../../container";
import { type Tx, systemDb, withTenant } from "../../db/client";
import {
  customers,
  leadEvents,
  leads,
  mediaAssets,
  paymentAccounts,
  paymentRequests,
  phoneNumbers,
  quoteLines,
  quotes,
  services,
  tenants,
} from "../../db/schema";
import { type Effects, tenantWork } from "../../db/unit-of-work";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "../../lib/crypto";
import { HttpError, notFound } from "../../lib/errors";
import { addDays, iso } from "../../lib/time";
import { addLeadEvent } from "../leads/lead-capture";
import { advanceLead } from "../leads/pipeline";
import { toMessageItem } from "../messaging/message-item";
import { requestEmail, requestMessage } from "../messaging/send-path";
import { notifyOwner } from "../notifications/notify";
import {
  cardsReady,
  insertPaymentRequest,
  payUrl,
  publicBusinessOf,
  startCheckout,
} from "../payments/payment.service";
import { dollars, lineTotal, quoteNumber, quoteTotal, toCents } from "../payments/money";
import { profileUrl } from "../profile/profile";
import { type DraftResult, draftQuote } from "./quote-draft";
import { quoteHtml } from "./quote-document";

type QuoteRow = typeof quotes.$inferSelect;
type LineRow = typeof quoteLines.$inferSelect;
type Customer = typeof customers.$inferSelect;
type Tenant = typeof tenants.$inferSelect;

/** The customer's quote page (C-45): read it, download the PDF, accept or decline. */
export const quoteUrl = (token: string) => `${linkBaseUrl}/q/${token}`;

function linkOf(row: Pick<QuoteRow, "tokenSealed" | "sentAt">) {
  if (!row.tokenSealed || !row.sentAt) return null;
  try {
    return quoteUrl(decryptSecret(row.tokenSealed));
  } catch {
    return null;
  }
}

const greeting = (customer: Customer) =>
  customer.name ? `Hi ${customer.name.trim().split(/\s+/)[0]}` : "Hi";
const customerName = (customer: Customer) =>
  customer.name ?? (customer.phoneE164 ? formatPhone(customer.phoneE164) : "Your customer");

function toSummary(row: QuoteRow, lines: Array<Pick<LineRow, "flagged">>): QuoteSummary {
  return {
    id: row.id,
    leadId: row.leadId,
    number: quoteNumber(row.number),
    status: row.status,
    revision: row.revision,
    title: row.title,
    totalCents: row.totalCents,
    depositCents: row.depositCents,
    lineCount: lines.length,
    flaggedCount: lines.filter((line) => line.flagged).length,
    url: linkOf(row),
    sentAt: iso(row.sentAt),
    viewedAt: iso(row.viewedAt),
    acceptedAt: iso(row.acceptedAt),
    declinedAt: iso(row.declinedAt),
    validUntil: iso(row.validUntil),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function linesOf(tx: Tx, quoteId: string) {
  return tx
    .select()
    .from(quoteLines)
    .where(eq(quoteLines.quoteId, quoteId))
    .orderBy(asc(quoteLines.position));
}

/** Quotes on these jobs, newest first, for the lead and customer pages. */
export async function quotesFor(tx: Tx, leadIds: string[]): Promise<QuoteSummary[]> {
  if (leadIds.length === 0) return [];
  const rows = await tx
    .select()
    .from(quotes)
    .where(inArray(quotes.leadId, leadIds))
    .orderBy(desc(quotes.createdAt));
  if (rows.length === 0) return [];
  const lines = await tx
    .select({ quoteId: quoteLines.quoteId, flagged: quoteLines.flagged })
    .from(quoteLines)
    .where(
      inArray(
        quoteLines.quoteId,
        rows.map((row) => row.id),
      ),
    );
  return rows.map((row) =>
    toSummary(
      row,
      lines.filter((line) => line.quoteId === row.id),
    ),
  );
}

async function detailOf(tx: Tx, row: QuoteRow): Promise<QuoteDetail> {
  const [lines, [customer], [account]] = await Promise.all([
    linesOf(tx, row.id),
    tx.select().from(customers).where(eq(customers.id, row.customerId)),
    tx.select().from(paymentAccounts).where(eq(paymentAccounts.tenantId, row.tenantId)),
  ]);
  return {
    ...toSummary(row, lines),
    notes: row.notes,
    depositCapture: row.depositCapture,
    declineReason: row.declineReason,
    lines: lines.map((line) => ({
      id: line.id,
      serviceId: line.serviceId,
      description: line.description,
      quantity: line.quantity,
      unitPriceCents: line.unitPriceCents,
      flagged: line.flagged,
      flagReason: line.flagReason,
      origin: line.origin,
    })),
    draft: {
      source: row.draftSource,
      model: row.draftModel,
      ms: row.draftMs,
      photos: row.draftPhotos,
      note: row.draftNote,
    },
    customer: {
      name: customer?.name ?? null,
      phone: customer?.phoneE164 ?? null,
      email: customer?.email ?? null,
    },
    cardPayments: cardsReady(account ?? null),
  };
}

export async function getQuote(tenantId: string, quoteId: string): Promise<QuoteDetail> {
  return withTenant(tenantId, async (tx) => {
    const [row] = await tx.select().from(quotes).where(eq(quotes.id, quoteId));
    if (!row) throw notFound("Quote");
    return detailOf(tx, row);
  });
}

/* ── Drafting (C-45) ─────────────────────────────────────────────────────── */

function findingsOf(tags: Record<string, unknown> | null) {
  if (!tags) return null;
  const text = (key: string) => (typeof tags[key] === "string" ? (tags[key] as string) : null);
  const item = [text("itemType"), text("brand"), text("model")].filter(Boolean).join(" ");
  return (
    [text("issue"), text("summary"), item ? `Item: ${item}` : null].filter(Boolean).join(". ") ||
    null
  );
}

/** What a draft is built from: the job, the customer's own words and photos, and the active price list. */
async function draftContext(tx: Tx, leadId: string) {
  const [row] = await tx
    .select({ lead: leads, customer: customers, tenant: tenants })
    .from(leads)
    .innerJoin(customers, eq(customers.id, leads.customerId))
    .innerJoin(tenants, eq(tenants.id, leads.tenantId))
    .where(eq(leads.id, leadId));
  if (!row) throw notFound("Lead");
  const [priceList, photos, [submitted]] = await Promise.all([
    tx
      .select({
        id: services.id,
        name: services.name,
        description: services.description,
        priceCents: services.priceCents,
      })
      .from(services)
      .where(eq(services.active, true))
      .orderBy(asc(services.sortOrder)),
    tx
      .select()
      .from(mediaAssets)
      .where(and(eq(mediaAssets.leadId, leadId), eq(mediaAssets.kind, "photo")))
      .orderBy(desc(mediaAssets.createdAt))
      .limit(2),
    tx
      .select({ data: leadEvents.data })
      .from(leadEvents)
      .where(and(eq(leadEvents.leadId, leadId), eq(leadEvents.type, "intake.submitted")))
      .orderBy(desc(leadEvents.createdAt))
      .limit(1),
  ]);
  const said = (key: string) =>
    typeof submitted?.data[key] === "string" ? (submitted.data[key] as string) : null;
  return { ...row, priceList, photos, picked: said("service"), customerNote: said("details") };
}

async function writeDraft(context: Awaited<ReturnType<typeof draftContext>>) {
  const photos = await Promise.all(
    context.photos.map(async (photo) => ({
      image: await storage.get(photo.thumbKey ?? photo.storageKey),
      mimeType: photo.thumbKey ? "image/webp" : photo.mimeType,
      findings: findingsOf(photo.aiTags ?? null),
    })),
  );
  return draftQuote({
    businessName: context.tenant.name,
    trade: context.tenant.trade,
    job: {
      title: context.lead.title,
      summary: context.lead.summary,
      // The service the customer picked on the request form counts when the call didn't say.
      serviceCategory: context.lead.serviceCategory ?? context.picked,
      customerNote: context.customerNote,
    },
    photos,
    priceList: context.priceList,
  });
}

function draftFields(draft: DraftResult) {
  return {
    title: draft.title.slice(0, 120),
    notes: draft.notes,
    totalCents: quoteTotal(draft.lines),
    draftSource: draft.source,
    draftModel: draft.model,
    draftMs: draft.ms,
    draftPhotos: draft.photos,
    draftNote: draft.note,
  };
}

function draftedEvent(quote: QuoteRow, draft: DraftResult, again: boolean) {
  return {
    quoteId: quote.id,
    number: quoteNumber(quote.number),
    source: draft.source,
    ms: draft.ms,
    lines: draft.lines.length,
    flagged: draft.lines.filter((line) => line.flagged).length,
    totalCents: quote.totalCents,
    ...(again && { again: true }),
  };
}

/**
 * "Draft quote": the AI reads the customer's photos and request and picks lines from the
 * owner's price list (C-45). Nothing is sent: the owner checks the draft first. An unsent draft
 * is reused, so a second tap opens it instead of starting another.
 */
export async function createQuote(
  tenantId: string,
  userId: string,
  leadId: string,
): Promise<{ quote: QuoteDetail; created: boolean }> {
  const context = await withTenant(tenantId, async (tx) => {
    const [existing] = await tx
      .select({ id: quotes.id })
      .from(quotes)
      .where(and(eq(quotes.leadId, leadId), eq(quotes.status, "draft")))
      .limit(1);
    return existing
      ? ({ existing: existing.id } as const)
      : ({ existing: null, ...(await draftContext(tx, leadId)) } as const);
  });
  if (context.existing !== null)
    return { quote: await getQuote(tenantId, context.existing), created: false };

  const draft = await writeDraft(context);
  const quoteId = await tenantWork(tenantId, async (tx, fx) => {
    const [last] = await tx.select({ number: max(quotes.number) }).from(quotes);
    const [quote] = await tx
      .insert(quotes)
      .values({
        tenantId,
        leadId,
        customerId: context.customer.id,
        number: (last?.number ?? 1000) + 1,
        ...draftFields(draft),
        createdBy: `user:${userId}`,
      })
      .returning();
    await insertDraftLines(tx, tenantId, quote!.id, draft);
    await addLeadEvent(tx, {
      tenantId,
      leadId,
      type: "quote.drafted",
      actor: `user:${userId}`,
      data: draftedEvent(quote!, draft, false),
    });
    fx.publish({ type: "lead.updated", leadId });
    return quote!.id;
  });
  return { quote: await getQuote(tenantId, quoteId), created: true };
}

/** "Try the AI again" on a draft that never went out (e.g. the AI was busy the first time). Replaces its lines. */
export async function redraftQuote(
  tenantId: string,
  userId: string,
  quoteId: string,
): Promise<QuoteDetail> {
  const context = await withTenant(tenantId, async (tx) => {
    const [quote] = await tx.select().from(quotes).where(eq(quotes.id, quoteId));
    if (!quote) throw notFound("Quote");
    if (quote.sentAt) throw sentAlready();
    return draftContext(tx, quote.leadId);
  });
  const draft = await writeDraft(context);
  await tenantWork(tenantId, async (tx, fx) => {
    const [quote] = await tx.select().from(quotes).where(eq(quotes.id, quoteId)).for("update");
    if (!quote) throw notFound("Quote");
    if (quote.sentAt || quote.status !== "draft") throw sentAlready();
    const [updated] = await tx
      .update(quotes)
      .set(draftFields(draft))
      .where(eq(quotes.id, quoteId))
      .returning();
    await tx.delete(quoteLines).where(eq(quoteLines.quoteId, quoteId));
    await insertDraftLines(tx, tenantId, quoteId, draft);
    await addLeadEvent(tx, {
      tenantId,
      leadId: quote.leadId,
      type: "quote.drafted",
      actor: `user:${userId}`,
      data: draftedEvent(updated!, draft, true),
    });
    fx.publish({ type: "quote.updated", quoteId, leadId: quote.leadId });
    fx.publish({ type: "lead.updated", leadId: quote.leadId });
  });
  return getQuote(tenantId, quoteId);
}

const sentAlready = () =>
  new HttpError(
    409,
    "quote_sent",
    "This quote has gone to the customer, so it can't be redrafted.",
  );

async function insertDraftLines(tx: Tx, tenantId: string, quoteId: string, draft: DraftResult) {
  if (draft.lines.length === 0) return;
  await tx
    .insert(quoteLines)
    .values(draft.lines.map((line, position) => ({ ...line, tenantId, quoteId, position })));
}

/* ── Editing: every change goes on the lead's timeline (C-45 AC6) ────────── */

interface LineState {
  id?: string;
  description: string;
  quantity: number;
  unitPriceCents: number | null;
  flagged: boolean;
}

/** The changes between two versions of the lines, in the owner's words. */
export function lineChanges(before: LineState[], after: LineState[]): string[] {
  const changes: string[] = [];
  const kept = new Set(after.map((line) => line.id).filter(Boolean));
  const price = (cents: number | null) => (cents == null ? "no price" : dollars(cents));
  for (const line of before)
    if (line.id && !kept.has(line.id)) changes.push(`Removed “${line.description}”`);
  const byId = new Map(before.map((line) => [line.id, line]));
  for (const line of after) {
    const old = line.id ? byId.get(line.id) : undefined;
    if (!old) {
      changes.push(
        `Added “${line.description}”${line.unitPriceCents != null ? ` at ${dollars(line.unitPriceCents)}` : ""}`,
      );
      continue;
    }
    if (old.description !== line.description)
      changes.push(`Renamed “${old.description}” to “${line.description}”`);
    if (old.quantity !== line.quantity)
      changes.push(`“${line.description}”: quantity from ${old.quantity} to ${line.quantity}`);
    if (old.unitPriceCents !== line.unitPriceCents)
      changes.push(
        old.unitPriceCents == null
          ? `“${line.description}”: priced at ${price(line.unitPriceCents)}`
          : line.unitPriceCents == null
            ? `“${line.description}”: price removed`
            : `“${line.description}”: price from ${price(old.unitPriceCents)} to ${price(line.unitPriceCents)}`,
      );
    if (old.flagged && !line.flagged) changes.push(`Checked “${line.description}”`);
  }
  return changes;
}

export async function updateQuote(
  tenantId: string,
  userId: string,
  quoteId: string,
  input: QuoteUpdateInput,
): Promise<QuoteDetail> {
  await tenantWork(tenantId, async (tx, fx) => {
    const [quote] = await tx.select().from(quotes).where(eq(quotes.id, quoteId)).for("update");
    if (!quote) throw notFound("Quote");
    if (quote.status !== "draft")
      throw new HttpError(
        409,
        "quote_locked",
        "This quote has gone to the customer. Reopen it to make changes.",
      );

    const patch: Partial<QuoteRow> = {};
    const changes: string[] = [];
    if (input.title !== undefined && input.title !== quote.title) {
      patch.title = input.title;
      changes.push(`Title: “${input.title}”`);
    }
    if (input.notes !== undefined && (input.notes || null) !== quote.notes) {
      patch.notes = input.notes || null;
      changes.push(
        input.notes ? "Changed the note to the customer" : "Removed the note to the customer",
      );
    }

    if (input.lines !== undefined) {
      const before = await linesOf(tx, quoteId);
      const byId = new Map(before.map((line) => [line.id, line]));
      const next = input.lines.map((line, position) => {
        const old = line.id ? byId.get(line.id) : undefined;
        const unitPriceCents =
          line.unitPriceDollars == null ? null : toCents(line.unitPriceDollars);
        // A line without a price always waits for the owner; otherwise the owner's tick decides.
        const flagged = unitPriceCents == null || (line.flagged ?? old?.flagged ?? false);
        return {
          ...(old && { id: old.id }),
          tenantId,
          quoteId,
          position,
          serviceId: line.serviceId !== undefined ? line.serviceId : (old?.serviceId ?? null),
          description: line.description,
          quantity: line.quantity,
          unitPriceCents,
          flagged,
          flagReason: !flagged
            ? null
            : unitPriceCents == null
              ? (old?.flagReason ?? line.flagReason ?? "Needs a price.")
              : (line.flagReason ?? old?.flagReason ?? null),
          origin: old?.origin ?? line.origin ?? "custom",
        };
      });
      changes.push(...lineChanges(before, next));
      await tx.delete(quoteLines).where(eq(quoteLines.quoteId, quoteId));
      if (next.length > 0) await tx.insert(quoteLines).values(next);
      patch.totalCents = quoteTotal(next);
    }

    if (input.depositDollars !== undefined) {
      const depositCents = input.depositDollars == null ? null : toCents(input.depositDollars);
      if (depositCents !== quote.depositCents) {
        patch.depositCents = depositCents;
        changes.push(
          depositCents == null ? "Removed the deposit" : `Deposit: ${dollars(depositCents)}`,
        );
      }
    }
    if (input.depositCapture !== undefined && input.depositCapture !== quote.depositCapture) {
      patch.depositCapture = input.depositCapture;
      changes.push(
        input.depositCapture === "hold"
          ? "Deposit held on the card until the work"
          : "Deposit charged straight away",
      );
    }

    const total = patch.totalCents ?? quote.totalCents;
    const deposit = patch.depositCents !== undefined ? patch.depositCents : quote.depositCents;
    if (deposit != null && deposit > total) {
      const message = `The deposit can't be more than the quote total (${dollars(total)}).`;
      throw new HttpError(422, "validation_failed", message, { depositDollars: [message] });
    }

    if (Object.keys(patch).length === 0 && changes.length === 0) return;
    await tx.update(quotes).set(patch).where(eq(quotes.id, quoteId));
    if (changes.length > 0) {
      await addLeadEvent(tx, {
        tenantId,
        leadId: quote.leadId,
        type: "quote.edited",
        actor: `user:${userId}`,
        data: {
          quoteId,
          number: quoteNumber(quote.number),
          changes: changes.slice(0, 12),
          more: Math.max(0, changes.length - 12),
          totalCents: total,
        },
      });
    }
    fx.publish({ type: "quote.updated", quoteId, leadId: quote.leadId });
    fx.publish({ type: "lead.updated", leadId: quote.leadId });
  });
  return getQuote(tenantId, quoteId);
}

/* ── Sending: only ever by the owner (C-45 AC1) ──────────────────────────── */

async function sendQuoteMessages(
  tx: Tx,
  fx: Effects,
  input: {
    tenant: Tenant;
    customer: Customer;
    quote: QuoteRow;
    url: string;
    send: { text: boolean; email?: string | null };
  },
) {
  const { tenant, customer, quote, url, send } = input;
  const deposit =
    quote.depositCents != null ? ` (${dollars(quote.depositCents)} deposit to book)` : "";
  const sent = [];
  if (send.text && customer.phoneE164) {
    sent.push(
      await requestMessage(tx, fx, {
        tenant,
        customerId: customer.id,
        leadId: quote.leadId,
        to: customer.phoneE164,
        purpose: "transactional",
        body: `${greeting(customer)}, it's ${tenant.name}. Here's your quote for ${quote.title}: ${dollars(quote.totalCents)}${deposit}. See it and accept it here: ${url}\nReply STOP to opt out.`,
      }),
    );
  }
  if (send.email) {
    if (customer.email?.toLowerCase() !== send.email.toLowerCase())
      await tx.update(customers).set({ email: send.email }).where(eq(customers.id, customer.id));
    const valid = quote.validUntil
      ? new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: tenant.timezone }).format(
          quote.validUntil,
        )
      : null;
    sent.push(
      await requestEmail(tx, fx, {
        tenant,
        customerId: customer.id,
        leadId: quote.leadId,
        to: send.email,
        purpose: "transactional",
        subject: `Your quote from ${tenant.name} (${quoteNumber(quote.number)})`,
        body: [
          `${greeting(customer)},`,
          "",
          `Thanks for asking ${tenant.name} for a quote. Here it is:`,
          "",
          quote.title,
          `Total: ${dollars(quote.totalCents)}`,
          ...(quote.depositCents != null
            ? [
                `Deposit to book: ${dollars(quote.depositCents)}${quote.depositCapture === "hold" ? " (held on your card until the work goes ahead)" : ""}`,
              ]
            : []),
          "",
          "See the full quote, download it as a PDF and accept it here:",
          url,
          ...(valid ? ["", `The quote is valid until ${valid}.`] : []),
          "",
          tenant.name,
        ].join("\n"),
      }),
    );
  }
  return sent;
}

export async function sendQuote(
  tenantId: string,
  userId: string,
  quoteId: string,
  send: { text: boolean; email?: string | null },
): Promise<QuoteSendResult> {
  const sent = await tenantWork(tenantId, async (tx, fx) => {
    const [quote] = await tx.select().from(quotes).where(eq(quotes.id, quoteId)).for("update");
    if (!quote) throw notFound("Quote");
    if (quote.status === "accepted" || quote.status === "declined") {
      throw new HttpError(
        409,
        "quote_answered",
        `The customer already ${quote.status} this quote.`,
      );
    }
    const lines = await linesOf(tx, quoteId);
    if (quote.status === "draft") {
      if (lines.length === 0)
        throw new HttpError(422, "no_lines", "Add at least one line before sending.");
      const flagged = lines.filter((line) => line.flagged).length;
      if (flagged > 0)
        throw new HttpError(
          422,
          "lines_need_checking",
          `Check the ${flagged === 1 ? "line" : `${flagged} lines`} marked for you before sending.`,
        );
      if (quote.totalCents <= 0)
        throw new HttpError(
          422,
          "zero_total",
          "The quote comes to $0. Add a price before sending.",
        );
    }

    const [row] = await tx
      .select({ lead: leads, customer: customers, tenant: tenants })
      .from(leads)
      .innerJoin(customers, eq(customers.id, leads.customerId))
      .innerJoin(tenants, eq(tenants.id, leads.tenantId))
      .where(eq(leads.id, quote.leadId));
    const { lead, customer, tenant } = row!;

    const now = new Date();
    const token = quote.tokenSealed ? decryptSecret(quote.tokenSealed) : randomToken();
    const firstSend = quote.status === "draft";
    const patch: Partial<QuoteRow> = {
      ...(!quote.tokenSealed && { tokenHash: sha256(token), tokenSealed: encryptSecret(token) }),
      ...(firstSend && {
        status: "sent" as const,
        sentAt: now,
        validUntil: addDays(now, QUOTE_VALID_DAYS),
        viewedAt: null,
      }),
    };
    // Sending a sent quote again only re-sends the link.
    const [updated] =
      Object.keys(patch).length > 0
        ? await tx.update(quotes).set(patch).where(eq(quotes.id, quoteId)).returning()
        : [quote];

    // The quote's total becomes the job's price (this is what moves the card to Quoted).
    if (lead.valueCents !== updated!.totalCents) {
      await tx.update(leads).set({ valueCents: updated!.totalCents }).where(eq(leads.id, lead.id));
      await addLeadEvent(tx, {
        tenantId,
        leadId: lead.id,
        type: "value.set",
        actor: `user:${userId}`,
        data: { valueCents: updated!.totalCents, quote: quoteNumber(quote.number) },
      });
    }

    const messages = await sendQuoteMessages(tx, fx, {
      tenant,
      customer,
      quote: updated!,
      url: quoteUrl(token),
      send,
    });
    await addLeadEvent(tx, {
      tenantId,
      leadId: lead.id,
      type: firstSend ? "quote.sent" : "quote.resent",
      actor: `user:${userId}`,
      data: {
        quoteId,
        number: quoteNumber(quote.number),
        revision: quote.revision,
        totalCents: updated!.totalCents,
        depositCents: updated!.depositCents,
        // The exact version the customer received.
        lines: lines.map((line) => ({
          description: line.description,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
        })),
      },
    });
    await advanceLead(tx, fx, { tenantId, leadId: lead.id, reason: "quote_sent" });
    fx.publish({ type: "quote.updated", quoteId, leadId: lead.id });
    fx.publish({ type: "lead.updated", leadId: lead.id });
    return messages;
  });
  return { quote: await getQuote(tenantId, quoteId), messages: sent.map(toMessageItem) };
}

/** Back to a draft for changes. The customer's link shows "being updated" until it's sent again. */
export async function reopenQuote(
  tenantId: string,
  userId: string,
  quoteId: string,
): Promise<QuoteDetail> {
  await tenantWork(tenantId, async (tx, fx) => {
    const [quote] = await tx.select().from(quotes).where(eq(quotes.id, quoteId)).for("update");
    if (!quote) throw notFound("Quote");
    if (quote.status === "draft") return;
    if (quote.status === "accepted")
      throw new HttpError(
        409,
        "quote_accepted",
        "The customer accepted this quote, so it can't change. Start a new quote for extra work.",
      );
    await tx
      .update(quotes)
      .set({ status: "draft", revision: quote.revision + 1, declinedAt: null, declineReason: null })
      .where(eq(quotes.id, quoteId));
    await addLeadEvent(tx, {
      tenantId,
      leadId: quote.leadId,
      type: "quote.reopened",
      actor: `user:${userId}`,
      data: { quoteId, number: quoteNumber(quote.number), revision: quote.revision + 1 },
    });
    fx.publish({ type: "quote.updated", quoteId, leadId: quote.leadId });
    fx.publish({ type: "lead.updated", leadId: quote.leadId });
  });
  return getQuote(tenantId, quoteId);
}

/** Throws away a draft that never went out. */
export async function discardQuote(tenantId: string, userId: string, quoteId: string) {
  await tenantWork(tenantId, async (tx, fx) => {
    const [quote] = await tx.select().from(quotes).where(eq(quotes.id, quoteId)).for("update");
    if (!quote) throw notFound("Quote");
    if (quote.sentAt)
      throw new HttpError(
        409,
        "quote_sent",
        "This quote has gone to the customer, so it stays on record.",
      );
    await tx.delete(quotes).where(eq(quotes.id, quoteId));
    await addLeadEvent(tx, {
      tenantId,
      leadId: quote.leadId,
      type: "quote.discarded",
      actor: `user:${userId}`,
      data: { number: quoteNumber(quote.number) },
    });
    fx.publish({ type: "lead.updated", leadId: quote.leadId });
  });
}

/* ── The PDF (C-45: branded HTML → PDF) ──────────────────────────────────── */

const pdfCache = new Map<string, Buffer>();

async function renderPdf(key: string, html: string) {
  const cached = pdfCache.get(key);
  if (cached) return cached;
  const file = await pdf.render(html);
  pdfCache.set(key, file);
  if (pdfCache.size > 30) pdfCache.delete(pdfCache.keys().next().value!);
  return file;
}

/** Everything the PDF shows. Read with the system role for the customer's link, so the caller picks the db. */
async function documentOf(db: Tx | typeof systemDb, quote: QuoteRow) {
  const [[tenant], [customer], lines, [number]] = await Promise.all([
    db.select().from(tenants).where(eq(tenants.id, quote.tenantId)),
    db.select().from(customers).where(eq(customers.id, quote.customerId)),
    db
      .select()
      .from(quoteLines)
      .where(eq(quoteLines.quoteId, quote.id))
      .orderBy(asc(quoteLines.position)),
    db
      .select({ e164: phoneNumbers.e164 })
      .from(phoneNumbers)
      .where(and(eq(phoneNumbers.tenantId, quote.tenantId), eq(phoneNumbers.status, "active")))
      .limit(1),
  ]);
  const html = quoteHtml({
    business: {
      name: tenant!.name,
      tradeLabel: TRADE_LABELS[tenant!.trade],
      city: tenant!.city,
      state: tenant!.state,
      phone: number?.e164 ?? null,
      licenseNumber: tenant!.licenseNumber,
      insuranceCarrier: tenant!.insuranceCarrier,
      yearsInBusiness: tenant!.yearsInBusiness,
      googleProfileUrl: tenant!.googleProfileUrl,
      profileUrl: profileUrl(tenant!.slug),
    },
    number: quoteNumber(quote.number),
    issuedAt: quote.sentAt ?? quote.updatedAt,
    validUntil: quote.validUntil,
    draft: quote.status === "draft",
    customer: {
      name: customer?.name ?? null,
      phone: customer?.phoneE164 ?? null,
      email: customer?.email ?? null,
      address: customer?.address ?? null,
    },
    title: quote.title,
    lines,
    totalCents: quote.totalCents,
    depositCents: quote.depositCents,
    depositCapture: quote.depositCapture,
    notes: quote.notes,
    acceptUrl: linkOf(quote),
    timezone: tenant!.timezone,
  });
  return { html, filename: `${tenant!.slug}-${quoteNumber(quote.number)}.pdf` };
}

/** The owner's preview, drafts included. */
export async function quotePdf(tenantId: string, quoteId: string) {
  const { quote, doc } = await withTenant(tenantId, async (tx) => {
    const [quote] = await tx.select().from(quotes).where(eq(quotes.id, quoteId));
    if (!quote) throw notFound("Quote");
    return { quote, doc: await documentOf(tx, quote) };
  });
  return {
    filename: doc.filename,
    pdf: await renderPdf(`${quote.id}:${quote.updatedAt.getTime()}`, doc.html),
  };
}

/* ── The customer's side: no login, the link is the key ─────────────────── */

async function resolveQuote(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) throw notFound("Quote");
  const [row] = await systemDb
    .select()
    .from(quotes)
    .where(eq(quotes.tokenHash, sha256(token)))
    .limit(1);
  if (!row || !row.sentAt) throw notFound("Quote");
  return row;
}

function publicState(row: QuoteRow): PublicQuoteState {
  if (row.status === "accepted") return "accepted";
  if (row.status === "declined") return "declined";
  if (row.status === "draft") return "updating";
  return row.validUntil && row.validUntil.getTime() < Date.now() ? "expired" : "open";
}

async function publicView(row: QuoteRow, token: string): Promise<PublicQuote> {
  const [[tenant], [customer], lines, [account], [deposit]] = await Promise.all([
    systemDb.select().from(tenants).where(eq(tenants.id, row.tenantId)),
    systemDb
      .select({ name: customers.name })
      .from(customers)
      .where(eq(customers.id, row.customerId)),
    systemDb
      .select()
      .from(quoteLines)
      .where(eq(quoteLines.quoteId, row.id))
      .orderBy(asc(quoteLines.position)),
    systemDb.select().from(paymentAccounts).where(eq(paymentAccounts.tenantId, row.tenantId)),
    systemDb
      .select({ status: paymentRequests.status, tokenSealed: paymentRequests.tokenSealed })
      .from(paymentRequests)
      .where(and(eq(paymentRequests.quoteId, row.id), eq(paymentRequests.kind, "deposit")))
      .orderBy(desc(paymentRequests.createdAt))
      .limit(1),
  ]);
  const state = publicState(row);
  return {
    business: await publicBusinessOf(tenant!),
    number: quoteNumber(row.number),
    state,
    title: row.title,
    customerName: customer?.name ?? null,
    // While the owner is changing it, the customer doesn't see half-made lines.
    lines:
      state === "updating"
        ? []
        : lines.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unitPriceCents: line.unitPriceCents ?? 0,
            totalCents: lineTotal(line),
          })),
    totalCents: row.totalCents,
    depositCents: row.depositCents,
    depositCapture: row.depositCapture,
    cardPayments: cardsReady(account ?? null),
    notes: row.notes,
    issuedAt: row.sentAt!.toISOString(),
    validUntil: (row.validUntil ?? addDays(row.sentAt!, QUOTE_VALID_DAYS)).toISOString(),
    acceptedAt: iso(row.acceptedAt),
    declinedAt: iso(row.declinedAt),
    deposit: deposit?.tokenSealed
      ? { url: payUrl(decryptSecret(deposit.tokenSealed)), status: deposit.status }
      : null,
    pdfUrl: `/api/public/quotes/${token}/pdf`,
  };
}

export async function getPublicQuote(token: string): Promise<PublicQuote> {
  const row = await resolveQuote(token);
  if (row.status === "sent" && !row.viewedAt) {
    await tenantWork(row.tenantId, async (tx, fx) => {
      const [first] = await tx
        .update(quotes)
        .set({ viewedAt: new Date() })
        .where(and(eq(quotes.id, row.id), eq(quotes.status, "sent")))
        .returning({ id: quotes.id });
      if (!first) return;
      await addLeadEvent(tx, {
        tenantId: row.tenantId,
        leadId: row.leadId,
        type: "quote.viewed",
        actor: "customer",
        data: { quoteId: row.id, number: quoteNumber(row.number) },
      });
      fx.publish({ type: "quote.updated", quoteId: row.id, leadId: row.leadId });
      fx.publish({ type: "lead.updated", leadId: row.leadId });
    });
  }
  return publicView(row, token);
}

export async function publicQuotePdf(token: string) {
  const row = await resolveQuote(token);
  if (row.status === "draft")
    throw new HttpError(
      409,
      "quote_updating",
      "This quote is being updated. You'll get the new one shortly.",
    );
  const doc = await documentOf(systemDb, row);
  return {
    filename: doc.filename,
    pdf: await renderPdf(`${row.id}:${row.updatedAt.getTime()}`, doc.html),
  };
}

/** The customer accepts. With a deposit, they go straight on to the card checkout (C-15). */
export async function acceptQuote(
  token: string,
  meta: { ipAddress: string | null },
): Promise<QuoteAcceptResult> {
  const row = await resolveQuote(token);
  const state = publicState(row);
  if (state === "updating")
    throw new HttpError(
      409,
      "quote_updating",
      "This quote is being updated. You'll get the new one shortly.",
    );
  if (state === "expired")
    throw new HttpError(
      409,
      "quote_expired",
      "This quote has expired. Ask the business for a new one.",
    );
  if (state === "declined")
    throw new HttpError(
      409,
      "quote_declined",
      "You declined this quote. Contact the business if you've changed your mind.",
    );

  let depositToken: string | null = null;
  if (state === "open") {
    depositToken = await tenantWork(row.tenantId, async (tx, fx) => {
      const [locked] = await tx.select().from(quotes).where(eq(quotes.id, row.id)).for("update");
      if (!locked || locked.status !== "sent") return null;
      const now = new Date();
      await tx
        .update(quotes)
        .set({
          status: "accepted",
          acceptedAt: now,
          acceptedRevision: locked.revision,
          acceptedIp: meta.ipAddress,
        })
        .where(eq(quotes.id, row.id));
      await addLeadEvent(tx, {
        tenantId: row.tenantId,
        leadId: row.leadId,
        type: "quote.accepted",
        actor: "customer",
        data: {
          quoteId: row.id,
          number: quoteNumber(row.number),
          revision: locked.revision,
          totalCents: locked.totalCents,
        },
      });

      const [customer] = await tx.select().from(customers).where(eq(customers.id, row.customerId));
      let token: string | null = null;
      if (locked.depositCents != null) {
        const [account] = await tx
          .select()
          .from(paymentAccounts)
          .where(eq(paymentAccounts.tenantId, row.tenantId));
        const created = await insertPaymentRequest(tx, {
          tenantId: row.tenantId,
          leadId: row.leadId,
          customerId: row.customerId,
          quoteId: row.id,
          kind: "deposit",
          // Without card payments the deposit is paid another way, so there's nothing to hold.
          capture: cardsReady(account ?? null) ? locked.depositCapture : "charge",
          amountCents: locked.depositCents,
          description: locked.title,
          createdBy: "customer",
        });
        await addLeadEvent(tx, {
          tenantId: row.tenantId,
          leadId: row.leadId,
          type: "payment.requested",
          actor: "customer",
          data: {
            paymentId: created.row.id,
            kind: "deposit",
            capture: created.row.capture,
            amountCents: created.row.amountCents,
            description: created.row.description,
          },
        });
        token = created.token;
      }
      await notifyOwner(tx, fx, {
        tenantId: row.tenantId,
        kind: "quote",
        title: `${customerName(customer!)} accepted your quote`,
        body: `${quoteNumber(row.number)} for ${locked.title}: ${dollars(locked.totalCents)}.${locked.depositCents != null ? ` They're paying the ${dollars(locked.depositCents)} deposit.` : " Book the visit."}`,
        leadId: row.leadId,
      });
      fx.publish({ type: "quote.updated", quoteId: row.id, leadId: row.leadId });
      fx.publish({ type: "lead.updated", leadId: row.leadId });
      return token;
    });
  } else {
    // Accepted already (a second tap, or coming back later): pick up the deposit if it's still open.
    const [deposit] = await systemDb
      .select({ status: paymentRequests.status, tokenSealed: paymentRequests.tokenSealed })
      .from(paymentRequests)
      .where(and(eq(paymentRequests.quoteId, row.id), eq(paymentRequests.kind, "deposit")))
      .orderBy(desc(paymentRequests.createdAt))
      .limit(1);
    if (deposit?.status === "open" && deposit.tokenSealed)
      depositToken = decryptSecret(deposit.tokenSealed);
  }

  let checkoutUrl: string | null = null;
  if (depositToken) {
    // No card checkout (cards off, or the provider is down): the deposit's pay link on the page still works.
    checkoutUrl = await startCheckout(depositToken)
      .then((session) => session.url)
      .catch(() => null);
  }
  return { checkoutUrl, quote: await publicView(await resolveQuote(token), token) };
}

export async function declineQuote(token: string, reason: string): Promise<PublicQuote> {
  const row = await resolveQuote(token);
  if (publicState(row) !== "open") return publicView(row, token);
  await tenantWork(row.tenantId, async (tx, fx) => {
    const [locked] = await tx.select().from(quotes).where(eq(quotes.id, row.id)).for("update");
    if (!locked || locked.status !== "sent") return;
    await tx
      .update(quotes)
      .set({ status: "declined", declinedAt: new Date(), declineReason: reason || null })
      .where(eq(quotes.id, row.id));
    await addLeadEvent(tx, {
      tenantId: row.tenantId,
      leadId: row.leadId,
      type: "quote.declined",
      actor: "customer",
      data: { quoteId: row.id, number: quoteNumber(row.number), reason },
    });
    const [customer] = await tx.select().from(customers).where(eq(customers.id, row.customerId));
    await notifyOwner(tx, fx, {
      tenantId: row.tenantId,
      kind: "quote",
      title: `${customerName(customer!)} declined your quote`,
      body: reason ? `“${reason}”` : `${quoteNumber(row.number)} for ${locked.title}.`,
      leadId: row.leadId,
    });
    fx.publish({ type: "quote.updated", quoteId: row.id, leadId: row.leadId });
    fx.publish({ type: "lead.updated", leadId: row.leadId });
  });
  return publicView(await resolveQuote(token), token);
}
