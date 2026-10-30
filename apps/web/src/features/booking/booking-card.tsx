"use client";

import type { BookingItem, LeadDetail, MessageItem, SlotsResponse } from "@leadanchor/contracts";
import {
  IconAlertTriangle,
  IconCalendarEvent,
  IconCalendarPlus,
  IconCheck,
  IconCircleCheck,
  IconHourglass,
  IconUserOff,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isPast } from "date-fns";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api, isApiError } from "@/lib/api";
import { amount, timeAgo, toDateTimeLocal, visitTime } from "@/lib/format";
import { keys, useServices } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { SlotPicker } from "./slot-picker";

const SOURCE_LABEL: Record<BookingItem["source"], string> = {
  customer: "Booked online",
  owner: "Booked by you",
  waitlist: "From the waitlist",
};

/** Module 8 on a job: the booked visit, how sure it is, and what to do when it has passed. */
export function BookingCard({ lead, onMarkWon }: { lead: LeadDetail; onMarkWon: () => void }) {
  const [sheet, setSheet] = useState<"book" | "cancel" | "noshow" | null>(null);
  const queryClient = useQueryClient();
  const booking = lead.booking;
  const active = booking?.status === "booked" ? booking : null;
  const closed = lead.stage === "won" || lead.stage === "lost";
  const passed = active !== null && isPast(new Date(active.startsAt));
  const replyAs = lead.customer.phone
    ? `/simulator?phone=${encodeURIComponent(lead.customer.phone)}`
    : null;
  const remind = useMutation({
    mutationFn: () => api(`/dev/simulator/bookings/${active!.id}/remind`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.lead(lead.id) });
      toast.success("Reminder sent. Reply YES or NO as the customer in the simulator.");
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "Couldn't send the reminder."),
  });

  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="font-bold">Visit</h2>
      {active ? (
        <div className="mt-1 space-y-2">
          <p className="flex items-center gap-1.5 text-[15px] font-semibold">
            <IconCalendarEvent className="size-[18px] shrink-0 text-primary" />{" "}
            {visitTime(active.startsAt)}
          </p>
          <p className="text-sm text-muted-foreground">
            {[active.service?.name, SOURCE_LABEL[active.source]].filter(Boolean).join(" · ")}
          </p>
          <p
            className={cn(
              "inline-flex items-center gap-1.5 text-sm font-medium",
              active.confirmedAt ? "text-primary" : "text-muted-foreground",
            )}
          >
            {active.confirmedAt ? (
              <IconCircleCheck className="size-4" />
            ) : (
              <IconCheck className="size-4" />
            )}
            {active.confirmedAt
              ? `Confirmed by the customer ${timeAgo(active.confirmedAt)}`
              : active.reminderSentAt
                ? `Reminder sent ${timeAgo(active.reminderSentAt)}, no reply yet`
                : active.confirmationSentAt
                  ? "Confirmation sent; reminder goes the day before"
                  : "Customer not texted about it"}
          </p>
          {active.calendarConflict && (
            <p className="flex items-start gap-1.5 rounded-md bg-signal-subtle p-2.5 text-sm text-signal-strong">
              <IconAlertTriangle className="mt-0.5 size-4 shrink-0" /> {active.calendarConflict}
            </p>
          )}
          {active.wantsEarlier && (
            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <IconHourglass className="size-4" /> Wants an earlier time if one opens up
            </p>
          )}
        </div>
      ) : booking?.status === "canceled" ? (
        <p className="mt-1 text-[15px] text-muted-foreground">
          {visitTime(booking.startsAt)} was cancelled{" "}
          {booking.canceledBy === "customer" ? "by the customer" : "by you"}
          {booking.cancelReason ? `: “${booking.cancelReason}”` : "."}
        </p>
      ) : booking?.status === "no_show" ? (
        <p className="mt-1 text-[15px] text-muted-foreground">
          They didn&apos;t show for {visitTime(booking.startsAt)}.
        </p>
      ) : (
        <p className="mt-1 text-[15px] text-muted-foreground">
          No visit booked. Booking one moves the job to Scheduled.
        </p>
      )}

      {passed && !closed && (
        <div className="mt-3 space-y-2 rounded-md bg-primary-subtle p-3">
          <p className="text-[15px] text-primary-subtle-foreground">
            The visit time has passed. Was the job done?
          </p>
          <div className="flex flex-wrap gap-2">
            <Button className="flex-1" onClick={onMarkWon}>
              <IconCheck /> Mark as won
            </Button>
            <Button
              variant="outline"
              className="flex-1 bg-background"
              onClick={() => setSheet("noshow")}
            >
              <IconUserOff /> They didn&apos;t show
            </Button>
          </div>
        </div>
      )}

      {!closed && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="outline" className="flex-1" onClick={() => setSheet("book")}>
            <IconCalendarPlus /> {active ? "Change" : "Book a visit"}
          </Button>
          {active && !passed && (
            <Button variant="ghost" className="flex-1" onClick={() => setSheet("cancel")}>
              Cancel visit
            </Button>
          )}
        </div>
      )}
      {active && !passed && process.env.NODE_ENV !== "production" && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t pt-2 text-sm text-muted-foreground">
          {!active.reminderSentAt && (
            <button
              type="button"
              className="min-h-9 hover:text-foreground"
              disabled={remind.isPending}
              onClick={() => remind.mutate()}
            >
              Simulator: send the reminder now
            </button>
          )}
          {replyAs && (
            <Link href={replyAs} className="inline-flex min-h-9 items-center hover:text-foreground">
              Simulator: reply as the customer
            </Link>
          )}
        </div>
      )}

      {sheet === "book" && <BookVisitSheet lead={lead} onClose={() => setSheet(null)} />}
      {sheet === "cancel" && active && (
        <CancelVisitSheet lead={lead} onClose={() => setSheet(null)} />
      )}
      {sheet === "noshow" && active && (
        <NoShowSheet lead={lead} booking={active} onClose={() => setSheet(null)} />
      )}
    </section>
  );
}

