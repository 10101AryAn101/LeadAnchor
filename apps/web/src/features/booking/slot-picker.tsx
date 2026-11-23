"use client";

import type { SlotsResponse } from "@leadanchor/contracts";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";

/** "Mon" and "Nov 2" for a calendar date, whatever the viewer's own time zone. */
function dayParts(date: string) {
  const at = new Date(`${date}T12:00:00Z`);
  return {
    weekday: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short" }).format(at),
    day: new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      month: "short",
      day: "numeric",
    }).format(at),
  };
}

/** A time as the business's clock shows it: "9:30 AM". */
export const slotTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(
    new Date(iso),
  );

/** "Mon, Nov 2 at 9:30 AM" on the business's clock. */
export const slotLabel = (iso: string, timeZone: string) =>
  `${new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(new Date(iso))} at ${slotTime(iso, timeZone)}`;

const hourIn = (iso: string, timeZone: string) =>
  Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).format(
      new Date(iso),
    ),
  ) % 24;

/** "CST", for a note when the viewer is somewhere else. */
const zoneName = (timeZone: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
    .formatToParts(new Date())
    .find((part) => part.type === "timeZoneName")?.value ?? timeZone;

/** Days across the top, then that day's free times by part of the day. Times are the business's. */
export function SlotPicker({
  data,
  value,
  onChange,
}: {
  data: SlotsResponse;
  value: string | null;
  onChange: (iso: string) => void;
}) {
  const open = data.days.filter((day) => day.slots.length > 0);
  const [picked, setPicked] = useState<string | null>(
    () =>
      (value ? (data.days.find((day) => day.slots.includes(value))?.date ?? null) : null) ??
      open[0]?.date ??
      null,
  );
  const day = data.days.find((entry) => entry.date === picked) ?? open[0];
  const elsewhere = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone !== data.timezone;
    } catch {
      return false;
    }
  }, [data.timezone]);

  const groups = useMemo(() => {
    const parts = [
      { key: "morning", title: "Morning", slots: [] as string[] },
      { key: "afternoon", title: "Afternoon", slots: [] as string[] },
      { key: "evening", title: "Evening", slots: [] as string[] },
    ];
    for (const slot of day?.slots ?? []) {
      const hour = hourIn(slot, data.timezone);
      parts[hour < 12 ? 0 : hour < 17 ? 1 : 2]!.slots.push(slot);
    }
    return parts.filter((part) => part.slots.length > 0);
  }, [day, data.timezone]);

  return (
    <div className="space-y-4">
      <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Days">
        {data.days.map((entry) => {
          const { weekday, day: date } = dayParts(entry.date);
          const free = entry.slots.length > 0;
          const selected = entry.date === day?.date;
          return (
            <button
              key={entry.date}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-label={`${weekday}, ${date}${free ? "" : ", no times free"}`}
              disabled={!free}
              onClick={() => setPicked(entry.date)}
              className={cn(
                "flex min-h-16 w-[4.25rem] shrink-0 flex-col items-center justify-center rounded-lg border text-center transition-colors",
                selected
                  ? "border-primary bg-primary text-primary-foreground"
                  : free
                    ? "bg-card hover:bg-muted"
                    : "border-dashed text-muted-foreground/60",
              )}
            >
              <span className="text-[13px] font-medium">{weekday}</span>
              <span className="text-[15px] font-semibold">{date}</span>
            </button>
          );
        })}
      </div>

      {day && groups.length > 0 ? (
        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group.key} className="space-y-2">
              <p className="text-sm font-semibold text-muted-foreground">{group.title}</p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {group.slots.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    aria-pressed={slot === value}
                    onClick={() => onChange(slot)}
                    className={cn(
                      "tabular min-h-11 rounded-md border text-[15px] font-medium transition-colors",
                      slot === value
                        ? "border-primary bg-primary-subtle font-semibold text-primary-subtle-foreground"
                        : "bg-card hover:bg-muted",
                    )}
                  >
                    {slotTime(slot, data.timezone)}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[15px] text-muted-foreground">
          No free times in the days shown.
        </p>
      )}
      {elsewhere && (
        <p className="text-sm text-muted-foreground">
          Times are the business&apos;s local time ({zoneName(data.timezone)}).
        </p>
      )}
    </div>
  );
}
