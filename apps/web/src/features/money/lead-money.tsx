"use client";

import {
  type LeadDetail,
  PAYMENT_METHOD_LABELS,
  type PaymentItem,
  type PaymentKind,
  type PaymentSettings,
  type QuoteDetail,
  type QuoteSummary,
} from "@leadanchor/contracts";
import {
  IconAlertTriangle,
  IconCash,
  IconChevronRight,
  IconClockHour4,
  IconCopy,
  IconCreditCard,
  IconDots,
  IconFileDollar,
  IconLock,
  IconPlus,
  IconReceipt,
  IconSend,
  IconSparkles,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parseAsBoolean, useQueryState } from "nuqs";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { api, isApiError } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { amount, money, timeAgo, visitTime } from "@/lib/format";
import { keys, usePaymentSettings } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { unbilledCents } from "./money";
import { RecordPaymentSheet, RequestPaymentSheet } from "./payment-sheets";
import { QuoteStatusChip } from "./quote-status";

/**
 * The money side of a job (modules 6 and 7): its quote, what has been paid or held on a
 * card, and what is still to collect. Every way to get paid starts here.
 */
export function LeadMoney({ lead }: { lead: LeadDetail }) {
  const { data: settings } = usePaymentSettings();
  const [bill, setBill] = useQueryState("bill", parseAsBoolean);
  const [asking, setAsking] = useState<PaymentKind | null>(null);
  const [recording, setRecording] = useState<PaymentItem | "new" | null>(null);
  const requestKind = asking ?? (bill ? "payment" : null);

  const draft = lead.quotes.find((quote) => quote.status === "draft");
  const { balance } = lead;
  const hasMoney = lead.payments.length > 0;
  const showBalance = balance.jobValueCents != null || hasMoney;
  const jobDone = lead.stage === "won";
  const unbilled = unbilledCents(lead);

  return (
    <section className="space-y-3" aria-labelledby="money-heading">
      <h2 id="money-heading" className="text-[17px] font-bold">
        Quote and payment
      </h2>
      <div className="divide-y rounded-lg border bg-card">
        {lead.quotes.length === 0 ? (
          <EmptyQuote lead={lead} />
        ) : (
          <ul className="divide-y">
            {lead.quotes.map((quote) => (
              <QuoteRow key={quote.id} leadId={lead.id} quote={quote} />
            ))}
          </ul>
        )}

        {showBalance && <BalanceBar lead={lead} />}

        {hasMoney && (
          <ul className="divide-y">
            {lead.payments.map((payment) => (
              <PaymentRow
                key={payment.id}
                leadId={lead.id}
                payment={payment}
                settings={settings}
                onRecord={() => setRecording(payment)}
              />
            ))}
          </ul>
        )}

        <div className="flex flex-wrap gap-2 p-4">
          {jobDone && unbilled > 0 ? (
            <Button onClick={() => setAsking("payment")}>
              <IconSend /> Send the bill: {money(unbilled)}
            </Button>
          ) : (
            <Button variant="outline" onClick={() => setAsking("payment")}>
              <IconSend /> Ask for payment
            </Button>
          )}
          {!jobDone && (
            <Button variant="outline" onClick={() => setAsking("deposit")}>
              <IconLock /> Ask for a deposit
            </Button>
          )}
          <Button variant="ghost" onClick={() => setRecording("new")}>
            <IconCash /> Record a payment
          </Button>
          {lead.quotes.length > 0 && !draft && (
            <NewQuoteButton lead={lead} variant="ghost" label="New quote" />
          )}
        </div>
      </div>

      <RequestPaymentSheet
        key={`ask-${requestKind}-${lead.id}`}
        lead={lead}
        settings={settings}
        kind={requestKind}
        onClose={() => {
          setAsking(null);
          if (bill) void setBill(null);
        }}
      />
      <RecordPaymentSheet
        key={`record-${recording === "new" ? "new" : (recording?.id ?? "none")}`}
        lead={lead}
        request={recording === "new" ? null : recording}
        open={recording !== null}
        onClose={() => setRecording(null)}
      />
    </section>
  );
}

