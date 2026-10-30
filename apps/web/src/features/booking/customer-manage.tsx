"use client";

import type { PublicBooking, PublicOffer, SlotsResponse } from "@leadanchor/contracts";
import {
  IconCalendarEvent,
  IconCalendarPlus,
  IconCalendarX,
  IconCircleCheck,
  IconHourglass,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { BusinessHeader, ContactButtons } from "@/features/money/business-header";
import { api, isApiError } from "@/lib/api";
import { jobLength } from "@/lib/format";
import { SlotPicker, slotLabel } from "./slot-picker";

/** The customer's booking: see it, add it to their calendar, change the time or cancel (C-20). */
export function CustomerManage({ token, initial }: { token: string; initial: PublicBooking }) {
  const [booking, setBooking] = useState(initial);
  const [mode, setMode] = useState<"view" | "change" | "cancel">("view");
  const [slot, setSlot] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const base = `/public/bookings/${encodeURIComponent(token)}`;

  const slots = useQuery({
    queryKey: ["manage-slots", token],
    queryFn: () => api<SlotsResponse>(`${base}/slots`),
    enabled: mode === "change",
  });
  const move = useMutation({
    mutationFn: () =>
      api<PublicBooking>(`${base}/reschedule`, { method: "POST", body: { startsAt: slot } }),
    onSuccess: (data) => {
      setBooking(data);
      setMode("view");
      toast.success("Your booking has a new time.");
    },
    onError: (error) => {
      toast.error(isApiError(error) ? error.message : "That didn't go through. Please try again.");
      setSlot(null);
      void slots.refetch();
    },
  });
  const cancel = useMutation({
    mutationFn: () =>
      api<PublicBooking>(`${base}/cancel`, { method: "POST", body: { reason: reason.trim() } }),
    onSuccess: (data) => {
      setBooking(data);
      setMode("view");
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "That didn't go through. Please try again."),
  });

  const booked = booking.status === "booked";
  return (
    <div className="mx-auto max-w-xl space-y-6 px-5 py-8 sm:py-12">
      <BusinessHeader business={booking.business} />

      <section className="space-y-4 rounded-lg border bg-card p-5">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary-subtle-foreground">
            {booked ? (
              <IconCalendarEvent className="size-5" />
            ) : (
              <IconCalendarX className="size-5" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold tracking-wide text-primary uppercase">
              {booked
                ? "Your booking"
                : booking.status === "canceled"
                  ? "Cancelled"
                  : "This visit has passed"}
            </p>
            <p className="text-[19px] font-bold">{booking.service.name}</p>
            <p className="text-[15px]">
              {slotLabel(booking.startsAt, booking.timezone)},{" "}
              {jobLength(booking.service.durationMins)}
            </p>
            {booking.customerName && (
              <p className="text-[15px] text-muted-foreground">For {booking.customerName}</p>
            )}
            {booked && booking.confirmedAt && (
              <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-primary">
                <IconCircleCheck className="size-4" /> Confirmed
              </p>
            )}
            {booked && booking.wantsEarlier && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                <IconHourglass className="size-4" /> You&apos;ll hear if an earlier time opens up.
              </p>
            )}
          </div>
        </div>

        {booked && mode === "view" && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" nativeButton={false} render={<a href={`/api${base}/ics`} />}>
              <IconCalendarPlus /> Add to my calendar
            </Button>
            {booking.canChange && (
              <Button variant="outline" onClick={() => setMode("change")}>
                Change the time
              </Button>
            )}
            <Button variant="ghost" onClick={() => setMode("cancel")}>
              Cancel
            </Button>
          </div>
        )}
        {booked && !booking.canChange && mode === "view" && (
          <p className="text-sm text-muted-foreground">
            It&apos;s too close to change online now. Call or text {booking.business.name} if you
            need to.
          </p>
        )}

        {booking.status === "canceled" && (
          <Button nativeButton={false} render={<a href={booking.bookingUrl} />}>
            Book again
          </Button>
        )}
      </section>

      {mode === "change" && (
        <section className="space-y-4">
          <h2 className="text-[19px] font-bold">Pick a new time</h2>
          {slots.isPending ? (
            <Skeleton className="h-40 rounded-lg" />
          ) : slots.data ? (
            <SlotPicker data={slots.data} value={slot} onChange={setSlot} />
          ) : (
            <p className="text-[15px] text-destructive">Couldn&apos;t load the free times.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="lg" disabled={!slot || move.isPending} onClick={() => move.mutate()}>
              {move.isPending && <Spinner />}{" "}
              {slot ? `Move to ${slotLabel(slot, booking.timezone)}` : "Pick a time"}
            </Button>
            <Button size="lg" variant="ghost" onClick={() => setMode("view")}>
              Keep my time
            </Button>
          </div>
        </section>
      )}

      {mode === "cancel" && (
        <section className="space-y-3 rounded-lg border bg-card p-5">
          <label htmlFor="cancel-reason" className="font-semibold">
            Cancel this booking?
          </label>
          <Textarea
            id="cancel-reason"
            rows={2}
            maxLength={300}
            placeholder="Reason (optional)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate()}
            >
              {cancel.isPending && <Spinner />} Yes, cancel it
            </Button>
            <Button variant="ghost" onClick={() => setMode("view")}>
              Keep it
            </Button>
          </div>
        </section>
      )}

      <section className="space-y-3 border-t pt-6">
        <p className="text-[15px] text-muted-foreground">Questions?</p>
        <ContactButtons business={booking.business} />
      </section>
    </div>
  );
}

/** C-22: a freed slot offered from the waitlist. The first yes gets it. */
export function WaitlistOffer({ token, initial }: { token: string; initial: PublicOffer }) {
  const [offer, setOffer] = useState(initial);
  const take = useMutation({
    mutationFn: () =>
      api<PublicOffer>(`/public/offers/${encodeURIComponent(token)}/take`, { method: "POST" }),
    onSuccess: (data) => {
      setOffer(data);
      if (data.state === "taken") toast.error("Sorry, someone just took it.");
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "That didn't go through. Please try again."),
  });

  return (
    <div className="mx-auto max-w-xl space-y-6 px-5 py-8 sm:py-12">
      <BusinessHeader business={offer.business} />
      <section className="space-y-4 rounded-lg border bg-card p-5">
        <p className="text-sm font-semibold tracking-wide text-primary uppercase">
          {offer.state === "yours"
            ? "It's yours"
            : offer.state === "open"
              ? "A time opened up"
              : "This time is gone"}
        </p>
        <p className="text-[19px] font-bold">{offer.service.name}</p>
        <p className="text-[15px]">
          {slotLabel(offer.startsAt, offer.timezone)}, {jobLength(offer.service.durationMins)}
        </p>
        {offer.state === "open" && (
          <>
            <p className="text-[15px] text-muted-foreground">
              {offer.replaces
                ? `Taking it moves your booking from ${slotLabel(offer.replaces, offer.timezone)}. It goes to whoever takes it first.`
                : "It goes to whoever takes it first."}
            </p>
            <Button
              size="lg"
              className="w-full"
              disabled={take.isPending}
              onClick={() => take.mutate()}
            >
              {take.isPending ? <Spinner /> : <IconCircleCheck />} Yes, I&apos;ll take it
            </Button>
          </>
        )}
        {offer.state === "yours" && (
          <>
            <p className="flex items-center gap-2 text-[15px] font-semibold text-primary">
              <IconCircleCheck className="size-5" /> Booked. A confirmation is on its way.
            </p>
            {offer.manageUrl && (
              <Button variant="outline" nativeButton={false} render={<a href={offer.manageUrl} />}>
                See my booking
              </Button>
            )}
          </>
        )}
        {offer.state === "taken" && (
          <p className="text-[15px] text-muted-foreground">
            Someone else took it first. You&apos;re still on the waitlist.
          </p>
        )}
        {offer.state === "expired" && (
          <p className="text-[15px] text-muted-foreground">
            This offer has ended. You&apos;re still on the waitlist.
          </p>
        )}
      </section>
      <section className="space-y-3 border-t pt-6">
        <p className="text-[15px] text-muted-foreground">Questions?</p>
        <ContactButtons business={offer.business} />
      </section>
    </div>
  );
}
