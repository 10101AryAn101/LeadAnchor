"use client";

import type { PublicQuote, QuoteAcceptResult } from "@leadanchor/contracts";
import {
  IconCircleCheck,
  IconClockHour4,
  IconDownload,
  IconLock,
  IconPencil,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api, isApiError } from "@/lib/api";
import { amount } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BusinessHeader, ContactButtons } from "./business-header";

const day = (iso: string) => format(new Date(iso), "MMMM d, yyyy");

/** C-45: the quote as the customer sees it, with Accept (and the deposit) or Decline. */
export function CustomerQuote({ token, initial }: { token: string; initial: PublicQuote }) {
  const [quote, setQuote] = useState(initial);
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");
  const base = `/public/quotes/${encodeURIComponent(token)}`;

  const accept = useMutation({
    mutationFn: () => api<QuoteAcceptResult>(`${base}/accept`, { method: "POST" }),
    onSuccess: (result) => {
      // With a deposit, the customer goes straight on to the card checkout.
      if (result.checkoutUrl) return window.location.assign(result.checkoutUrl);
      setQuote(result.quote);
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "That didn't go through. Please try again."),
  });
  const decline = useMutation({
    mutationFn: () =>
      api<PublicQuote>(`${base}/decline`, { method: "POST", body: { reason: reason.trim() } }),
    onSuccess: (result) => {
      setQuote(result);
      setDeclining(false);
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "That didn't go through. Please try again."),
  });

  const deposit = quote.depositCents;
  const hold = quote.depositCapture === "hold" && quote.cardPayments;

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-5 py-8 sm:py-12">
      <BusinessHeader business={quote.business} />

      <StateBanner quote={quote} />

      {quote.state !== "updating" && (
        <article className="rounded-lg border bg-card">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b p-4">
            <div>
              <p className="text-sm font-semibold tracking-wide text-primary uppercase">
                Quote {quote.number}
              </p>
              <h2 className="text-[19px] font-bold">{quote.title}</h2>
              {quote.customerName && (
                <p className="text-[15px] text-muted-foreground">For {quote.customerName}</p>
              )}
            </div>
            <p className="text-right text-sm text-muted-foreground">
              {day(quote.issuedAt)}
              <br />
              Valid until {day(quote.validUntil)}
            </p>
          </div>
          <ul className="divide-y">
            {quote.lines.map((line, index) => (
              <li key={index} className="flex items-start justify-between gap-3 px-4 py-3">
                <span className="min-w-0">
                  <span className="block font-medium">{line.description}</span>
                  {line.quantity > 1 && (
                    <span className="tabular block text-sm text-muted-foreground">
                      {line.quantity} × {amount(line.unitPriceCents)}
                    </span>
                  )}
                </span>
                <span className="tabular shrink-0 font-semibold">{amount(line.totalCents)}</span>
              </li>
            ))}
          </ul>
          <dl className="space-y-1 border-t p-4">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="font-semibold">Total</dt>
              <dd className="tabular font-display text-3xl font-semibold">
                {amount(quote.totalCents)}
              </dd>
            </div>
            {deposit != null && (
              <div className="flex items-baseline justify-between gap-3 text-[15px] text-muted-foreground">
                <dt>Deposit to book</dt>
                <dd className="tabular">{amount(deposit)}</dd>
              </div>
            )}
          </dl>
          {quote.notes && (
            <p className="border-t p-4 text-[15px] whitespace-pre-wrap">{quote.notes}</p>
          )}
        </article>
      )}

      {quote.state === "open" && !declining && (
        <div className="space-y-3">
          <Button
            size="lg"
            className="h-13 w-full text-[17px]"
            onClick={() => accept.mutate()}
            disabled={accept.isPending}
          >
            {accept.isPending ? <Spinner /> : <IconCircleCheck />}
            {deposit != null
              ? `Accept and ${hold ? "hold" : "pay"} the ${amount(deposit)} deposit`
              : "Accept this quote"}
          </Button>
          {deposit != null && (
            <p className="flex items-start justify-center gap-1.5 text-center text-sm text-muted-foreground">
              <IconLock className="mt-0.5 size-4 shrink-0" />
              {quote.cardPayments
                ? hold
                  ? "Your card is held, not charged, until the work goes ahead. Card details go to our payment provider, never to us."
                  : "You pay on our payment provider's secure page. We never see your card number."
                : `${quote.business.name} will tell you how to pay the deposit.`}
            </p>
          )}
          <div className="flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              nativeButton={false}
              render={<a href={quote.pdfUrl} target="_blank" rel="noreferrer" />}
            >
              <IconDownload /> Download PDF
            </Button>
            <Button variant="ghost" onClick={() => setDeclining(true)}>
              Not right for you?
            </Button>
          </div>
        </div>
      )}

      {quote.state === "open" && declining && (
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <label htmlFor="decline-reason" className="font-semibold">
            Tell {quote.business.name} why (optional)
          </label>
          <Textarea
            id="decline-reason"
            rows={3}
            maxLength={300}
            placeholder="Price, timing, found someone else…"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              onClick={() => decline.mutate()}
              disabled={decline.isPending}
            >
              {decline.isPending && <Spinner />} Decline the quote
            </Button>
            <Button variant="ghost" onClick={() => setDeclining(false)}>
              Back
            </Button>
          </div>
        </div>
      )}

      {quote.state !== "open" && quote.state !== "updating" && (
        <Button
          variant="outline"
          nativeButton={false}
          render={<a href={quote.pdfUrl} target="_blank" rel="noreferrer" />}
        >
          <IconDownload /> Download PDF
        </Button>
      )}

      <section className="space-y-3 border-t pt-6">
        <p className="text-[15px] text-muted-foreground">Questions about this quote?</p>
        <ContactButtons business={quote.business} />
      </section>
    </div>
  );
}

