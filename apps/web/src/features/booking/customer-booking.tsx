"use client";

import {
  BOOKING_CONSENT_TEXT,
  type BookingCreated,
  type PublicBookingContext,
  type RequestSource,
  type SlotsResponse,
  waitlistConsentText,
} from "@leadanchor/contracts";
import {
  IconArrowLeft,
  IconCalendarPlus,
  IconCircleCheck,
  IconClock,
  IconHourglass,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { BusinessHeader, ContactButtons } from "@/features/money/business-header";
import { api, isApiError } from "@/lib/api";
import { jobLength, money } from "@/lib/format";
import { cn } from "@/lib/utils";
import { SlotPicker, slotLabel } from "./slot-picker";

type Step = "service" | "time" | "details" | "done" | "waitlist" | "waitlisted";
type Service = PublicBookingContext["services"][number];

/** C-18: customers pick a service, see the real free times, and book; the slot is locked for them. */
export function CustomerBooking({
  slug,
  context,
  source,
}: {
  slug: string;
  context: PublicBookingContext;
  source: RequestSource;
}) {
  const [step, setStep] = useState<Step>("service");
  const [service, setService] = useState<Service | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [booked, setBooked] = useState<BookingCreated | null>(null);
  const base = `/public/booking/${slug}`;

  const slots = useQuery({
    queryKey: ["public-slots", slug, service?.id],
    queryFn: () => api<SlotsResponse>(`${base}/slots?serviceId=${service!.id}`),
    enabled: Boolean(service),
    refetchOnWindowFocus: true,
  });

  if (!context.enabled) {
    return (
      <Shell context={context}>
        <section className="space-y-3 rounded-lg border bg-card p-5">
          <p className="font-semibold">
            {context.business.name} isn&apos;t taking online bookings right now.
          </p>
          <p className="text-[15px] text-muted-foreground">
            Send a request instead and they&apos;ll get back to you.
          </p>
          <Button nativeButton={false} render={<a href={context.requestUrl} />}>
            Send a request
          </Button>
        </section>
      </Shell>
    );
  }

  const noTimes = slots.data && slots.data.days.every((day) => day.slots.length === 0);

  return (
    <Shell context={context}>
      {step === "service" && (
        <section className="space-y-3">
          <h2 className="text-[19px] font-bold">What do you need?</h2>
          {context.services.length === 0 ? (
            <p className="text-[15px] text-muted-foreground">Nothing to book online yet.</p>
          ) : (
            <ul className="space-y-2">
              {context.services.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setService(item);
                      setSlot(null);
                      setStep("time");
                    }}
                    className="flex min-h-16 w-full items-center gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{item.name}</span>
                      {item.description && (
                        <span className="block text-sm text-muted-foreground">
                          {item.description}
                        </span>
                      )}
                      <span className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                        <IconClock className="size-4" /> {jobLength(item.durationMins)}
                      </span>
                    </span>
                    {item.priceCents != null && (
                      <span className="tabular shrink-0 font-semibold">
                        from {money(item.priceCents)}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="text-[15px] text-muted-foreground">
            Not sure what you need?{" "}
            <a href={context.requestUrl} className="font-semibold text-primary">
              Describe the job instead
            </a>
          </p>
        </section>
      )}

      {step === "time" && service && (
        <section className="space-y-4">
          <BackButton onClick={() => setStep("service")} />
          <div>
            <h2 className="text-[19px] font-bold">Pick a time</h2>
            <p className="text-[15px] text-muted-foreground">
              {service.name}, {jobLength(service.durationMins)}
            </p>
          </div>
          {slots.isPending ? (
            <div className="space-y-3">
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-32 rounded-lg" />
            </div>
          ) : slots.error ? (
            <p className="text-[15px] text-destructive">
              {isApiError(slots.error) ? slots.error.message : "Couldn't load the free times."}
            </p>
          ) : noTimes ? (
            <WaitlistPrompt
              business={context.business.name}
              onJoin={() => setStep("waitlist")}
              empty
            />
          ) : (
            <>
              <SlotPicker data={slots.data!} value={slot} onChange={setSlot} />
              <Button
                size="lg"
                className="w-full"
                disabled={!slot}
                onClick={() => setStep("details")}
              >
                {slot ? `Continue with ${slotLabel(slot, context.timezone)}` : "Pick a time"}
              </Button>
              <WaitlistPrompt business={context.business.name} onJoin={() => setStep("waitlist")} />
            </>
          )}
        </section>
      )}

      {step === "details" && service && slot && (
        <Details
          slug={slug}
          context={context}
          service={service}
          slot={slot}
          source={source}
          onBack={() => setStep("time")}
          onTaken={() => {
            setSlot(null);
            void slots.refetch();
            setStep("time");
          }}
          onBooked={(result) => {
            setBooked(result);
            setStep("done");
          }}
        />
      )}

      {step === "done" && booked && (
        <section className="space-y-4 rounded-lg border bg-card p-5">
          <p className="flex items-center gap-2 text-[19px] font-bold text-primary">
            <IconCircleCheck className="size-6" /> You&apos;re booked
          </p>
          <p className="text-[17px] font-semibold">
            {booked.booking.service.name},{" "}
            {slotLabel(booked.booking.startsAt, booked.booking.timezone)}
          </p>
          <p className="text-[15px] text-muted-foreground">
            {booked.booking.business.name} has it on their schedule. If you asked for texts, a
            confirmation is on its way, with a reminder the day before.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              nativeButton={false}
              render={<a href={`/api/public/bookings/${tokenOf(booked.manageUrl)}/ics`} />}
            >
              <IconCalendarPlus /> Add to my calendar
            </Button>
            <Button variant="ghost" nativeButton={false} render={<a href={booked.manageUrl} />}>
              Change or cancel
            </Button>
          </div>
        </section>
      )}

      {step === "waitlist" && service && (
        <JoinWaitlist
          slug={slug}
          context={context}
          service={service}
          source={source}
          onBack={() => setStep("time")}
          onJoined={() => setStep("waitlisted")}
        />
      )}

      {step === "waitlisted" && (
        <section className="space-y-3 rounded-lg border bg-card p-5">
          <p className="flex items-center gap-2 text-[19px] font-bold text-primary">
            <IconHourglass className="size-6" /> You&apos;re on the waitlist
          </p>
          <p className="text-[15px] text-muted-foreground">
            If a time opens up on the days you picked, you&apos;ll get a message with a link to take
            it. The first person to say yes gets it.
          </p>
        </section>
      )}

      <section className="space-y-3 border-t pt-6">
        <p className="text-[15px] text-muted-foreground">Questions first?</p>
        <ContactButtons business={context.business} />
      </section>
    </Shell>
  );
}

const tokenOf = (manageUrl: string) => manageUrl.split("/b/manage/")[1] ?? "";

function Shell({
  context,
  children,
}: {
  context: PublicBookingContext;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-xl space-y-6 px-5 py-8 sm:py-12">
      <BusinessHeader business={context.business} />
      {children}
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ml-1 inline-flex min-h-11 items-center gap-1 text-[15px] font-medium text-muted-foreground hover:text-foreground"
    >
      <IconArrowLeft className="size-5" /> Back
    </button>
  );
}

function WaitlistPrompt({
  business,
  onJoin,
  empty = false,
}: {
  business: string;
  onJoin: () => void;
  empty?: boolean;
}) {
  return (
    <div className={cn("space-y-2 rounded-lg p-4", empty ? "border bg-card" : "bg-muted/60")}>
      <p className="text-[15px]">
        {empty ? `${business} is fully booked for the days shown.` : "None of these work?"} Join the
        waitlist and you&apos;ll hear if a time opens up.
      </p>
      <Button variant={empty ? "default" : "outline"} onClick={onJoin}>
        <IconHourglass /> Join the waitlist
      </Button>
    </div>
  );
}

function useContactFields() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  return {
    name,
    setName,
    phone,
    setPhone,
    email,
    setEmail,
    company,
    setCompany,
    valid: name.trim().length >= 2 && phone.replace(/\D/g, "").length >= 10,
  };
}

function ContactFields({
  fields,
  errors,
}: {
  fields: ReturnType<typeof useContactFields>;
  errors: Record<string, string[]>;
}) {
  return (
    <>
      <Field data-invalid={Boolean(errors.name)}>
        <FieldLabel htmlFor="book-name">Your name</FieldLabel>
        <Input
          id="book-name"
          autoComplete="name"
          value={fields.name}
          onChange={(event) => fields.setName(event.target.value)}
        />
        <FieldError errors={(errors.name ?? []).map((message) => ({ message }))} />
      </Field>
      <Field data-invalid={Boolean(errors.phone)}>
        <FieldLabel htmlFor="book-phone">Your mobile number</FieldLabel>
        <Input
          id="book-phone"
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          value={fields.phone}
          onChange={(event) => fields.setPhone(event.target.value)}
        />
        <FieldError errors={(errors.phone ?? []).map((message) => ({ message }))} />
      </Field>
      <Field data-invalid={Boolean(errors.email)}>
        <FieldLabel htmlFor="book-email">Email (optional)</FieldLabel>
        <Input
          id="book-email"
          type="email"
          autoComplete="email"
          value={fields.email}
          onChange={(event) => fields.setEmail(event.target.value)}
        />
        <FieldError errors={(errors.email ?? []).map((message) => ({ message }))} />
      </Field>
      {/* Only bots fill this in. */}
      <input
        type="text"
        name="company"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        className="absolute -left-[9999px] h-0 w-0 opacity-0"
        value={fields.company}
        onChange={(event) => fields.setCompany(event.target.value)}
      />
    </>
  );
}

function Details({
  slug,
  context,
  service,
  slot,
  source,
  onBack,
  onTaken,
  onBooked,
}: {
  slug: string;
  context: PublicBookingContext;
  service: Service;
  slot: string;
  source: RequestSource;
  onBack: () => void;
  onTaken: () => void;
  onBooked: (result: BookingCreated) => void;
}) {
  const fields = useContactFields();
  const [notes, setNotes] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);
  const [earlier, setEarlier] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const book = useMutation({
    mutationFn: () =>
      api<BookingCreated>(`/public/booking/${slug}`, {
        method: "POST",
        body: {
          serviceId: service.id,
          startsAt: slot,
          name: fields.name,
          phone: fields.phone,
          email: fields.email,
          company: fields.company,
          notes,
          smsConsent,
          earlier,
          source,
        },
      }),
    onSuccess: onBooked,
    onError: (error) => {
      if (isApiError(error) && error.code === "slot_taken") {
        toast.error(error.message);
        return onTaken();
      }
      if (isApiError(error) && error.fields) setErrors(error.fields);
      toast.error(isApiError(error) ? error.message : "That didn't go through. Please try again.");
    },
  });

  return (
    <section className="space-y-4">
      <BackButton onClick={onBack} />
      <div className="rounded-lg bg-primary-subtle p-4 text-primary-subtle-foreground">
        <p className="font-semibold">{service.name}</p>
        <p className="text-[15px]">
          {slotLabel(slot, context.timezone)}, {jobLength(service.durationMins)}
        </p>
      </div>
      <form
        className="relative space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          book.mutate();
        }}
      >
        <ContactFields fields={fields} errors={errors} />
        <Field>
          <FieldLabel htmlFor="book-notes">Anything they should know? (optional)</FieldLabel>
          <Textarea
            id="book-notes"
            rows={3}
            maxLength={500}
            placeholder="Gate code, parking, what's going on…"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </Field>
        <label className="flex cursor-pointer gap-3 rounded-lg border border-input bg-card p-3.5">
          <Checkbox
            className="mt-0.5"
            checked={smsConsent}
            onCheckedChange={(checked) => setSmsConsent(checked === true)}
          />
          <span className="text-[15px] leading-6">{BOOKING_CONSENT_TEXT}</span>
        </label>
        <label className="flex cursor-pointer gap-3 rounded-lg border border-input bg-card p-3.5">
          <Checkbox
            className="mt-0.5"
            checked={earlier}
            onCheckedChange={(checked) => setEarlier(checked === true)}
          />
          <span className="text-[15px] leading-6 text-muted-foreground">
            {waitlistConsentText(context.business.name)}
          </span>
        </label>
        <LegalNote>Neither box is needed to book.</LegalNote>
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={!fields.valid || book.isPending}
        >
          {book.isPending && <Spinner />} Book it
        </Button>
      </form>
    </section>
  );
}

function LegalNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm text-muted-foreground">
      {children} See our{" "}
      <a href="/privacy#texting" target="_blank" className="underline underline-offset-4">
        Privacy policy
      </a>{" "}
      and{" "}
      <a href="/terms#sms" target="_blank" className="underline underline-offset-4">
        SMS terms
      </a>
      .
    </p>
  );
}

function JoinWaitlist({
  slug,
  context,
  service,
  source,
  onBack,
  onJoined,
}: {
  slug: string;
  context: PublicBookingContext;
  service: Service;
  source: RequestSource;
  onBack: () => void;
  onJoined: () => void;
}) {
  const fields = useContactFields();
  const today = new Date().toLocaleDateString("en-CA", { timeZone: context.timezone });
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(() =>
    new Date(Date.now() + 7 * 86_400_000).toLocaleDateString("en-CA", {
      timeZone: context.timezone,
    }),
  );
  const [smsConsent, setSmsConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const join = useMutation({
    mutationFn: () =>
      api(`/public/booking/${slug}/waitlist`, {
        method: "POST",
        body: {
          serviceId: service.id,
          from,
          to,
          name: fields.name,
          phone: fields.phone,
          email: fields.email,
          company: fields.company,
          smsConsent,
          source,
        },
      }),
    onSuccess: onJoined,
    onError: (error) => {
      if (isApiError(error) && error.fields) setErrors(error.fields);
      toast.error(isApiError(error) ? error.message : "That didn't go through. Please try again.");
    },
  });

  return (
    <section className="space-y-4">
      <BackButton onClick={onBack} />
      <div>
        <h2 className="text-[19px] font-bold">Join the waitlist</h2>
        <p className="text-[15px] text-muted-foreground">
          For {service.name}. If a time opens up on these days, you&apos;ll get a link to take it.
        </p>
      </div>
      <form
        className="relative space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          join.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field data-invalid={Boolean(errors.from)}>
            <FieldLabel htmlFor="wait-from">From</FieldLabel>
            <Input
              id="wait-from"
              type="date"
              min={today}
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </Field>
          <Field data-invalid={Boolean(errors.to)}>
            <FieldLabel htmlFor="wait-to">Until</FieldLabel>
            <Input
              id="wait-to"
              type="date"
              min={from}
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
            <FieldError errors={(errors.to ?? []).map((message) => ({ message }))} />
          </Field>
        </div>
        <ContactFields fields={fields} errors={errors} />
        <label className="flex cursor-pointer gap-3 rounded-lg border border-input bg-card p-3.5">
          <Checkbox
            className="mt-0.5"
            checked={smsConsent}
            onCheckedChange={(checked) => setSmsConsent(checked === true)}
          />
          <span className="text-[15px] leading-6">
            {waitlistConsentText(context.business.name)}
          </span>
        </label>
        <LegalNote>
          Add your email, tick the box, or both, so you hear when a time opens up.
        </LegalNote>
        <Button
          type="submit"
          size="lg"
          className="w-full"
          disabled={!fields.valid || !from || !to || join.isPending}
        >
          {join.isPending && <Spinner />} Join the waitlist
        </Button>
      </form>
    </section>
  );
}
