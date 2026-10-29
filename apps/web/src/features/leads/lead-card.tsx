"use client";

import type { LeadCard as LeadCardData } from "@leadanchor/contracts";
import { IconCalendarEvent, IconDots, IconMessage, IconPhone, IconPhoto } from "@tabler/icons-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatPhone, isWithin, money, smsHref, telHref, visitTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SourceLabel, UrgencyChip, WaitingChip, isWaiting } from "./lead-meta";
import { TagChips } from "./lead-tags";
import { useRecordContact } from "./use-lead-actions";

const JUST_ARRIVED_MS = 15_000;

/**
 * One job on the board (brief §5 "LEAD CARD"): who, what they need, how to reach
 * them, and at most one primary and two secondary actions.
 */
export function LeadCard({ lead, onMove, className }: { lead: LeadCardData; onMove: (lead: LeadCardData) => void; className?: string }) {
  const name = lead.customer.name ?? formatPhone(lead.customer.phone);
  const waiting = isWaiting(lead);
  const justArrived = isWithin(lead.createdAt, JUST_ARRIVED_MS);
  const recordContact = useRecordContact();

  return (
    <article className={cn("rounded-lg border bg-card p-4 motion-safe:transition-colors", justArrived && "animate-arrive", className)}>
      <div className="flex min-h-6 items-center justify-between gap-2">
        {waiting ? <WaitingChip since={lead.createdAt} /> : <SourceLabel source={lead.source} />}
        {lead.valueCents != null ? (
          <span className="tabular text-[15px] font-semibold">{money(lead.valueCents)}</span>
        ) : lead.estimatedValueCents != null && lead.stage !== "lost" ? (
          <span className="tabular text-sm text-muted-foreground">{money(lead.estimatedValueCents)} est.</span>
        ) : null}
      </div>

      <Link href={`/leads/${lead.id}`} className="mt-2 block rounded-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring">
        <p className="truncate text-[17px] leading-[22px] font-semibold">{name}</p>
        <p className="mt-0.5 line-clamp-2 text-[15px] leading-5 text-muted-foreground">{lead.title}</p>
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-muted-foreground">
        {lead.customer.name && <span className="tabular">{formatPhone(lead.customer.phone)}</span>}
        {lead.photoCount > 0 && (
          <span className="inline-flex items-center gap-1">
            <IconPhoto className="size-4" stroke={1.75} />
            {lead.photoCount} photo{lead.photoCount === 1 ? "" : "s"}
          </span>
        )}
        {lead.scheduledFor && lead.stage === "scheduled" && (
          <span className="inline-flex items-center gap-1 font-medium text-foreground">
            <IconCalendarEvent className="size-4" stroke={1.75} />
            {visitTime(lead.scheduledFor)}
          </span>
        )}
        <UrgencyChip urgency={lead.urgency} />
      </div>
      <TagChips tags={lead.tags} max={3} className="mt-2" />

      <div className="mt-3 flex items-center gap-2">
        <Button
          className="flex-1"
          nativeButton={false}
          render={<a href={telHref(lead.customer.phone)} />}
          onClick={() => recordContact(lead, "call")}
          aria-label={`Call ${name}`}
        >
          <IconPhone /> Call
        </Button>
        <Button
          variant="outline"
          className="flex-1"
          nativeButton={false}
          render={<a href={smsHref(lead.customer.phone)} />}
          onClick={() => recordContact(lead, "text")}
          aria-label={`Text ${name}`}
        >
          <IconMessage /> Text
        </Button>
        <Button variant="ghost" size="icon" aria-label={`Move ${name}`} onClick={() => onMove(lead)}>
          <IconDots />
        </Button>
      </div>
    </article>
  );
}