function StateBanner({ quote }: { quote: PublicQuote }) {
  const banner = (() => {
    switch (quote.state) {
      case "accepted": {
        const deposit = quote.deposit;
        return {
          icon: IconCircleCheck,
          tone: "bg-primary-subtle text-primary-subtle-foreground",
          text: `You accepted this quote on ${day(quote.acceptedAt!)}.${
            !deposit
              ? ` ${quote.business.name} will be in touch to book your visit.`
              : deposit.status === "held"
                ? " Your deposit is on hold on your card."
                : deposit.status === "paid"
                  ? " Your deposit is paid. Thank you!"
                  : ""
          }`,
          action:
            deposit && deposit.status === "open"
              ? { href: deposit.url, label: `Pay the ${amount(quote.depositCents ?? 0)} deposit` }
              : null,
        };
      }
      case "declined":
        return {
          icon: IconCircleCheck,
          tone: "bg-muted text-muted-foreground",
          text: `You declined this quote. Changed your mind? Call or text ${quote.business.name}.`,
          action: null,
        };
      case "expired":
        return {
          icon: IconClockHour4,
          tone: "bg-muted text-muted-foreground",
          text: `This quote expired on ${day(quote.validUntil)}. Call or text ${quote.business.name} for a new one.`,
          action: null,
        };
      case "updating":
        return {
          icon: IconPencil,
          tone: "bg-info-subtle text-info-strong",
          text: `${quote.business.name} is updating this quote. You'll get the new version shortly.`,
          action: null,
        };
      default:
        return null;
    }
  })();
  if (!banner) return null;
  return (
    <div className={cn("space-y-3 rounded-lg p-4 text-[15px]", banner.tone)}>
      <p className="flex items-start gap-2">
        <banner.icon className="mt-0.5 size-5 shrink-0" />
        {banner.text}
      </p>
      {banner.action && (
        <Button nativeButton={false} render={<a href={banner.action.href} />}>
          {banner.action.label}
        </Button>
      )}
    </div>
  );
}