function BookVisitSheet({ lead, onClose }: { lead: LeadDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: services } = useServices();
  const active = services?.filter((service) => service.active) ?? [];
  const current = lead.booking?.status === "booked" ? lead.booking : null;
  const guess =
    current?.service?.id ??
    active.find((service) => service.name === lead.serviceCategory)?.id ??
    "";
  const [serviceId, setServiceId] = useState<string>(guess);
  const [slot, setSlot] = useState<string | null>(null);
  const [other, setOther] = useState(false);
  const [custom, setCustom] = useState(current ? toDateTimeLocal(current.startsAt) : "");
  const [notify, setNotify] = useState(Boolean(lead.customer.phone));
  const [clash, setClash] = useState<string | null>(null);
  const chosen = serviceId || guess;

  const slots = useQuery({
    queryKey: ["owner-slots", lead.id, chosen],
    queryFn: () =>
      api<SlotsResponse>(`/leads/${lead.id}/slots${chosen ? `?serviceId=${chosen}` : ""}`),
    enabled: !other,
  });
  const startsAt = other
    ? custom && !Number.isNaN(new Date(custom).getTime())
      ? new Date(custom).toISOString()
      : null
    : slot;

  const book = useMutation({
    mutationFn: (allowOverlap: boolean) =>
      api<{ booking: BookingItem; messages: MessageItem[] }>(`/leads/${lead.id}/booking`, {
        method: "POST",
        body: { startsAt, serviceId: chosen || null, notify, allowOverlap },
      }),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: keys.lead(lead.id) });
      void queryClient.invalidateQueries({ queryKey: keys.leads });
      const blocked = data.messages.find((message) => message.status === "blocked");
      toast.success(
        current ? "Visit moved." : "Visit booked. It's on the schedule.",
        blocked ? { description: `Not texted: ${blocked.blockedReason}` } : undefined,
      );
      onClose();
    },
    onError: (error) => {
      if (isApiError(error) && error.code === "slot_taken") return setClash(error.message);
      toast.error(isApiError(error) ? error.message : "Couldn't book the visit.");
    },
  });

  return (
    <ResponsiveSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={current ? "Change the visit" : "Book a visit"}
      className="sm:max-w-lg"
      footer={
        clash ? (
          <div className="flex w-full flex-col gap-2">
            <p className="rounded-md bg-signal-subtle p-3 text-[15px] text-signal-strong">
              {clash}
            </p>
            <div className="flex gap-2">
              <Button size="lg" variant="outline" className="flex-1" onClick={() => setClash(null)}>
                Pick another time
              </Button>
              <Button
                size="lg"
                className="flex-1"
                disabled={book.isPending}
                onClick={() => book.mutate(true)}
              >
                {book.isPending && <Spinner />} Book anyway
              </Button>
            </div>
          </div>
        ) : (
          <Button
            size="lg"
            className="w-full"
            disabled={!startsAt || book.isPending}
            onClick={() => book.mutate(false)}
          >
            {book.isPending && <Spinner />} {current ? "Move the visit" : "Book the visit"}
          </Button>
        )
      }
    >
      <div className="space-y-4 pb-2">
        <Field>
          <FieldLabel htmlFor="visit-service">Service</FieldLabel>
          <select
            id="visit-service"
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-[15px]"
            value={chosen}
            onChange={(event) => {
              setServiceId(event.target.value);
              setSlot(null);
            }}
          >
            <option value="">Visit (1 hour)</option>
            {active.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
                {service.durationMins ? ` (${service.durationMins} min)` : ""}
              </option>
            ))}
          </select>
        </Field>
        {other ? (
          <Field>
            <FieldLabel htmlFor="visit-at">Date and time</FieldLabel>
            <Input
              id="visit-at"
              type="datetime-local"
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
            />
          </Field>
        ) : slots.isPending ? (
          <Skeleton className="h-40 rounded-lg" />
        ) : slots.data ? (
          <SlotPicker data={slots.data} value={slot} onChange={setSlot} />
        ) : (
          <p className="text-[15px] text-destructive">Couldn&apos;t load your free times.</p>
        )}
        <button
          type="button"
          className="text-[15px] font-semibold text-primary"
          onClick={() => setOther((value) => !value)}
        >
          {other ? "Show my free times" : "Another time (outside your hours)"}
        </button>
        {lead.customer.phone && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[15px]">
            <Checkbox checked={notify} onCheckedChange={(checked) => setNotify(checked === true)} />
            Text {lead.customer.name?.split(" ")[0] ?? "the customer"}{" "}
            {current ? "the new time" : "a confirmation"}
          </label>
        )}
      </div>
    </ResponsiveSheet>
  );
}

