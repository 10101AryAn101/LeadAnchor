"use client";

import { CALL_OUTCOME_LABELS, type CallItem, type CallOutcome } from "@leadanchor/contracts";
import {
  type Icon,
  IconChevronRight,
  IconHeadset,
  IconPhone,
  IconPhoneCall,
  IconPhoneIncoming,
  IconPhoneX,
  IconRecordMail,
} from "@tabler/icons-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { clockTime, dayLabel, duration, formatPhone } from "@/lib/format";
import { useCalls, useMe } from "@/lib/queries";
import { cn } from "@/lib/utils";

const OUTCOME: Record<CallOutcome, { icon: Icon; tone: string }> = {
  in_progress: { icon: IconPhoneIncoming, tone: "bg-info-subtle text-info-strong" },
  answered: { icon: IconPhoneCall, tone: "bg-muted text-muted-foreground" },
  ghost: { icon: IconPhoneX, tone: "bg-signal-subtle text-signal-strong" },
  voicemail: { icon: IconRecordMail, tone: "bg-signal-subtle text-signal-strong" },
  dispatcher_completed: { icon: IconHeadset, tone: "bg-primary-subtle text-primary-subtle-foreground" },
  dispatcher_abandoned: { icon: IconPhoneX, tone: "bg-signal-subtle text-signal-strong" },
};

type Filter = "all" | "caught" | "answered";
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All calls" },
  { id: "caught", label: "Caught for you" },
  { id: "answered", label: "Answered by you" },
];

export function CallsView() {
  const { data: calls, isPending } = useCalls();
  const { data: me } = useMe();
  const [filter, setFilter] = useState<Filter>("all");

  const groups = useMemo(() => {
    const rows = (calls ?? []).filter((call) =>
      filter === "all" ? true : filter === "answered" ? call.outcome === "answered" : call.outcome !== "answered" && call.outcome !== "in_progress",
    );
    const byDay = new Map<string, CallItem[]>();
    for (const call of rows) byDay.set(dayLabel(call.startedAt), [...(byDay.get(dayLabel(call.startedAt)) ?? []), call]);
    return [...byDay.entries()];
  }, [calls, filter]);

  return (
    <div className="space-y-5">
      <PageHeader title="Calls" description="Every call to your LeadAnchor line and what happened to it." />

      <div className="flex gap-2 overflow-x-auto" role="tablist">
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

      {isPending ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[72px] rounded-lg" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <Empty className="rounded-lg border border-dashed py-14">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <IconPhone />
            </EmptyMedia>
            <EmptyTitle>No calls yet</EmptyTitle>
            <EmptyDescription>
              Calls to {formatPhone(me?.tenant?.trackingNumber)} show up here. Forward your current number to it so missed calls are caught too.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button variant="outline" nativeButton={false} render={<Link href="/settings#forwarding" />}>
              How to forward your line
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="space-y-6">
          {groups.map(([day, rows]) => (
            <section key={day}>
              <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{day}</h2>
              <ul className="divide-y overflow-hidden rounded-lg border bg-card">
                {rows.map((call) => (
                  <CallRow key={call.id} call={call} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function CallRow({ call }: { call: CallItem }) {
  const meta = OUTCOME[call.outcome];
  const name = call.customer?.name ?? formatPhone(call.from);
  const content = (
    <>
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", meta.tone)}>
        <meta.icon className="size-5" stroke={1.75} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-3">
          <span className="truncate font-semibold">{name}</span>
          <span className="tabular shrink-0 text-sm text-muted-foreground">{clockTime(call.startedAt)}</span>
        </span>
        <span className="flex items-center gap-2 text-[15px] text-muted-foreground">
          <span>{CALL_OUTCOME_LABELS[call.outcome]}</span>
          {call.durationSecs != null && <span className="tabular text-sm">{duration(call.durationSecs)}</span>}
          {call.callerType === "new" && <span className="text-sm">New caller</span>}
        </span>
        {call.transcript && <span className="mt-0.5 line-clamp-1 block text-sm text-muted-foreground">“{call.transcript}”</span>}
      </span>
      {call.leadId && <IconChevronRight className="size-5 shrink-0 text-muted-foreground" />}
    </>
  );

  return (
    <li>
      {call.leadId ? (
        <Link href={`/leads/${call.leadId}`} className="flex min-h-[72px] items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60">
          {content}
        </Link>
      ) : (
        <div className="flex min-h-[72px] items-center gap-3 px-4 py-3">{content}</div>
      )}
    </li>
  );
}
