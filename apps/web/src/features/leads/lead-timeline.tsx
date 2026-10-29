"use client";

import { type AutoMoveReason, LEAD_STAGE_LABELS, type LeadDetail, type LeadEvent, type LeadStage, type MessageItem } from "@leadanchor/contracts";
import {
  IconArrowBackUp,
  IconBrandGoogle,
  IconCalendarEvent,
  IconCalendarX,
  IconCamera,
  IconCircleCheck,
  IconCircleX,
  IconCreditCardOff,
  IconCurrencyDollar,
  IconEye,
  IconFileDollar,
  IconFileText,
  type Icon,
  IconHeadset,
  IconLink,
  IconLock,
  IconLockOpen,
  IconMail,
  IconMessage,
  IconNote,
  IconPencil,
  IconPhoneCall,
  IconPhoneOutgoing,
  IconPhoneX,
  IconReceipt,
  IconRecordMail,
  IconSend,
  IconShieldCheck,
  IconShieldX,
  IconTag,
  IconTrash,
  IconWorld,
} from "@tabler/icons-react";
import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "@leadanchor/contracts";
import { type ReactNode, useMemo, useState } from "react";
import { amount, clockTime, dayLabel, fullDate, money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StageGlyph } from "./lead-meta";

type Filter = "all" | "calls" | "messages" | "photos" | "money";
type Tone = "neutral" | "waiting" | "good" | "auto" | "bad";

const TONE: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground",
  waiting: "bg-signal-subtle text-signal-strong",
  good: "bg-primary-subtle text-primary-subtle-foreground",
  auto: "bg-info-subtle text-info-strong",
  bad: "bg-destructive-subtle text-destructive-strong",
};

interface Row {
  id: string;
  at: string;
  kind: Exclude<Filter, "all"> | "other";
  icon: Icon | null;
  stage?: LeadStage;
  tone: Tone;
  title: ReactNode;
  body?: ReactNode;
  aside?: ReactNode;
}

const str = (value: unknown) => (typeof value === "string" ? value : "");
const cents = (value: unknown) => (typeof value === "number" ? amount(value) : "");
const methodLabel = (value: unknown) => PAYMENT_METHOD_LABELS[value as PaymentMethod] ?? str(value);

/** Older entries stored the raw error from the AI service; show those in plain words too. */
function plainSkipReason(reason: string) {
  if (!reason.startsWith("The AI service was unavailable")) return reason;
  const why = /429|quota/i.test(reason) ? "the AI's daily limit was reached" : "the AI service didn't answer";
  return `No AI summary this time: ${why}. The customer's own words are kept instead.`;
}

/** Why a card moved by itself, in the owner's words. */
const AUTO_MOVE_WHY: Record<AutoMoveReason, string> = {
  owner_called: "You tapped Call.",
  owner_texted: "You tapped Text.",
  owner_answered: "You answered their call.",
  form_sent: "You sent them the request form.",
  price_set: "You added a price.",
  quote_sent: "You sent a quote.",
  visit_booked: "You booked a visit.",
};

