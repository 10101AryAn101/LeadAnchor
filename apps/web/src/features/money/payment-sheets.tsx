"use client";

import {
  type LeadDetail,
  MANUAL_PAYMENT_METHODS,
  type ManualPaymentMethod,
  type MessageItem,
  PAYMENT_METHOD_LABELS,
  type PaymentCapture,
  type PaymentItem,
  type PaymentKind,
  type PaymentRequestResult,
  type PaymentSettings,
  formatPhone,
} from "@leadanchor/contracts";
import { IconCheck, IconCopy, IconLink, IconSettings } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { api, isApiError } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { amount } from "@/lib/format";
import { keys } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { unbilledCents } from "./money";

/** "card, Zelle or Venmo". */
const listOf = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;

const dollarsText = (cents: number | null | undefined) =>
  cents == null || cents <= 0
    ? ""
    : String(cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2));
const validAmount = (text: string) => {
  const value = Number(text);
  return text.trim() !== "" && Number.isFinite(value) && value >= 1 && value <= 50_000;
};

/**
 * C-15 / C-26: ask for a deposit or a payment. The customer gets a pay link by text (and email
 * if given); they pay by card on the provider's page, or by Zelle or Venmo.
 */
export function RequestPaymentSheet({
  lead,
  settings,
  kind,
  onClose,
}: {
  lead: LeadDetail;
  settings: PaymentSettings | undefined;
  kind: PaymentKind | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const quoteDeposit =
    lead.quotes.find((quote) => quote.depositCents != null)?.depositCents ?? null;
  const cards = settings?.cardPayments ?? false;
  const canPay = cards || Boolean(settings?.zelle || settings?.venmo);
  const held = lead.balance.heldCents;

  const [value, setValue] = useState(
    dollarsText(kind === "deposit" ? quoteDeposit : unbilledCents(lead)),
  );
  // The quote says what the work is; a missed call's card title only says what happened.
  const quoted = lead.quotes.find(
    (quote) => quote.status === "accepted" || quote.status === "sent",
  );
  const [description, setDescription] = useState(quoted?.title ?? lead.title);
  const [capture, setCapture] = useState<PaymentCapture>(cards ? "hold" : "charge");
  const [collectHeld, setCollectHeld] = useState(kind === "payment" && held > 0);
  const [text, setText] = useState(Boolean(lead.customer.phone));
  const [email, setEmail] = useState("");
  const [result, setResult] = useState<PaymentRequestResult | null>(null);

  const send = useMutation({
    mutationFn: () =>
      api<PaymentRequestResult>(`/leads/${lead.id}/payments`, {
        method: "POST",
        body: {
          kind,
          amountDollars: Number(value),
          description: description.trim(),
          capture: kind === "deposit" ? capture : "charge",
          collectHeld: kind === "payment" && collectHeld,
          send: { text, email: email.trim() || null },
        },
      }),
    onSuccess: (data) => {
      setResult(data);
      void queryClient.invalidateQueries({ queryKey: keys.lead(lead.id) });
      if (data.messages.some((message) => message.status !== "blocked"))
        toast.success("Pay link sent.");
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "Couldn't create the pay link."),
  });

  const valid = validAmount(value) && description.trim().length >= 2;
  const title = kind === "deposit" ? "Ask for a deposit" : "Ask for payment";

  return (
    <ResponsiveSheet
      open={kind !== null}
      onOpenChange={(open) => !open && onClose()}
      title={result ? "Pay link ready" : title}
      description={
        result
          ? undefined
          : kind === "deposit"
            ? "A deposit locks in the booking and cuts no-shows."
            : "Send the bill while you're still in the driveway."
      }
      footer={
        result ? (
          <Button size="lg" className="w-full" onClick={onClose}>
            Done
          </Button>
        ) : canPay ? (
          <Button
            size="lg"
            className="w-full"
            disabled={!valid || send.isPending}
            onClick={() => send.mutate()}
          >
            {send.isPending && <Spinner />}{" "}
            {text || email.trim() ? "Send pay link" : "Create pay link"}
          </Button>
        ) : undefined
      }
    >
      {result ? (
        <SendResult url={result.payment.url} messages={result.messages} />
      ) : !canPay ? (
        <div className="space-y-3 pb-2">
          <p className="text-[15px] text-muted-foreground">
            First choose how customers pay you: turn on card payments, or add your Zelle or Venmo.
            It takes a minute.
          </p>
          <Button
            variant="outline"
            nativeButton={false}
            render={<Link href="/settings#payments" />}
          >
            <IconSettings /> Open Getting paid
          </Button>
        </div>
      ) : (
        <div className="space-y-4 pb-2">
          <Field>
            <FieldLabel htmlFor="pay-amount">
              {kind === "deposit" ? "Deposit" : "Amount"}
            </FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <InputGroupText>$</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput
                id="pay-amount"
                type="number"
                inputMode="decimal"
                min={1}
                step="0.01"
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </InputGroup>
            {kind === "payment" && lead.balance.dueCents != null && (
              <FieldDescription>
                Still to collect on this job: {amount(lead.balance.dueCents)}
                {held > 0 ? `, plus ${amount(held)} on hold` : ""}.
              </FieldDescription>
            )}
          </Field>
          <Field>
            <FieldLabel htmlFor="pay-for">What it&apos;s for</FieldLabel>
            <Input
              id="pay-for"
              value={description}
              maxLength={120}
              onChange={(event) => setDescription(event.target.value)}
            />
          </Field>

          {kind === "deposit" && cards && (
            <div className="space-y-2" role="radiogroup" aria-label="How the deposit is taken">
              <Choice
                selected={capture === "hold"}
                onSelect={() => setCapture("hold")}
                title="Hold it on their card"
                body="Nothing is charged until you collect it. Holds last 7 days; you're reminded the day before."
              />
              <Choice
                selected={capture === "charge"}
                onSelect={() => setCapture("charge")}
                title="Charge it straight away"
                body="Better for visits more than a week away."
              />
            </div>
          )}

          {kind === "payment" && held > 0 && (
            <label className="flex min-h-11 cursor-pointer items-start gap-2.5 text-[15px]">
              <Checkbox
                className="mt-0.5"
                checked={collectHeld}
                onCheckedChange={(checked) => setCollectHeld(checked === true)}
              />
              <span>
                Collect the {amount(held)} on hold first
                <span className="block text-sm text-muted-foreground">
                  So the customer only pays the rest with this link.
                </span>
              </span>
            </label>
          )}

          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-semibold text-muted-foreground">
              How it goes to {lead.customer.name?.split(" ")[0] ?? "the customer"}
            </p>
            {lead.customer.phone && (
              <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[15px]">
                <Checkbox checked={text} onCheckedChange={(checked) => setText(checked === true)} />
                Text it to {formatPhone(lead.customer.phone)}
              </label>
            )}
            <Field>
              <FieldLabel htmlFor="pay-email">Email it too (optional)</FieldLabel>
              <Input
                id="pay-email"
                type="email"
                autoComplete="off"
                placeholder="name@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
            <p className="text-sm text-muted-foreground">
              They can pay by{" "}
              {listOf(
                [
                  cards ? "card" : null,
                  settings?.zelle ? "Zelle" : null,
                  settings?.venmo ? "Venmo" : null,
                ].filter((way): way is string => way !== null),
              )}
              {settings?.simulated && cards
                ? " (card payments are simulated: no real money moves)"
                : ""}
              .
            </p>
          </div>
        </div>
      )}
    </ResponsiveSheet>
  );
}

function Choice({
  selected,
  onSelect,
  title,
  body,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  body: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors",
        selected ? "border-primary bg-primary-subtle" : "hover:bg-muted",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-input",
        )}
      >
        {selected && <IconCheck className="size-3.5" stroke={3} />}
      </span>
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted-foreground">{body}</span>
      </span>
    </button>
  );
}

