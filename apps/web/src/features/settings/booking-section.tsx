"use client";

import {
  type BookingSettings,
  type BookingSettingsResponse,
  type CalendarProviderName,
  type CalendarStatus,
  WEEKDAY_KEYS,
  WEEKDAY_LABELS,
  type WeekdayKey,
  bookingSettings,
} from "@leadanchor/contracts";
import {
  IconAlertTriangle,
  IconCalendarCheck,
  IconCalendarClock,
  IconCopy,
  IconExternalLink,
  IconRefresh,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, isApiError } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { timeAgo } from "@/lib/format";
import { keys, useBookingSettings } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Monday first: how owners think about their week. */
const WEEK: WeekdayKey[] = [...WEEKDAY_KEYS.slice(1), "sun"];

/**
 * Module 8 (C-17, C-18): the hours customers can book, the rules around them, the public
 * booking link, and the owner's own calendar so nobody books over a dentist appointment.
 */
export function BookingSection() {
  const { data, isPending } = useBookingSettings();
  return (
    <section id="booking" className="scroll-mt-24 rounded-lg border bg-card p-5">
      <div className="mb-4 space-y-1">
        <h2 className="text-[17px] font-bold">Online booking</h2>
        <p className="text-[15px] text-muted-foreground">
          Customers pick a service and a free time, and it lands on your schedule. They get a
          confirmation and a reminder the day before.
        </p>
      </div>
      {isPending || !data ? (
        <div className="space-y-3">
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      ) : (
        <div className="space-y-4">
          <BookingForm data={data} />
          <CalendarCard calendar={data.calendar} />
        </div>
      )}
    </section>
  );
}

/** Field by field: the stored copy comes back with its keys in another order. */
const same = (a: BookingSettings, b: BookingSettings) =>
  a.enabled === b.enabled &&
  a.stepMins === b.stepMins &&
  a.noticeHours === b.noticeHours &&
  a.windowDays === b.windowDays &&
  a.bufferMins === b.bufferMins &&
  WEEKDAY_KEYS.every(
    (day) =>
      a.hours[day].open === b.hours[day].open &&
      a.hours[day].start === b.hours[day].start &&
      a.hours[day].end === b.hours[day].end,
  );

