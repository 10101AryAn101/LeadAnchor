"use client";

import { LEAD_STAGE_LABELS, type LeadCard as LeadCardData } from "@leadanchor/contracts";
import { IconCalendarOff, IconPhone } from "@tabler/icons-react";
import { differenceInCalendarDays, format, isToday, isTomorrow, startOfDay } from "date-fns";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { WaitlistPanel } from "@/features/booking/waitlist-panel";
import { formatPhone, telHref } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StageGlyph, UrgencyChip, isWaiting } from "./lead-meta";
import { TagChips } from "./lead-tags";
import { useRecordContact } from "./use-lead-actions";

interface Group {
  key: string;
  title: string;
  detail: string;
  /** Rows show the date as well as the time. */
  showDate?: boolean;
  attention?: boolean;
  leads: LeadCardData[];
}

const URGENCY_RANK = { emergency: 0, high: 1, normal: 2, low: 3 } as const;

/** The board's second view (module 4, C-19): the same open jobs, by when the visit is. */
export function scheduleGroups(leads: LeadCardData[], now = new Date()) {
  const open = leads.filter((lead) => lead.stage !== "won" && lead.stage !== "lost");
  const booked = open.filter((lead) => lead.scheduledFor).sort((a, b) => Date.parse(a.scheduledFor!) - Date.parse(b.scheduledFor!));
  const today = startOfDay(now);
  const groups: Group[] = [];
  const push = (key: string, make: () => Omit<Group, "leads">, lead: LeadCardData) => {
    const group = groups.find((item) => item.key === key);
    if (group) group.leads.push(lead);
    else groups.push({ ...make(), leads: [lead] });
  };

  for (const lead of booked) {
    const at = new Date(lead.scheduledFor!);
    const days = differenceInCalendarDays(at, today);
    if (days < 0) {
      push("passed", () => ({ key: "passed", title: "Visit passed", detail: "Mark each one won or lost", showDate: true, attention: true }), lead);
    } else if (days < 7) {
      const key = format(at, "yyyy-MM-dd");
      const title = isToday(at) ? "Today" : isTomorrow(at) ? "Tomorrow" : format(at, "EEEE");
      push(key, () => ({ key, title, detail: format(at, "EEE, MMM d") }), lead);
    } else {
      push("later", () => ({ key: "later", title: "Later", detail: "Next week and beyond", showDate: true }), lead);
    }
  }

  // Not booked yet: whoever is waiting on a call back first, then the most urgent, then the freshest.
  const unbooked = open
    .filter((lead) => !lead.scheduledFor)
    .sort(
      (a, b) =>
        Number(isWaiting(b)) - Number(isWaiting(a)) ||
        URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] ||
        Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt),
    );
  return { booked: groups, unbooked };
}

export function LeadsSchedule({ leads }: { leads: LeadCardData[] }) {
  const { booked, unbooked } = scheduleGroups(leads);
  const visits = booked.reduce((sum, group) => sum + group.leads.length, 0);

  return (
    <div className="space-y-6">
      {visits === 0 ? (
        <div className="flex gap-3 rounded-lg border border-dashed p-4 text-[15px] text-muted-foreground">
          <IconCalendarOff className="mt-0.5 size-5 shrink-0" />
          <p>No visits booked. Open a job and tap Book a visit, or turn on online booking in Settings; visits show up here by day.</p>
        </div>
      ) : (
        booked.map((group) => (
          <section key={group.key} aria-labelledby={`day-${group.key}`} className="space-y-2">
            <div className="flex items-baseline gap-2 px-1">
              <h2 id={`day-${group.key}`} className={cn("text-[17px] font-bold", group.attention && "text-signal-strong")}>
                {group.title}
              </h2>
              <span className="text-sm text-muted-foreground">
                {group.detail} · {group.leads.length} {group.leads.length === 1 ? "visit" : "visits"}
              </span>
            </div>
            <ul className={cn("divide-y rounded-lg border bg-card", group.attention && "border-signal/40")}>
              {group.leads.map((lead) => (
                <ScheduleRow key={lead.id} lead={lead} showDate={group.showDate} />
              ))}
            </ul>
          </section>
        ))
      )}

      <WaitlistPanel />

      {unbooked.length > 0 && (
        <section aria-labelledby="day-unbooked" className="space-y-2">
          <div className="flex items-baseline gap-2 px-1">
            <h2 id="day-unbooked" className="text-[17px] font-bold">
              Not booked yet
            </h2>
            <span className="text-sm text-muted-foreground">
              {unbooked.length} open {unbooked.length === 1 ? "job" : "jobs"}
            </span>
          </div>
          <ul className="divide-y rounded-lg border bg-card">
            {unbooked.map((lead) => (
              <ScheduleRow key={lead.id} lead={lead} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function ScheduleRow({ lead, showDate = false }: { lead: LeadCardData; showDate?: boolean }) {
  const recordContact = useRecordContact();
  const name = lead.customer.name ?? formatPhone(lead.customer.phone);
  const at = lead.scheduledFor ? new Date(lead.scheduledFor) : null;

  return (
    <li className="flex items-center gap-3 p-3">
      <Link href={`/leads/${lead.id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-md outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring">
        <div className="w-16 shrink-0 text-right">
          {at ? (
            <>
              <p className="tabular text-[17px] leading-6 font-semibold">{format(at, "h:mm")}</p>
              <p className="tabular text-xs text-muted-foreground">{showDate ? format(at, "a · MMM d") : format(at, "a")}</p>
            </>
          ) : (
            <span className="inline-flex flex-col items-end gap-1">
              <StageGlyph stage={lead.stage} />
              <span className="text-xs text-muted-foreground">{LEAD_STAGE_LABELS[lead.stage]}</span>
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] leading-6 font-semibold">{name}</p>
          <p className="truncate text-[15px] text-muted-foreground">{lead.title}</p>
          {(lead.tags.length > 0 || lead.urgency !== "normal") && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <UrgencyChip urgency={lead.urgency} />
              <TagChips tags={lead.tags} max={3} />
            </div>
          )}
        </div>
      </Link>
      <Button
        variant="outline"
        size="icon"
        nativeButton={false}
        render={<a href={telHref(lead.customer.phone)} />}
        onClick={() => recordContact(lead, "call")}
        aria-label={`Call ${name}`}
      >
        <IconPhone />
      </Button>
    </li>
  );
}