function EmptyQuote({ lead }: { lead: LeadDetail }) {
  const photos = lead.media.filter((item) => item.kind === "photo").length;
  return (
    <div className="flex items-start gap-3 p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary-subtle-foreground">
        <IconFileDollar className="size-5" />
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        <div>
          <p className="font-semibold">No quote yet</p>
          <p className="text-[15px] text-muted-foreground">
            {photos > 0
              ? `The AI drafts one from the ${photos === 1 ? "photo" : `${photos} photos`} and your price list in a few seconds.`
              : "The AI drafts one from the request and your price list in a few seconds."}{" "}
            Nothing goes to the customer until you check it and tap Send.
          </p>
        </div>
        <NewQuoteButton lead={lead} label="Draft quote" />
      </div>
    </div>
  );
}

function NewQuoteButton({
  lead,
  label,
  variant = "default",
}: {
  lead: LeadDetail;
  label: string;
  variant?: "default" | "ghost";
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const draft = useMutation({
    mutationFn: () => api<QuoteDetail>(`/leads/${lead.id}/quotes`, { method: "POST" }),
    onSuccess: (quote) => {
      queryClient.setQueryData(keys.quote(quote.id), quote);
      void queryClient.invalidateQueries({ queryKey: keys.lead(lead.id) });
      router.push(`/leads/${lead.id}/quotes/${quote.id}`);
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "Couldn't draft the quote."),
  });

  return (
    <Button variant={variant} onClick={() => draft.mutate()} disabled={draft.isPending}>
      {draft.isPending ? <Spinner /> : variant === "default" ? <IconSparkles /> : <IconPlus />}
      {draft.isPending ? "Drafting from the photos and your prices…" : label}
    </Button>
  );
}

function QuoteRow({ leadId, quote }: { leadId: string; quote: QuoteSummary }) {
  const when =
    quote.status === "draft"
      ? `Draft, last changed ${timeAgo(quote.updatedAt)}`
      : quote.acceptedAt
        ? `Accepted ${timeAgo(quote.acceptedAt)}`
        : quote.declinedAt
          ? `Declined ${timeAgo(quote.declinedAt)}`
          : quote.viewedAt
            ? `Sent ${timeAgo(quote.sentAt!)}, opened ${timeAgo(quote.viewedAt)}`
            : `Sent ${timeAgo(quote.sentAt!)}, not opened yet`;
  return (
    <li>
      <Link
        href={`/leads/${leadId}/quotes/${quote.id}`}
        className="flex min-h-16 items-center gap-3 p-4 transition-colors hover:bg-muted/60"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <IconFileDollar className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Quote {quote.number}</span>
            <QuoteStatusChip quote={quote} />
          </span>
          <span className="block truncate text-[15px] text-muted-foreground">{quote.title}</span>
          <span className="block text-sm text-muted-foreground">{when}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="tabular block font-semibold">{money(quote.totalCents)}</span>
          {quote.depositCents != null && (
            <span className="tabular block text-sm text-muted-foreground">
              {money(quote.depositCents)} deposit
            </span>
          )}
        </span>
        <IconChevronRight className="size-5 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}

/** What the job is worth, what's in, what's on a card and what's still to collect. */
function BalanceBar({ lead }: { lead: LeadDetail }) {
  const { jobValueCents, paidCents, heldCents, dueCents } = lead.balance;
  const total = Math.max(jobValueCents ?? 0, paidCents + heldCents, 1);
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {jobValueCents != null ? "Job price" : "No price set yet"}
        </p>
        {jobValueCents != null && (
          <p className="tabular font-display text-2xl font-semibold">{amount(jobValueCents)}</p>
        )}
      </div>
      <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <span className="bg-primary" style={{ width: `${(paidCents / total) * 100}%` }} />
        <span className="bg-info-strong" style={{ width: `${(heldCents / total) * 100}%` }} />
      </div>
      <dl className="grid grid-cols-3 gap-2 text-[15px]">
        <Figure label="Paid" value={amount(paidCents)} dot="bg-primary" />
        <Figure label="On hold" value={amount(heldCents)} dot="bg-info-strong" />
        <Figure
          label="Still to collect"
          value={dueCents == null ? "—" : amount(dueCents)}
          dot="bg-muted-foreground/40"
        />
      </dl>
    </div>
  );
}

function Figure({ label, value, dot }: { label: string; value: string; dot: string }) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <span className={cn("size-2 rounded-full", dot)} /> {label}
      </dt>
      <dd className="tabular font-semibold">{value}</dd>
    </div>
  );
}

