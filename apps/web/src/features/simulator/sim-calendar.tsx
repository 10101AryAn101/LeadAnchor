"use client";

import { TZDate } from "@date-fns/tz";
import type { SimCalendarEvent } from "@leadanchor/contracts";
import { IconArrowRight, IconCalendarPlus, IconTrash } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { slotTime } from "@/features/booking/slot-picker";
import { api, isApiError } from "@/lib/api";
import { keys, useBookingSettings, useSimCalendar } from "@/lib/queries";

/** A wall-clock time on the business's clock, as an instant. */
function zonedIso(date: string, time: string, timeZone: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(+new TZDate(year!, month! - 1, day!, hour!, minute!, timeZone)).toISOString();
}

/** Tomorrow's date on the business's clock, as "2026-11-02". */
const tomorrowIn = (timeZone: string) =>
  new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA", { timeZone });

const dayOf = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(new Date(iso));

/**
 * Development only: the stand-in for the owner's Google or Outlook calendar. Put a dentist
 * appointment in it and watch those booking times disappear, or a clash get flagged.
 */
export function SimulatedCalendar() {
  const { data: booking } = useBookingSettings();
  const connected =
    booking?.calendar.connected === true && booking.calendar.provider === "simulator";
  const events = useSimCalendar(connected);
  const timeZone = booking?.timezone ?? "America/Chicago";
  const changed = useChanged();
  const move = useMutation({
    mutationFn: (event: SimCalendarEvent) =>
      api<{ events: SimCalendarEvent[] }>(`/dev/simulator/calendar/${event.id}`, {
        method: "PATCH",
        body: {
          startsAt: new Date(new Date(event.startsAt).getTime() + 3_600_000).toISOString(),
          endsAt: new Date(new Date(event.endsAt).getTime() + 3_600_000).toISOString(),
        },
      }),
    onSuccess: (data) => changed(data, "Moved an hour later and synced."),
    onError: failedToast,
  });
  const remove = useMutation({
    mutationFn: (event: SimCalendarEvent) =>
      api<{ events: SimCalendarEvent[] }>(`/dev/simulator/calendar/${event.id}`, {
        method: "DELETE",
      }),
    onSuccess: (data) => changed(data, "Deleted from the calendar and synced."),
    onError: failedToast,
  });

  const byDay = new Map<string, SimCalendarEvent[]>();
  for (const event of [...(events.data ?? [])].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  )) {
    const day = dayOf(event.startsAt, timeZone);
    byDay.set(day, [...(byDay.get(day) ?? []), event]);
  }

  return (
    <section id="calendar" className="scroll-mt-24 space-y-4 rounded-lg border bg-card p-5">
      <div className="space-y-1">
        <h2 className="text-[17px] font-bold">The owner&apos;s calendar (simulated)</h2>
        <p className="text-[15px] text-muted-foreground">
          Stands in for Google Calendar or Outlook. Bookings show up here; what you add blocks those
          times on the booking page, and a clash with a booked visit is flagged on the job. Times
          are the business&apos;s ({timeZone.replace("_", " ")}).
        </p>
      </div>

      {!booking ? (
        <Skeleton className="h-32 rounded-lg" />
      ) : !connected ? (
        <div className="rounded-lg bg-muted p-4 text-[15px]">
          Connect the calendar first, in{" "}
          <Link href="/settings#booking" className="font-semibold text-primary">
            Settings → Online booking
          </Link>
          .
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            {events.isPending ? (
              <Skeleton className="h-32 rounded-lg" />
            ) : byDay.size === 0 ? (
              <p className="text-[15px] text-muted-foreground">Nothing in the calendar yet.</p>
            ) : (
              [...byDay].map(([day, list]) => (
                <div key={day}>
                  <h3 className="text-sm font-semibold text-muted-foreground">{day}</h3>
                  <ul className="mt-1 divide-y rounded-lg border bg-background">
                    {list.map((event) => (
                      <li
                        key={event.id}
                        className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
                      >
                        <span className="tabular w-36 shrink-0 text-[15px]">
                          {slotTime(event.startsAt, timeZone)} – {slotTime(event.endsAt, timeZone)}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[15px] font-medium">
                          {event.title}
                        </span>
                        {event.fromLeadAnchor && (
                          <span className="inline-flex h-6 items-center rounded-full bg-primary-subtle px-2 text-[13px] font-medium text-primary-subtle-foreground">
                            From LeadAnchor
                          </span>
                        )}
                        <span className="flex">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={move.isPending}
                            onClick={() => move.mutate(event)}
                          >
                            <IconArrowRight /> 1 hr later
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Delete ${event.title}`}
                            disabled={remove.isPending}
                            onClick={() => remove.mutate(event)}
                          >
                            <IconTrash />
                          </Button>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </div>

          <AddEvent timeZone={timeZone} />
        </div>
      )}
    </section>
  );
}

const failedToast = (error: unknown) =>
  toast.error(isApiError(error) ? error.message : "That didn't work.");

/** After a change: the calendar has synced, so free times and clash flags may have moved. */
function useChanged() {
  const queryClient = useQueryClient();
  return (data: { events: SimCalendarEvent[] }, message: string) => {
    queryClient.setQueryData(keys.simCalendar, data.events);
    void queryClient.invalidateQueries({ queryKey: keys.bookingSettings });
    void queryClient.invalidateQueries({ queryKey: keys.leads });
    void queryClient.invalidateQueries({ queryKey: ["lead"] });
    toast.success(message);
  };
}

function AddEvent({ timeZone }: { timeZone: string }) {
  const changed = useChanged();
  const [title, setTitle] = useState("Dentist");
  const [date, setDate] = useState(() => tomorrowIn(timeZone));
  const [start, setStart] = useState("10:00");
  const [end, setEnd] = useState("11:00");
  const add = useMutation({
    mutationFn: () =>
      api<{ events: SimCalendarEvent[] }>("/dev/simulator/calendar", {
        method: "POST",
        body: {
          title,
          startsAt: zonedIso(date, start, timeZone),
          endsAt: zonedIso(date, end, timeZone),
        },
      }),
    onSuccess: (data) => changed(data, "Added to the calendar and synced."),
    onError: failedToast,
  });

  return (
    <form
      className="space-y-3 rounded-lg border bg-background p-4"
      onSubmit={(event) => {
        event.preventDefault();
        add.mutate();
      }}
    >
      <p className="font-semibold">Add something to the calendar</p>
      <Field>
        <FieldLabel htmlFor="sim-event-title">What</FieldLabel>
        <Input
          id="sim-event-title"
          value={title}
          maxLength={80}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="sim-event-date">Day</FieldLabel>
        <Input
          id="sim-event-date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field>
          <FieldLabel htmlFor="sim-event-start">From</FieldLabel>
          <Input
            id="sim-event-start"
            type="time"
            step={900}
            value={start}
            onChange={(event) => setStart(event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="sim-event-end">To</FieldLabel>
          <Input
            id="sim-event-end"
            type="time"
            step={900}
            value={end}
            onChange={(event) => setEnd(event.target.value)}
          />
        </Field>
      </div>
      <Button
        type="submit"
        className="w-full"
        disabled={!title.trim() || !date || !start || !end || add.isPending}
      >
        {add.isPending ? <Spinner /> : <IconCalendarPlus />} Add and sync
      </Button>
    </form>
  );
}
