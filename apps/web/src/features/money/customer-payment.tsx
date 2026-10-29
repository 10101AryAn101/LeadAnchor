"use client";

import { PAYMENT_METHOD_LABELS, type PublicPayment, formatPhone } from "@leadanchor/contracts";
import {
  IconCheck,
  IconCircleCheck,
  IconCopy,
  IconCreditCard,
  IconExternalLink,
  IconLock,
  IconPrinter,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { format } from "date-fns";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api, isApiError } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { amount } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BusinessHeader, ContactButtons } from "./business-header";

const when = (iso: string) => format(new Date(iso), "MMMM d, yyyy 'at' h:mm a");

/**
 * The customer's pay page (C-15, C-26): pay by card on the provider's own page, or see how to
 * pay by Zelle or Venmo. Once paid it becomes the receipt.
 */
export function CustomerPayment({ token, initial }: { token: string; initial: PublicPayment }) {
  const [payment, setPayment] = useState(initial);
  const base = `/public/pay/${encodeURIComponent(token)}`;

  // Back from the checkout page: confirm with the payments provider straight away.
  const sync = useMutation({
    mutationFn: () => api<PublicPayment>(`${base}/sync`, { method: "POST" }),
    onSuccess: setPayment,
  });
  const synced = useRef(false);
  useEffect(() => {
    if (synced.current || !new URLSearchParams(window.location.search).has("checkout")) return;
    synced.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    sync.mutate();
  }, [sync]);

  const checkout = useMutation({
    mutationFn: () => api<{ url: string }>(`${base}/checkout`, { method: "POST" }),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "Card payment isn't available right now."),
  });
  const report = useMutation({
    mutationFn: (method: "zelle" | "venmo") =>
      api<PublicPayment>(`${base}/report`, { method: "POST", body: { method } }),
    onSuccess: (data) => {
      setPayment(data);
      toast.success(`Thanks! We've told ${data.business.name}.`);
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "That didn't go through. Please try again."),
  });

  const hold = payment.capture === "hold";
  const label = payment.kind === "deposit" ? "Deposit to book" : "Amount due";

  return (
    <div className="mx-auto max-w-md space-y-6 px-5 py-8 sm:py-12">
      <BusinessHeader business={payment.business} />

      {sync.isPending ? (
        <div className="flex items-center gap-3 rounded-lg border bg-card p-5 text-[15px]">
          <Spinner /> Confirming your payment…
        </div>
      ) : payment.status === "paid" ? (
        <Receipt payment={payment} />
      ) : (
        <section className="space-y-4 rounded-lg border bg-card p-5">
          <div>
            <p className="text-sm font-semibold tracking-wide text-primary uppercase">{label}</p>
            <p className="tabular font-display text-[40px] leading-tight font-semibold">
              {amount(payment.amountCents)}
            </p>
            <p className="text-[15px] text-muted-foreground">
              {payment.description}
              {payment.customerName ? `, for ${payment.customerName}` : ""}
            </p>
          </div>

          {payment.status === "held" && (
            <p className="flex items-start gap-2 rounded-md bg-info-subtle p-3 text-[15px] text-info-strong">
              <IconLock className="mt-0.5 size-4 shrink-0" />
              <span>
                Your {payment.card ?? "card"} has a hold for this deposit. You&apos;re only charged
                when the work goes ahead
                {payment.holdExpiresAt
                  ? `; if it isn't used, the hold ends ${when(payment.holdExpiresAt)}`
                  : ""}
                .
              </span>
            </p>
          )}
          {payment.status === "released" && (
            <p className="rounded-md bg-muted p-3 text-[15px] text-muted-foreground">
              This hold was released. Your card wasn&apos;t charged.
            </p>
          )}
          {payment.status === "canceled" && (
            <p className="rounded-md bg-muted p-3 text-[15px] text-muted-foreground">
              This pay link is closed. Contact {payment.business.name} if you still need to pay.
            </p>
          )}

          {payment.status === "open" && (
            <div className="space-y-4">
              {payment.reported ? (
                <p className="flex items-start gap-2 rounded-md bg-primary-subtle p-3 text-[15px] text-primary-subtle-foreground">
                  <IconCircleCheck className="mt-0.5 size-4 shrink-0" />
                  Thanks! We told {payment.business.name} you paid by{" "}
                  {PAYMENT_METHOD_LABELS[payment.reported.method]}. They&apos;ll confirm once it
                  arrives.
                </p>
              ) : null}
              {payment.lastFailure && (
                <p className="rounded-md bg-destructive-subtle p-3 text-[15px] text-destructive-strong">
                  Your last card try didn&apos;t go through: {payment.lastFailure}
                </p>
              )}

              {/* Once they've said they paid another way, don't invite a second payment. */}
              {payment.cardPayments && !payment.reported && (
                <div className="space-y-2">
                  <Button
                    size="lg"
                    className="h-13 w-full text-[17px]"
                    onClick={() => checkout.mutate()}
                    disabled={checkout.isPending}
                  >
                    {checkout.isPending ? <Spinner /> : <IconCreditCard />}{" "}
                    {hold
                      ? `Hold ${amount(payment.amountCents)} on my card`
                      : `Pay ${amount(payment.amountCents)} by card`}
                  </Button>
                  <p className="flex items-start justify-center gap-1.5 text-center text-sm text-muted-foreground">
                    <IconLock className="mt-0.5 size-4 shrink-0" />
                    {hold ? "Held, not charged, until the work goes ahead. " : ""}
                    {payment.simulated
                      ? "Test version: card payments are simulated and no real money moves."
                      : "You pay on Stripe's secure page; your card number never reaches us."}
                  </p>
                </div>
              )}

              {(payment.zelle || payment.venmo) && !payment.reported && (
                <div className="space-y-3 border-t pt-4">
                  <p className="font-semibold">
                    {payment.cardPayments ? "Or pay another way" : "How to pay"}
                  </p>
                  {payment.zelle && (
                    <OtherWay
                      name="Zelle"
                      value={
                        payment.zelle.startsWith("+") ? formatPhone(payment.zelle) : payment.zelle
                      }
                      help={`In your bank's app, send ${amount(payment.amountCents)} with Zelle to:`}
                      done={() => report.mutate("zelle")}
                      busy={report.isPending}
                    />
                  )}
                  {payment.venmo && (
                    <OtherWay
                      name="Venmo"
                      value={`@${payment.venmo}`}
                      help={`Send ${amount(payment.amountCents)} on Venmo to:`}
                      link={`https://venmo.com/u/${encodeURIComponent(payment.venmo)}`}
                      done={() => report.mutate("venmo")}
                      busy={report.isPending}
                    />
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      <section className="space-y-3 border-t pt-6">
        <p className="text-[15px] text-muted-foreground">Questions about this payment?</p>
        <ContactButtons business={payment.business} />
      </section>
    </div>
  );
}

function OtherWay({
  name,
  value,
  help,
  link,
  done,
  busy,
}: {
  name: string;
  value: string;
  help: string;
  link?: string;
  done: () => void;
  busy: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-2 rounded-lg border p-3">
      <p className="text-[15px] text-muted-foreground">{help}</p>
      <div className="flex items-center gap-2 rounded-md bg-muted px-3">
        <span className="min-w-0 flex-1 truncate py-2.5 font-semibold">{value}</span>
        <button
          type="button"
          className="flex size-11 items-center justify-center text-muted-foreground hover:text-foreground"
          aria-label={`Copy the ${name} details`}
          onClick={async () => {
            if (!(await copyText(value))) return;
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? <IconCheck className="size-5 text-primary" /> : <IconCopy className="size-5" />}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {link && (
          <Button
            variant="outline"
            nativeButton={false}
            render={<a href={link} target="_blank" rel="noreferrer" />}
          >
            <IconExternalLink /> Open {name}
          </Button>
        )}
        <Button variant="ghost" onClick={done} disabled={busy}>
          I&apos;ve sent it by {name}
        </Button>
      </div>
    </div>
  );
}

function Receipt({ payment }: { payment: PublicPayment }) {
  const how = payment.card ?? (payment.method ? PAYMENT_METHOD_LABELS[payment.method] : null);
  return (
    <section className="space-y-4 rounded-lg border bg-card p-5 print:border-0">
      <p className="flex items-center gap-2 text-[17px] font-bold text-primary">
        <IconCircleCheck className="size-6" /> Paid. Thank you!
      </p>
      <dl className="divide-y text-[15px]">
        <Row
          label="Amount"
          value={
            <span className="tabular font-display text-2xl font-semibold">
              {amount(payment.amountCents)}
            </span>
          }
        />
        <Row label="For" value={payment.description} />
        {payment.paidAt && <Row label="Paid" value={when(payment.paidAt)} />}
        {how && <Row label="Paid with" value={how} />}
        <Row label="Receipt" value={<span className="tabular">{payment.receiptNumber}</span>} />
        <Row label="Paid to" value={payment.business.name} />
      </dl>
      <Button variant="outline" className="print:hidden" onClick={() => window.print()}>
        <IconPrinter /> Print or save
      </Button>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4 py-2.5")}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