const DAY_MS = 86_400_000;
const endsWithinADay = (iso: string | null) =>
  iso !== null && new Date(iso).getTime() - Date.now() < DAY_MS;

function PaymentRow({
  leadId,
  payment,
  settings,
  onRecord,
}: {
  leadId: string;
  payment: PaymentItem;
  settings: PaymentSettings | undefined;
  onRecord: () => void;
}) {
  const queryClient = useQueryClient();
  const act = useMutation({
    mutationFn: ({
      action,
      body,
    }: {
      action: "capture" | "release" | "cancel" | "resend";
      body?: Record<string, unknown>;
    }) => api<unknown>(`/payments/${payment.id}/${action}`, { method: "POST", body: body ?? {} }),
    onSuccess: (_data, { action }) => {
      toast.success(
        action === "capture"
          ? `Collected ${amount(payment.amountCents)}.`
          : action === "release"
            ? "Hold released. The card isn't charged."
            : action === "cancel"
              ? "Pay link closed."
              : "Pay link sent again.",
      );
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "That didn't work. Please try again."),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.lead(leadId) }),
  });
  const simulate = useMutation({
    mutationFn: async () => {
      await api(`/dev/simulator/payments/${payment.id}/age`, {
        method: "POST",
        body: { hoursLeft: 20 },
      });
      await api("/dev/simulator/payments/tick", { method: "POST" });
    },
    onSuccess: () => toast.success("Simulator: the hold now ends in 20 hours."),
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't move the hold."),
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.lead(leadId) }),
  });

  const label =
    payment.kind === "deposit"
      ? "Deposit"
      : payment.status === "paid" && payment.method && payment.method !== "card"
        ? PAYMENT_METHOD_LABELS[payment.method]
        : "Payment";
  const endsSoon = payment.status === "held" && endsWithinADay(payment.holdExpiresAt);
  const busy = act.isPending;

  return (
    <li className="space-y-3 p-4">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full",
            ICON_TONE[payment.status],
          )}
        >
          {payment.status === "held" ? (
            <IconLock className="size-5" />
          ) : payment.method === "card" ? (
            <IconCreditCard className="size-5" />
          ) : payment.status === "paid" ? (
            <IconReceipt className="size-5" />
          ) : (
            <IconSend className="size-5" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">
              {label} <span className="tabular">{amount(payment.amountCents)}</span>
            </span>
            <PaymentChip payment={payment} />
          </div>
          <p className="truncate text-[15px] text-muted-foreground">{payment.description}</p>
          <p className="text-sm text-muted-foreground">{paymentLine(payment)}</p>
        </div>
        {payment.status === "open" && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
              aria-label="More for this pay link"
            >
              <IconDots className="size-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                onClick={() => act.mutate({ action: "resend", body: { text: true } })}
              >
                <IconSend /> Text the link again
              </DropdownMenuItem>
              <DropdownMenuItem
                variant="destructive"
                onClick={() => act.mutate({ action: "cancel" })}
              >
                Close this pay link
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {payment.status === "open" && payment.reported && (
        <p className="flex items-start gap-2 rounded-md bg-signal-subtle p-3 text-[15px] text-signal-strong">
          <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
          The customer says they paid by {PAYMENT_METHOD_LABELS[payment.reported.method]}{" "}
          {timeAgo(payment.reported.at)}. Check it arrived, then mark it received.
        </p>
      )}
      {payment.status === "open" && payment.lastFailure && !payment.reported && (
        <p className="rounded-md bg-muted p-3 text-[15px] text-muted-foreground">
          Last try: {payment.lastFailure}
        </p>
      )}
      {endsSoon && (
        <p className="flex items-start gap-2 rounded-md bg-signal-subtle p-3 text-[15px] text-signal-strong">
          <IconClockHour4 className="mt-0.5 size-4 shrink-0" />
          This hold ends {visitTime(payment.holdExpiresAt!)}. Collect it before then, or the card is
          released.
        </p>
      )}

      {payment.status === "open" && (
        <div className="flex flex-wrap gap-2">
          {payment.url && (
            <Button
              variant="outline"
              onClick={async () =>
                (await copyText(payment.url!))
                  ? toast.success("Pay link copied.")
                  : toast.error("Couldn't copy. Select the link and copy it instead.")
              }
            >
              <IconCopy /> Copy pay link
            </Button>
          )}
          <Button variant={payment.reported ? "default" : "ghost"} onClick={onRecord}>
            <IconCash /> Mark received
          </Button>
        </div>
      )}
      {payment.status === "held" && (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => act.mutate({ action: "capture" })} disabled={busy}>
            {busy && act.variables?.action === "capture" ? <Spinner /> : <IconCreditCard />} Collect{" "}
            {amount(payment.amountCents)}
          </Button>
          <Button
            variant="outline"
            onClick={() => act.mutate({ action: "release" })}
            disabled={busy}
          >
            Release the hold
          </Button>
          {settings?.simulated && !endsSoon && (
            <Button variant="ghost" onClick={() => simulate.mutate()} disabled={simulate.isPending}>
              Simulator: end it tomorrow
            </Button>
          )}
        </div>
      )}
      {payment.status === "paid" && payment.url && (
        <a
          href={payment.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-primary"
        >
          <IconReceipt className="size-4" /> Customer&apos;s receipt
        </a>
      )}
    </li>
  );
}

const ICON_TONE: Record<PaymentItem["status"], string> = {
  open: "bg-signal-subtle text-signal-strong",
  held: "bg-info-subtle text-info-strong",
  paid: "bg-primary-subtle text-primary-subtle-foreground",
  released: "bg-muted text-muted-foreground",
  canceled: "bg-muted text-muted-foreground",
};

function PaymentChip({ payment }: { payment: PaymentItem }) {
  const [text, tone] =
    payment.status === "open"
      ? payment.reported
        ? (["Check it arrived", "bg-signal-subtle text-signal-strong"] as const)
        : (["Not paid yet", "bg-signal-subtle text-signal-strong"] as const)
      : payment.status === "held"
        ? (["On hold", "bg-info-subtle text-info-strong"] as const)
        : payment.status === "paid"
          ? (["Paid", "bg-primary-subtle text-primary-subtle-foreground"] as const)
          : payment.status === "released"
            ? (["Released", "bg-muted text-muted-foreground"] as const)
            : (["Closed", "bg-muted text-muted-foreground"] as const);
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2 text-[13px] font-semibold",
        tone,
      )}
    >
      {text}
    </span>
  );
}

function paymentLine(payment: PaymentItem) {
  switch (payment.status) {
    case "open":
      return `Link sent ${timeAgo(payment.createdAt)}${payment.viewedAt ? `, opened ${timeAgo(payment.viewedAt)}` : ", not opened yet"}${payment.capture === "hold" ? ". The card will be held, not charged" : ""}`;
    case "held":
      return `On ${payment.card ?? "their card"} until ${visitTime(payment.holdExpiresAt!)}. Not charged until you collect it.`;
    case "paid":
      return `Paid ${timeAgo(payment.paidAt!)}${payment.card ? ` with ${payment.card}` : payment.method ? ` by ${PAYMENT_METHOD_LABELS[payment.method]}` : ""}${payment.receiptSentAt ? ", receipt sent" : ""}`;
    case "released":
      return `Hold released ${timeAgo(payment.releasedAt!)}. The card wasn't charged.`;
    case "canceled":
      return `Link closed ${timeAgo(payment.canceledAt!)}`;
  }
}
