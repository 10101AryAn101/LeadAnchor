"use client";

import type { PublicFeedbackContext, PublicUnsubscribe } from "@leadanchor/contracts";
import { IconCircleCheck, IconLock, IconMailOff } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { BusinessHeader, ContactButtons } from "@/features/money/business-header";
import { api, isApiError } from "@/lib/api";

/**
 * C-46: the private line from the review request. The message goes straight to the owner as a
 * priority alert and a note on the job. It sits beside the review link; it never replaces it.
 */
export function PrivateFeedback({
  token,
  initial,
}: {
  token: string;
  initial: PublicFeedbackContext;
}) {
  const [message, setMessage] = useState("");
  const [company, setCompany] = useState("");
  const [sent, setSent] = useState(false);
  const send = useMutation({
    mutationFn: () =>
      api(`/public/feedback/${encodeURIComponent(token)}`, {
        method: "POST",
        body: { message, company },
      }),
    onSuccess: () => {
      setSent(true);
      setMessage("");
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "That didn't go through. Please try again."),
  });
  const business = initial.business.name;

  return (
    <div className="mx-auto max-w-xl space-y-6 px-5 py-8 sm:py-12">
      <BusinessHeader business={initial.business} />
      {sent ? (
        <section className="space-y-3 rounded-lg border bg-card p-5">
          <p className="flex items-center gap-2 text-[17px] font-semibold text-primary">
            <IconCircleCheck className="size-6" /> Sent to {business}
          </p>
          <p className="text-[15px] text-muted-foreground">
            They have your message and will be in touch. Thank you for telling them.
          </p>
          <Button variant="ghost" onClick={() => setSent(false)}>
            Add something else
          </Button>
        </section>
      ) : (
        <form
          className="relative space-y-4 rounded-lg border bg-card p-5"
          onSubmit={(event) => {
            event.preventDefault();
            send.mutate();
          }}
        >
          <div className="space-y-1">
            <h1 className="text-[19px] font-bold">
              {initial.firstName ? `${initial.firstName}, tell` : "Tell"} {business} directly
            </h1>
            <p className="flex items-center gap-1.5 text-[15px] text-muted-foreground">
              <IconLock className="size-4" /> Private: this goes only to {business}.
            </p>
          </div>
          {initial.sent && (
            <p className="text-sm text-muted-foreground">
              You&apos;ve written before; this adds to it.
            </p>
          )}
          <label htmlFor="feedback" className="sr-only">
            Your message
          </label>
          <Textarea
            id="feedback"
            rows={5}
            maxLength={2000}
            placeholder="What happened, and how can they put it right?"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
          {/* Only bots fill this in. */}
          <input
            type="text"
            name="company"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            className="absolute -left-[9999px] h-0 w-0 opacity-0"
          />
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={message.trim().length < 2 || send.isPending}
          >
            {send.isPending && <Spinner />} Send to {business}
          </Button>
        </form>
      )}
      <section className="space-y-3 border-t pt-6">
        <p className="text-[15px] text-muted-foreground">Rather talk?</p>
        <ContactButtons business={initial.business} />
      </section>
    </div>
  );
}

/** One click, no login (CAN-SPAM). Job emails such as booking confirmations and bills still come. */
export function Unsubscribe({ token, initial }: { token: string; initial: PublicUnsubscribe }) {
  const [state, setState] = useState(initial);
  const stop = useMutation({
    mutationFn: () =>
      api<PublicUnsubscribe>(`/public/unsubscribe/${encodeURIComponent(token)}`, {
        method: "POST",
      }),
    onSuccess: setState,
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "That didn't go through. Please try again."),
  });
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 py-10">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {state.unsubscribed ? (
          <IconCircleCheck className="size-6 text-primary" />
        ) : (
          <IconMailOff className="size-6" />
        )}
      </span>
      {state.unsubscribed ? (
        <>
          <h1 className="font-display text-2xl font-semibold">You&apos;re unsubscribed</h1>
          <p className="text-[15px] text-muted-foreground">
            {state.email} won&apos;t get review requests or offers from {state.businessName} again.
            Emails about your own bookings, quotes and bills still come.
          </p>
        </>
      ) : (
        <>
          <h1 className="font-display text-2xl font-semibold">
            Stop these emails from {state.businessName}?
          </h1>
          <p className="text-[15px] text-muted-foreground">
            {state.email} won&apos;t get review requests or offers from them. Emails about your own
            bookings, quotes and bills still come.
          </p>
          <Button size="lg" disabled={stop.isPending} onClick={() => stop.mutate()}>
            {stop.isPending && <Spinner />} Unsubscribe
          </Button>
        </>
      )}
    </div>
  );
}