/** C-45 "full edit history on the lead card": quotes. */
function quoteRow(event: LeadEvent, base: { id: string; at: string }): Row | null {
  const d = event.data;
  const number = str(d.number);
  switch (event.type) {
    case "quote.drafted":
      return {
        ...base,
        kind: "money",
        icon: IconFileDollar,
        tone: "auto",
        title: `Quote ${number} drafted ${d.source === "ai" ? "by AI" : d.source === "price_list" ? "from your price list" : ""}`.trim(),
        body: `${Number(d.lines) || 0} line${d.lines === 1 ? "" : "s"}, ${cents(d.totalCents)}${Number(d.flagged) > 0 ? `, ${Number(d.flagged)} to check` : ""}${typeof d.ms === "number" ? `. Ready in ${(d.ms / 1000).toFixed(1)} s.` : ""}`,
      };
    case "quote.edited": {
      const changes = Array.isArray(d.changes) ? d.changes.map(String) : [];
      return {
        ...base,
        kind: "money",
        icon: IconPencil,
        tone: "neutral",
        title: `Quote ${number} changed`,
        body: (
          <ul className="list-disc space-y-0.5 pl-5">
            {changes.map((change, index) => (
              <li key={index}>{change}</li>
            ))}
            {Number(d.more) > 0 && <li>…and {Number(d.more)} more</li>}
          </ul>
        ),
        aside: <span className="text-sm text-muted-foreground">Total now {cents(d.totalCents)}</span>,
      };
    }
    case "quote.sent":
    case "quote.resent": {
      const lines = Array.isArray(d.lines) ? (d.lines as Array<{ description?: string; quantity?: number; unitPriceCents?: number | null }>) : [];
      return {
        ...base,
        kind: "money",
        icon: IconSend,
        tone: "good",
        title: event.type === "quote.sent" ? `Quote ${number} sent: ${cents(d.totalCents)}` : `Quote ${number} sent again`,
        body:
          event.type === "quote.sent" && lines.length > 0 ? (
            <ul className="space-y-0.5">
              {lines.map((line, index) => (
                <li key={index} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate">
                    {line.description}
                    {(line.quantity ?? 1) > 1 ? ` × ${line.quantity}` : ""}
                  </span>
                  <span className="tabular shrink-0">{line.unitPriceCents != null ? amount(line.unitPriceCents * (line.quantity ?? 1)) : "—"}</span>
                </li>
              ))}
              {typeof d.depositCents === "number" && <li className="text-sm">Deposit to book: {cents(d.depositCents)}</li>}
            </ul>
          ) : undefined,
      };
    }
    case "quote.viewed":
      return { ...base, kind: "money", icon: IconEye, tone: "neutral", title: `Opened quote ${number}` };
    case "quote.accepted":
      return { ...base, kind: "money", icon: IconCircleCheck, tone: "good", title: `Accepted quote ${number}`, body: cents(d.totalCents) };
    case "quote.declined":
      return { ...base, kind: "money", icon: IconCircleX, tone: "bad", title: `Declined quote ${number}`, body: str(d.reason) ? <Quote>{str(d.reason)}</Quote> : undefined };
    case "quote.reopened":
      return { ...base, kind: "money", icon: IconArrowBackUp, tone: "neutral", title: `Quote ${number} reopened for changes` };
    case "quote.discarded":
      return { ...base, kind: "money", icon: IconTrash, tone: "neutral", title: `Draft quote ${number} deleted` };
    default:
      return null;
  }
}

/** Module 7: pay links, holds and money received. */
function paymentRow(event: LeadEvent, base: { id: string; at: string }): Row | null {
  const d = event.data;
  switch (event.type) {
    case "payment.requested":
      return {
        ...base,
        kind: "money",
        icon: IconSend,
        tone: "neutral",
        title: `${d.kind === "deposit" ? "Deposit" : "Payment"} of ${cents(d.amountCents)} requested`,
        body: `${str(d.description)}${d.capture === "hold" ? ". Held on the card, charged when collected." : ""}`,
      };
    case "payment.resent":
      return { ...base, kind: "money", icon: IconSend, tone: "neutral", title: `Pay link for ${cents(d.amountCents)} sent again` };
    case "payment.viewed":
      return { ...base, kind: "money", icon: IconEye, tone: "neutral", title: "Opened the pay link" };
    case "payment.failed":
      return { ...base, kind: "money", icon: IconCreditCardOff, tone: "bad", title: "A card payment didn't go through", body: str(d.reason) };
    case "payment.held":
      return { ...base, kind: "money", icon: IconLock, tone: "good", title: `${cents(d.amountCents)} deposit on hold`, body: str(d.card) ? `On ${str(d.card)}. Not charged until you collect it.` : undefined };
    case "payment.paid":
      return {
        ...base,
        kind: "money",
        icon: IconReceipt,
        tone: "good",
        title: d.collected ? `Collected the ${cents(d.amountCents)} deposit` : d.recorded ? `${cents(d.amountCents)} received by ${methodLabel(d.method)}` : `Paid ${cents(d.amountCents)} by card`,
        body: str(d.card) || undefined,
      };
    case "payment.released":
      return {
        ...base,
        kind: "money",
        icon: IconLockOpen,
        tone: "neutral",
        title: d.reason === "owner" ? `Released the ${cents(d.amountCents)} hold` : `The ${cents(d.amountCents)} hold ended`,
        body: d.reason === "owner" ? "The card wasn't charged." : "Not collected within 7 days, so the card was released.",
      };
    case "payment.canceled":
      return { ...base, kind: "money", icon: IconCircleX, tone: "neutral", title: `Pay link for ${cents(d.amountCents)} closed` };
    case "payment.reported":
      return { ...base, kind: "money", icon: IconCurrencyDollar, tone: "waiting", title: `Says they paid ${cents(d.amountCents)} by ${methodLabel(d.method)}`, body: "Check it arrived, then mark it received." };
    default:
      return null;
  }
}

