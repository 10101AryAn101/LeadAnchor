"use client";

import { type AutoMoveReason, LEAD_STAGE_LABELS, type LeadDetail, type LeadEvent, type LeadStage, type MessageItem } from "@leadanchor/contracts";
import {
  IconCalendarEvent,
  IconCalendarX,
  IconCamera,
  IconCurrencyDollar,
  IconEye,
  IconFileText,
  type Icon,
  IconHeadset,
  IconLink,
  IconMessage,
  IconNote,
  IconPhoneCall,
  IconPhoneOutgoing,
  IconPhoneX,
  IconRecordMail,
  IconSend,
  IconShieldCheck,
  IconShieldX,
} from "@tabler/icons-react";
import { type ReactNode, useMemo, useState } from "react";
import { clockTime, dayLabel, fullDate, money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StageGlyph } from "./lead-meta";

type Filter = "all" | "calls" | "messages" | "photos";
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

/** Why a card moved by itself, in the owner's words. */
const AUTO_MOVE_WHY: Record<AutoMoveReason, string> = {
  owner_called: "You tapped Call.",
  owner_texted: "You tapped Text.",
  owner_answered: "You answered their call.",
  form_sent: "You sent them the request form.",
  price_set: "You added a price.",
  visit_booked: "You booked a visit.",
};

function eventRow(event: LeadEvent, onPhoto: (id: string) => void): Row | null {
  const d = event.data;
  const base = { id: event.id, at: event.createdAt };
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
      return { ...base, kind: "other", icon: IconFileText, tone: "neutral", title: "Summary skipped", body: str(d.reason) };
    case "consent.granted":
      return {
        ...base,
        kind: "messages",
        icon: IconShieldCheck,
        tone: "neutral",
        title: "Agreed to texts",
        body:
          d.source === "web_form"
            ? "Ticked the box on the request form."
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
        kind: "other",
        icon: IconCurrencyDollar,
        tone: "good",
        title: typeof d.valueCents === "number" ? `Job value set to ${money(d.valueCents)}` : "Job value cleared",
      };
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
  return {
    id: `msg-${message.id}`,
    at: message.createdAt,
    kind: "messages",
    icon: IconSend,
    tone: failed ? "bad" : blocked ? "waiting" : "good",
    title: failed ? "Text failed" : blocked ? "Text not sent" : "Text sent",
    body: (
      <>
        <span className="block rounded-md bg-muted px-3 py-2 text-foreground">{message.body}</span>
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