function CancelVisitSheet({ lead, onClose }: { lead: LeadDetail; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(Boolean(lead.customer.phone));
  const cancel = useMutation({
    mutationFn: () =>
      api(`/leads/${lead.id}/booking/cancel`, {
        method: "POST",
        body: { reason: reason.trim(), notify },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.lead(lead.id) });
      void queryClient.invalidateQueries({ queryKey: keys.leads });
      toast.success(
        "Visit cancelled. The slot is free, and anyone on your waitlist who fits it hears first.",
      );
      onClose();
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "Couldn't cancel the visit."),
  });
  return (
    <ResponsiveSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title="Cancel the visit"
      footer={
        <Button
          size="lg"
          variant="destructive"
          className="w-full"
          disabled={cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          {cancel.isPending && <Spinner />} Cancel the visit
        </Button>
      }
    >
      <div className="space-y-3 pb-2">
        <Textarea
          rows={2}
          maxLength={300}
          placeholder="Reason (optional, for your records)"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
        {lead.customer.phone && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[15px]">
            <Checkbox checked={notify} onCheckedChange={(checked) => setNotify(checked === true)} />
            Text {lead.customer.name?.split(" ")[0] ?? "the customer"} that it&apos;s cancelled
          </label>
        )}
      </div>
    </ResponsiveSheet>
  );
}

function NoShowSheet({
  lead,
  booking,
  onClose,
}: {
  lead: LeadDetail;
  booking: BookingItem;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const held = lead.payments.filter((payment) => payment.status === "held");
  const heldCents = held.reduce((sum, payment) => sum + payment.amountCents, 0);
  const [keepDeposit, setKeepDeposit] = useState(held.length > 0);
  const [rebook, setRebook] = useState(Boolean(lead.customer.phone));
  const mark = useMutation({
    mutationFn: () =>
      api(`/bookings/${booking.id}/no-show`, {
        method: "POST",
        body: { keepDeposit, sendRebookLink: rebook },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.lead(lead.id) });
      toast.success(
        keepDeposit && held.length > 0
          ? `Marked as a no-show. ${amount(heldCents)} deposit collected.`
          : "Marked as a no-show.",
      );
      onClose();
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't save that."),
  });
  return (
    <ResponsiveSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title="They didn't show"
      footer={
        <Button
          size="lg"
          className="w-full"
          disabled={mark.isPending}
          onClick={() => mark.mutate()}
        >
          {mark.isPending && <Spinner />} Save
        </Button>
      }
    >
      <div className="space-y-3 pb-2">
        {held.length > 0 && (
          <label className="flex min-h-11 cursor-pointer items-start gap-2.5 text-[15px]">
            <Checkbox
              className="mt-0.5"
              checked={keepDeposit}
              onCheckedChange={(checked) => setKeepDeposit(checked === true)}
            />
            <span>
              Keep their {amount(heldCents)} deposit
              <span className="block text-sm text-muted-foreground">
                It&apos;s on hold on their card; this collects it.
              </span>
            </span>
          </label>
        )}
        {lead.customer.phone && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[15px]">
            <Checkbox checked={rebook} onCheckedChange={(checked) => setRebook(checked === true)} />
            Text them a link to book a new time
          </label>
        )}
      </div>
    </ResponsiveSheet>
  );
}