function eventRow(event: LeadEvent, onPhoto: (id: string) => void): Row | null {
  const d = event.data;
  const base = { id: event.id, at: event.createdAt };
  if (event.type.startsWith("quote.")) return quoteRow(event, base);
  if (event.type.startsWith("payment.")) return paymentRow(event, base);
  switch (event.type) {
    case "call.ghost":
      return { ...base, kind: "calls", icon: IconPhoneX, tone: "waiting", title: "Missed call", body: "Hung up before leaving a message." };
    case "call.dispatcher":
      return {
        ...base,
        kind: "calls",
        icon: IconHeadset,
        tone: "good",
        title: "AI Dispatcher answered",
        body: (
          <>
            {str(d.need) && <Quote>{str(d.need)}</Quote>}
            <span className="mt-1 block">{d.consent === "yes" ? "Agreed to a text with the request form." : "Asked for a call back instead of a text."}</span>
          </>
        ),
      };
    case "call.dispatcher_abandoned":
      return {
        ...base,
        kind: "calls",
        icon: IconPhoneX,
        tone: "waiting",
        title: "Hung up during the AI greeting",
        body: str(d.need) ? <Quote>{str(d.need)}</Quote> : "Call them back.",
      };
    case "call.voicemail":
      return { ...base, kind: "calls", icon: IconRecordMail, tone: "waiting", title: "Left a voicemail" };
    case "voicemail.transcribed":
      return { ...base, kind: "calls", icon: IconRecordMail, tone: "auto", title: "Voicemail transcript", body: <Expandable text={str(d.text)} /> };
    case "ai.extracted":
      return {
        ...base,
        kind: "other",
        icon: IconFileText,
        tone: "auto",
        title: "Summary written (auto)",
        body: str(d.summary),
      };
    case "ai.skipped":
      return { ...base, kind: "other", icon: IconFileText, tone: "neutral", title: "Summary skipped", body: plainSkipReason(str(d.reason)) };
    case "consent.granted":
      return {
        ...base,
        kind: "messages",
        icon: IconShieldCheck,
        tone: "neutral",
        title: d.type === "sms_marketing" ? "Agreed to offers by text" : "Agreed to texts",
        body:
          d.source === "web_form"
            ? "Ticked the box on the request form."
            : d.source === "ivr_dtmf"
              ? "Pressed 1 on their keypad during the call."
              : `${d.source === "voice_ack" ? "Said" : "Texted"} “${str(d.answer) || "yes"}”`,
      };
    case "consent.revoked":
      return { ...base, kind: "messages", icon: IconShieldX, tone: "bad", title: "Opted out of texts", body: `Replied “${str(d.keyword) || "STOP"}”. No more texts will be sent.` };
    case "intake.link_created":
      return { ...base, kind: "messages", icon: IconLink, tone: "neutral", title: "Request form link created" };
    case "intake.opened":
      return { ...base, kind: "other", icon: IconEye, tone: "neutral", title: "Opened the request form" };
    case "intake.submitted":
      return {
        ...base,
        kind: "other",
        icon: IconFileText,
        tone: "good",
        title: "Sent job details",
        body: (
          <>
            {str(d.service) && <span className="block font-medium text-foreground">{str(d.service)}</span>}
            {str(d.details) && <Quote>{str(d.details)}</Quote>}
            {str(d.preferredTime) && <span className="mt-1 block">Preferred time: {str(d.preferredTime)}</span>}
          </>
        ),
      };
    case "photo.analyzed":
      return {
        ...base,
        kind: "photos",
        icon: IconCamera,
        tone: "auto",
        title: "Photo read (auto)",
        body: (
          <button type="button" className="text-left" onClick={() => onPhoto(str(d.mediaId))}>
            <span className="block font-medium text-foreground">{str(d.issue)}</span>
            {[str(d.itemType), [str(d.brand), str(d.model)].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null}
          </button>
        ),
      };
    case "stage.changed": {
      const label = LEAD_STAGE_LABELS[d.to as LeadStage] ?? str(d.to);
      return d.auto
        ? { ...base, kind: "other", icon: null, stage: d.to as LeadStage, tone: "auto", title: `Moved to ${label} automatically`, body: AUTO_MOVE_WHY[d.reason as AutoMoveReason] }
        : { ...base, kind: "other", icon: null, stage: d.to as LeadStage, tone: "neutral", title: `Moved to ${label}` };
    }
    case "contact.started":
      return d.channel === "text"
        ? { ...base, kind: "messages", icon: IconMessage, tone: "neutral", title: "You tapped Text" }
        : { ...base, kind: "calls", icon: IconPhoneOutgoing, tone: "neutral", title: "You tapped Call" };
    case "call.answered":
      return { ...base, kind: "calls", icon: IconPhoneCall, tone: "good", title: "You answered their call" };
    case "visit.booked":
      return { ...base, kind: "other", icon: IconCalendarEvent, tone: "good", title: `Visit booked for ${fullDate(str(d.at))}` };
    case "visit.cleared":
      return { ...base, kind: "other", icon: IconCalendarX, tone: "neutral", title: "Visit removed" };
    case "value.set":
      return {
        ...base,
        kind: "money",
        icon: IconCurrencyDollar,
        tone: "good",
        title: typeof d.valueCents === "number" ? `Job value set to ${money(d.valueCents)}` : "Job value cleared",
        body: str(d.quote) ? `From quote ${str(d.quote)}.` : undefined,
      };
    case "request.received":
      return {
        ...base,
        kind: "other",
        icon: d.channel === "google" ? IconBrandGoogle : IconWorld,
        tone: "neutral",
        title: d.channel === "google" ? "Asked for service from your Google profile" : d.channel === "website" ? "Asked for service on your website" : "Asked for service through your request link",
      };
    case "tags.changed": {
      const added = Array.isArray(d.added) ? d.added.map(String) : [];
      const removed = Array.isArray(d.removed) ? d.removed.map(String) : [];
      const title = added.length > 0 ? `Tagged ${added.join(", ")}` : `Removed tag${removed.length === 1 ? "" : "s"} ${removed.join(", ")}`;
      return { ...base, kind: "other", icon: IconTag, tone: "neutral", title, body: added.length > 0 && removed.length > 0 ? `Removed ${removed.join(", ")}` : undefined };
    }
    case "note.added":
      return { ...base, kind: "other", icon: IconNote, tone: "neutral", title: "Note", body: <span className="whitespace-pre-wrap text-foreground">{str(d.text)}</span> };
    case "message.received":
      return { ...base, kind: "messages", icon: IconMessage, tone: "waiting", title: "Text from customer", body: <Quote>{str(d.text)}</Quote> };
    default:
      return null;
  }
}

function messageRow(message: MessageItem): Row {
  const blocked = message.status === "blocked";
  const failed = message.status === "failed";
  const what = message.channel === "email" ? "Email" : "Text";
  return {
    id: `msg-${message.id}`,
    at: message.createdAt,
    kind: "messages",
    icon: message.channel === "email" ? IconMail : IconSend,
    tone: failed ? "bad" : blocked ? "waiting" : "good",
    title: failed ? `${what} failed` : blocked ? `${what} not sent` : `${what} sent`,
    body: (
      <>
        {message.subject && <span className="mb-1 block font-medium text-foreground">{message.subject}</span>}
        <span className="block rounded-md bg-muted px-3 py-2 whitespace-pre-line text-foreground">{message.body}</span>
        {blocked && message.blockedReason && <span className="mt-1.5 block">{message.blockedReason}</span>}
      </>
    ),
    aside: !blocked && !failed ? <span className="text-sm text-muted-foreground capitalize">{message.status}</span> : null,
  };
}

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "calls", label: "Calls" },
  { id: "messages", label: "Texts" },
  { id: "photos", label: "Photos" },
  { id: "money", label: "Money" },
];