/** What happened to each message, and the link to share by hand if a text couldn't go. */
export function SendResult({ url, messages }: { url: string | null; messages: MessageItem[] }) {
  const [copied, setCopied] = useState(false);
  const blocked = messages.filter((message) => message.status === "blocked");
  const went = messages.filter((message) => message.status !== "blocked");
  return (
    <div className="space-y-3 pb-2">
      {went.map((message) => (
        <p key={message.id} className="flex items-center gap-2 text-[15px]">
          <IconCheck className="size-4 text-primary" />{" "}
          {message.channel === "email" ? "Emailed" : "Texted"} to the customer.
        </p>
      ))}
      {blocked.map((message) => (
        <p
          key={message.id}
          className="rounded-md bg-signal-subtle p-3 text-[15px] text-signal-strong"
        >
          Not {message.channel === "email" ? "emailed" : "texted"}: {message.blockedReason} Share
          the link yourself instead.
        </p>
      ))}
      {messages.length === 0 && (
        <p className="text-[15px] text-muted-foreground">
          Nothing was sent. Share the link yourself.
        </p>
      )}
      {url && (
        <div className="flex items-center gap-2 rounded-md border bg-muted px-3">
          <IconLink className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate py-2.5 text-sm">{url}</span>
          <button
            type="button"
            className="flex size-11 items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label="Copy link"
            onClick={async () => {
              if (!(await copyText(url))) return;
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? (
              <IconCheck className="size-5 text-primary" />
            ) : (
              <IconCopy className="size-5" />
            )}
          </button>
        </div>
      )}
    </div>
  );
}

/** Zelle, Venmo, cash or a check: nothing reports these back, so the owner marks them received. */
export function RecordPaymentSheet({
  lead,
  request,
  open,
  onClose,
}: {
  lead: LeadDetail;
  request: PaymentItem | null;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(
    dollarsText(request ? request.amountCents : lead.balance.dueCents),
  );
  const [method, setMethod] = useState<ManualPaymentMethod>(request?.reported?.method ?? "zelle");
  const [note, setNote] = useState("");

  const record = useMutation({
    mutationFn: () =>
      api<PaymentItem>(`/leads/${lead.id}/payments/record`, {
        method: "POST",
        body: {
          amountDollars: Number(value),
          method,
          note: note.trim() || null,
          ...(request && { requestId: request.id }),
        },
      }),
    onSuccess: (payment) => {
      void queryClient.invalidateQueries({ queryKey: keys.lead(lead.id) });
      toast.success(
        `${amount(payment.amountCents)} by ${PAYMENT_METHOD_LABELS[method]} marked received.`,
      );
      onClose();
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "Couldn't save the payment."),
  });

  const numeric = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(numeric) && numeric > 0 && numeric <= 50_000;

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={request ? "Mark it received" : "Record a payment"}
      description="For money that came in another way. The customer gets a receipt."
      footer={
        <Button
          size="lg"
          className="w-full"
          disabled={!valid || record.isPending}
          onClick={() => record.mutate()}
        >
          {record.isPending && <Spinner />} Save payment
        </Button>
      }
    >
      <div className="space-y-4 pb-2">
        <Field>
          <FieldLabel htmlFor="record-amount">Amount received</FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText>$</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              id="record-amount"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          </InputGroup>
        </Field>
        <div className="space-y-2">
          <p className="text-sm font-semibold">How they paid</p>
          <div className="flex flex-wrap gap-2">
            {MANUAL_PAYMENT_METHODS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setMethod(option)}
                aria-pressed={method === option}
                className={cn(
                  "min-h-11 rounded-full border border-input px-4 text-[15px] transition-colors",
                  method === option
                    ? "border-primary bg-primary-subtle font-semibold text-primary-subtle-foreground"
                    : "hover:bg-muted",
                )}
              >
                {PAYMENT_METHOD_LABELS[option]}
              </button>
            ))}
          </div>
        </div>
        <Field>
          <FieldLabel htmlFor="record-note">Note (optional)</FieldLabel>
          <Input
            id="record-note"
            maxLength={200}
            placeholder="Check number, who paid…"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
      </div>
    </ResponsiveSheet>
  );
}