function BookingForm({ data }: { data: BookingSettingsResponse }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(data.settings);
  const [saved, setSaved] = useState(data.settings);
  // Changes made elsewhere (another device) come in unless the owner is mid-edit.
  if (saved !== data.settings) {
    if (same(draft, saved)) setDraft(data.settings);
    setSaved(data.settings);
  }
  const dirty = !same(draft, data.settings);
  const parsed = bookingSettings.safeParse(draft);
  const badDays = new Set(
    parsed.success ? [] : parsed.error.issues.map((issue) => issue.path[1]).filter(Boolean),
  );

  const save = useMutation({
    mutationFn: (settings: BookingSettings) =>
      api<BookingSettingsResponse>("/booking/settings", { method: "PUT", body: settings }),
    onSuccess: (next, settings) => {
      queryClient.setQueryData(keys.bookingSettings, next);
      void queryClient.invalidateQueries({ queryKey: keys.settings });
      toast.success(
        settings.enabled !== data.settings.enabled
          ? settings.enabled
            ? "Online booking is on. Share your link."
            : "Online booking is off. Your booking link now sends customers to your request form."
          : "Booking settings saved.",
      );
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "Couldn't save the booking settings."),
  });

  const set = <K extends keyof BookingSettings>(key: K, value: BookingSettings[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const setDay = (day: WeekdayKey, patch: Partial<BookingSettings["hours"][WeekdayKey]>) =>
    setDraft((current) => ({
      ...current,
      hours: { ...current.hours, [day]: { ...current.hours[day], ...patch } },
    }));
  const openDays = WEEK.filter((day) => draft.hours[day].open).length;

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (parsed.success) save.mutate(parsed.data);
      }}
    >
      <Field
        orientation="horizontal"
        className="items-start justify-between gap-4 rounded-lg border bg-background p-4"
      >
        <div className="space-y-1">
          <FieldLabel htmlFor="booking-enabled">Let customers book online</FieldLabel>
          <FieldDescription>
            Your website button, Google profile and booking link open a page where they pick a time.
            Jobs that need a look first can still send a request.
          </FieldDescription>
        </div>
        <Switch
          id="booking-enabled"
          checked={draft.enabled}
          onCheckedChange={(checked) => set("enabled", checked)}
        />
      </Field>

      <div className="rounded-lg border bg-background p-4">
        <p className="font-semibold">Hours customers can book</p>
        <p className="text-[15px] text-muted-foreground">
          In your time zone ({data.timezone.replace("_", " ")}). You can still book any time
          yourself.
        </p>
        <ul className="mt-2 divide-y">
          {WEEK.map((day) => {
            const hours = draft.hours[day];
            return (
              <li key={day} className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 py-2">
                <label className="flex w-36 cursor-pointer items-center gap-3 text-[15px]">
                  <Switch
                    checked={hours.open}
                    onCheckedChange={(checked) => setDay(day, { open: checked })}
                    aria-label={`Open on ${WEEKDAY_LABELS[day]}`}
                  />
                  <span className={cn("font-medium", !hours.open && "text-muted-foreground")}>
                    {WEEKDAY_LABELS[day]}
                  </span>
                </label>
                {hours.open ? (
                  <div className="flex w-full items-center gap-2 sm:w-auto">
                    <Input
                      type="time"
                      step={900}
                      aria-label={`${WEEKDAY_LABELS[day]} opening time`}
                      className="min-w-0 flex-1 sm:w-32 sm:flex-none"
                      value={hours.start}
                      onChange={(event) => setDay(day, { start: event.target.value })}
                    />
                    <span className="text-[15px] text-muted-foreground">to</span>
                    <Input
                      type="time"
                      step={900}
                      aria-label={`${WEEKDAY_LABELS[day]} closing time`}
                      aria-invalid={badDays.has(day) || undefined}
                      className="min-w-0 flex-1 sm:w-32 sm:flex-none"
                      value={hours.end}
                      onChange={(event) => setDay(day, { end: event.target.value })}
                    />
                  </div>
                ) : (
                  <span className="text-[15px] text-muted-foreground">Closed</span>
                )}
                {badDays.has(day) && (
                  <p className="w-full text-sm text-destructive">
                    Closing time must be after opening time.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {openDays === 0 && draft.enabled && (
          <p className="mt-2 flex items-center gap-1.5 text-sm text-signal-strong">
            <IconAlertTriangle className="size-4" /> With every day closed, nobody can book.
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field className="sm:col-span-2">
          <FieldLabel>Start times every</FieldLabel>
          <ToggleGroup
            value={[String(draft.stepMins)]}
            onValueChange={(value) =>
              value[0] && set("stepMins", Number(value[0]) as BookingSettings["stepMins"])
            }
            variant="outline"
            aria-label="Start times every"
          >
            {[15, 30, 60].map((mins) => (
              <ToggleGroupItem key={mins} value={String(mins)} className="px-4">
                {mins === 60 ? "Hour" : `${mins} min`}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
        <NumberField
          id="booking-notice"
          label="Shortest notice"
          unit="hours"
          value={draft.noticeHours}
          min={0}
          max={72}
          onChange={(value) => set("noticeHours", value)}
          hint="Nobody can book closer to now than this."
        />
        <NumberField
          id="booking-window"
          label="Book up to"
          unit="days ahead"
          value={draft.windowDays}
          min={1}
          max={60}
          onChange={(value) => set("windowDays", value)}
        />
        <NumberField
          id="booking-buffer"
          label="Time between jobs"
          unit="minutes"
          value={draft.bufferMins}
          min={0}
          max={120}
          onChange={(value) => set("bufferMins", value)}
          hint="Kept free after each visit, to clean up and drive to the next."
        />
      </div>

      {data.servicesWithoutTime > 0 && (
        <p className="rounded-md bg-muted p-3 text-[15px] text-muted-foreground">
          {data.servicesWithoutTime === 1
            ? "One service on your price list has"
            : `${data.servicesWithoutTime} services on your price list have`}{" "}
          no time set, so they&apos;re booked for an hour.{" "}
          <a href="#services" className="font-semibold text-primary">
            Set times
          </a>
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={!dirty || !parsed.success || save.isPending}>
          {save.isPending && <Spinner />} Save booking settings
        </Button>
        {dirty && (
          <Button type="button" variant="ghost" onClick={() => setDraft(data.settings)}>
            Undo changes
          </Button>
        )}
      </div>

      <LinkRow url={data.bookingUrl} on={data.settings.enabled} />
    </form>
  );
}

function NumberField({
  id,
  label,
  unit,
  value,
  min,
  max,
  hint,
  onChange,
}: {
  id: string;
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  hint?: string;
  onChange: (value: number) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputGroup>
        <InputGroupInput
          id={id}
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          value={value}
          onChange={(event) => {
            const next = Math.round(Number(event.target.value));
            if (Number.isFinite(next)) onChange(Math.min(max, Math.max(min, next)));
          }}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupText>{unit}</InputGroupText>
        </InputGroupAddon>
      </InputGroup>
      {hint && <FieldDescription>{hint}</FieldDescription>}
    </Field>
  );
}

function LinkRow({ url, on }: { url: string; on: boolean }) {
  return (
    <div className="space-y-3 rounded-lg border bg-background p-4">
      <div>
        <p className="font-semibold">Your booking link</p>
        <p className="text-[15px] text-muted-foreground">
          {on
            ? "Share it anywhere. Your website button and Google profile use it too (see Website & Google)."
            : "Turn on online booking and save to start using it."}
        </p>
      </div>
      <p className="rounded-md bg-muted px-3 py-2.5 text-[15px] break-all">{url}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={!on}
          onClick={async () =>
            (await copyText(url))
              ? toast.success("Booking link copied.")
              : toast.error("Couldn't copy. Select the link and copy it instead.")
          }
        >
          <IconCopy /> Copy
        </Button>
        <Button
          type="button"
          variant="ghost"
          nativeButton={false}
          render={<a href={new URL(url).pathname} target="_blank" rel="noreferrer" />}
        >
          <IconExternalLink /> Preview
        </Button>
      </div>
    </div>
  );
}

/** What happened on Google's sign-in page, as the API reports it when the owner comes back. */
const SIGN_IN_OUTCOMES: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Google Calendar connected. Your events now block those times." },
  denied: { ok: false, text: "Google sign-in was cancelled, so the calendar isn't connected." },
  no_access: {
    ok: false,
    text: "LeadAnchor needs permission to see and edit your calendar events. Connect again and tick that box.",
  },
  no_offline: {
    ok: false,
    text: "Google didn't allow ongoing access. Remove LeadAnchor from your Google account's connected apps, then connect again.",
  },
  expired: { ok: false, text: "That sign-in took too long. Please connect again." },
  failed: { ok: false, text: "Couldn't connect the calendar. Please try again." },
};

/** Two-way sync with the owner's calendar: their events block times; bookings show up there. */
function CalendarCard({ calendar }: { calendar: CalendarStatus }) {
  const queryClient = useQueryClient();
  const onSettings = (next: BookingSettingsResponse) =>
    queryClient.setQueryData(keys.bookingSettings, next);
  const connect = useMutation({
    mutationFn: (provider: CalendarProviderName) =>
      api<{ url: string | null }>("/calendar/connect", {
        method: "POST",
        body: { provider },
      }),
    onSuccess: ({ url }) => {
      // Google: off to its sign-in page; the owner comes back here with the outcome.
      if (url) return window.location.assign(url);
      void queryClient.invalidateQueries({ queryKey: keys.bookingSettings });
      void queryClient.invalidateQueries({ queryKey: keys.simCalendar });
      toast.success("Calendar connected. Your events now block those times.");
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "Couldn't connect the calendar."),
  });
  useEffect(() => {
    const url = new URL(window.location.href);
    const outcome = SIGN_IN_OUTCOMES[url.searchParams.get("calendar") ?? ""];
    if (!outcome) return;
    if (outcome.ok) toast.success(outcome.text);
    else toast.error(outcome.text);
    url.searchParams.delete("calendar");
    window.history.replaceState(null, "", url);
  }, []);
  const google = calendar.available.includes("google");
  const sync = useMutation({
    mutationFn: () => api<BookingSettingsResponse>("/calendar/sync", { method: "POST" }),
    onSuccess: (next) => {
      onSettings(next);
      void queryClient.invalidateQueries({ queryKey: keys.leads });
      toast.success("Calendar synced.");
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't sync."),
  });
  const disconnect = useMutation({
    mutationFn: () => api<BookingSettingsResponse>("/calendar/disconnect", { method: "POST" }),
    onSuccess: (next) => {
      onSettings(next);
      toast.success("Calendar disconnected.");
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't disconnect."),
  });

  const on = calendar.connected;
  return (
    <div className="space-y-3 rounded-lg border bg-background p-4">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full",
            on
              ? "bg-primary-subtle text-primary-subtle-foreground"
              : "bg-muted text-muted-foreground",
          )}
        >
          {on ? <IconCalendarCheck className="size-5" /> : <IconCalendarClock className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            Your calendar
            {calendar.simulated && (
              <span className="inline-flex h-6 items-center rounded-full bg-muted px-2 text-[13px] font-medium text-muted-foreground">
                Simulator
              </span>
            )}
          </p>
          <p className="text-[15px] text-muted-foreground">
            {on
              ? `Connected to ${calendar.account ?? "your calendar"}. Bookings go into it, and anything you put in it blocks those times.${calendar.lastSyncedAt ? ` Checked ${timeAgo(calendar.lastSyncedAt)}.` : ""}`
              : "Connect Google Calendar or Outlook so your own appointments block booking times and every booking shows up on your phone's calendar."}
          </p>
          {calendar.simulated && (
            <p className="mt-1 text-sm text-muted-foreground">
              Google Calendar and Outlook aren&apos;t set up yet, so a simulated calendar stands in.{" "}
              {on && (
                <Link href="/simulator#calendar" className="font-semibold text-primary">
                  Add events to it
                </Link>
              )}
            </p>
          )}
          {calendar.error && (
            <p className="mt-2 flex items-start gap-1.5 rounded-md bg-signal-subtle p-2.5 text-sm text-signal-strong">
              <IconAlertTriangle className="mt-0.5 size-4 shrink-0" /> {calendar.error}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {on ? (
          <>
            {calendar.error && calendar.provider === "google" && google && (
              <Button
                type="button"
                disabled={connect.isPending}
                onClick={() => connect.mutate("google")}
              >
                {connect.isPending && <Spinner />} Connect again
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={sync.isPending}
              onClick={() => sync.mutate()}
            >
              {sync.isPending ? <Spinner /> : <IconRefresh />} Sync now
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={disconnect.isPending}
              onClick={() => disconnect.mutate()}
            >
              Disconnect
            </Button>
          </>
        ) : google ? (
          <>
            <Button
              type="button"
              disabled={connect.isPending}
              onClick={() => connect.mutate("google")}
            >
              {connect.isPending && connect.variables === "google" && <Spinner />} Connect Google
              Calendar
            </Button>
            {calendar.available.includes("simulator") && (
              <Button
                type="button"
                variant="ghost"
                disabled={connect.isPending}
                onClick={() => connect.mutate("simulator")}
              >
                Use the simulated calendar
              </Button>
            )}
          </>
        ) : (
          <Button
            type="button"
            disabled={connect.isPending}
            onClick={() => connect.mutate("simulator")}
          >
            {connect.isPending && <Spinner />} Connect my calendar
          </Button>
        )}
      </div>
    </div>
  );
}