export function LeadTimeline({ lead, onPhoto }: { lead: LeadDetail; onPhoto: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>("all");

  const groups = useMemo(() => {
    const rows = [
      ...lead.events.map((event) => eventRow(event, onPhoto)).filter((row): row is Row => row !== null),
      ...lead.messages.filter((message) => message.direction === "outbound").map(messageRow),
    ]
      .filter((row) => filter === "all" || row.kind === filter)
      // Ties (things saved together) fall back to the time-ordered ids, so they read in the order they happened.
      .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));

    const byDay = new Map<string, Row[]>();
    for (const row of rows) {
      const day = dayLabel(row.at);
      byDay.set(day, [...(byDay.get(day) ?? []), row]);
    }
    return [...byDay.entries()];
  }, [lead.events, lead.messages, filter, onPhoto]);

  return (
    <section aria-label="Activity">
      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="tab"
            aria-selected={filter === option.id}
            onClick={() => setFilter(option.id)}
            className={cn(
              "h-10 shrink-0 rounded-full border border-input px-4 text-[15px] font-medium",
              filter === option.id ? "border-foreground bg-foreground text-background" : "bg-card hover:bg-muted",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <p className="py-10 text-center text-[15px] text-muted-foreground">Nothing here yet.</p>
      ) : (
        <div className="mt-4 space-y-6">
          {groups.map(([day, rows]) => (
            <div key={day}>
              <h3 className="mb-3 text-sm font-semibold text-muted-foreground">{day}</h3>
              <ol className="relative space-y-4 before:absolute before:top-2 before:bottom-2 before:left-[17px] before:w-px before:bg-border">
                {rows.map((row) => (
                  <li key={row.id} className="relative flex gap-3">
                    <span className={cn("relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full ring-4 ring-background", TONE[row.tone])}>
                      {row.icon ? <row.icon className="size-[18px]" stroke={1.75} /> : row.stage ? <StageGlyph stage={row.stage} className="size-[18px]" /> : null}
                    </span>
                    <div className="min-w-0 flex-1 pt-1.5">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="font-semibold">{row.title}</p>
                        <span className="tabular shrink-0 text-sm text-muted-foreground">{clockTime(row.at)}</span>
                      </div>
                      {row.body && <div className="mt-1 text-[15px] leading-6 text-muted-foreground">{row.body}</div>}
                      {row.aside && <div className="mt-1">{row.aside}</div>}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function Quote({ children }: { children: ReactNode }) {
  return <span className="block border-l-2 border-border pl-3 text-foreground">“{children}”</span>;
}

function Expandable({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 220;
  return (
    <span className="block">
      <span className={cn("block text-foreground", !open && long && "line-clamp-3")}>“{text}”</span>
      {long && (
        <button type="button" onClick={() => setOpen((value) => !value)} className="mt-1 text-sm font-semibold text-primary">
          {open ? "Show less" : "Show all"}
        </button>
      )}
    </span>
  );
}
