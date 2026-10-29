"use client";

import {
  MAX_QUOTE_LINES,
  type PaymentCapture,
  type QuoteDetail,
  type QuoteLineInput,
  type QuoteLineOrigin,
  type QuoteSendResult,
  type ServiceItem,
  formatPhone,
} from "@leadanchor/contracts";
import {
  IconAlertTriangle,
  IconArrowBackUp,
  IconCheck,
  IconChevronLeft,
  IconCopy,
  IconDots,
  IconFileTypePdf,
  IconListDetails,
  IconMinus,
  IconPlus,
  IconSend,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
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
import { Textarea } from "@/components/ui/textarea";
import { SendResult } from "@/features/money/payment-sheets";
import { QuoteStatusChip, quoteState } from "@/features/money/quote-status";
import { api, isApiError } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { amount, fullDate, money, timeAgo } from "@/lib/format";
import { keys, useQuote, useServices } from "@/lib/queries";
import { cn } from "@/lib/utils";

interface EditableLine {
  key: string;
  id?: string;
  serviceId: string | null;
  description: string;
  quantity: number;
  /** Dollars as typed. */
  price: string;
  flagged: boolean;
  flagReason: string | null;
  origin: QuoteLineOrigin;
}

interface Draft {
  title: string;
  notes: string;
  lines: EditableLine[];
  deposit: boolean;
  depositAmount: string;
  depositCapture: PaymentCapture;
}

const centsToText = (cents: number | null) =>
  cents == null ? "" : String(cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2));
const priceCents = (text: string) => {
  const value = Number(text);
  return text.trim() === "" || !Number.isFinite(value) || value < 0
    ? null
    : Math.round(value * 100);
};

function toDraft(quote: QuoteDetail): Draft {
  return {
    title: quote.title,
    notes: quote.notes ?? "",
    lines: quote.lines.map((line) => ({
      key: line.id,
      id: line.id,
      serviceId: line.serviceId,
      description: line.description,
      quantity: line.quantity,
      price: centsToText(line.unitPriceCents),
      flagged: line.flagged,
      flagReason: line.flagReason,
      origin: line.origin,
    })),
    deposit: quote.depositCents != null,
    depositAmount: centsToText(quote.depositCents),
    depositCapture: quote.cardPayments ? quote.depositCapture : "charge",
  };
}

function toInput(draft: Draft) {
  const lines: QuoteLineInput[] = draft.lines.map((line) => {
    const cents = priceCents(line.price);
    return {
      ...(line.id && { id: line.id }),
      serviceId: line.serviceId,
      description: line.description.trim() || "Work",
      quantity: line.quantity,
      unitPriceDollars: cents == null ? null : cents / 100,
      flagged: line.flagged,
      flagReason: line.flagReason,
      origin: line.origin,
    };
  });
  const deposit = priceCents(draft.depositAmount);
  return {
    title: draft.title.trim(),
    notes: draft.notes.trim() || null,
    lines,
    depositDollars: draft.deposit && deposit != null && deposit >= 100 ? deposit / 100 : null,
    depositCapture: draft.depositCapture,
  };
}

/** C-45: the owner checks the AI's draft, adjusts it and sends it. Nothing goes out without the Send tap. */
export function QuoteEditorView() {
  const { id: leadId, quoteId } = useParams<{ id: string; quoteId: string }>();
  const { data: quote, isPending, error } = useQuote(quoteId);
  // Kept here, not in the editor: sending turns the draft into a sent quote, which swaps the view.
  const [sent, setSent] = useState<QuoteSendResult | null>(null);

  if (isPending) return <EditorSkeleton />;
  if (error || !quote) {
    return (
      <Empty className="py-20">
        <EmptyHeader>
          <EmptyTitle>We couldn&apos;t find that quote</EmptyTitle>
          <EmptyDescription>It may have been deleted. Head back to the job.</EmptyDescription>
        </EmptyHeader>
        <Button nativeButton={false} render={<Link href={`/leads/${leadId}`} />}>
          Back to the job
        </Button>
      </Empty>
    );
  }
  return (
    <>
      {quote.status === "draft" ? (
        <DraftEditor
          key={`${quote.id}:${quote.revision}`}
          quote={quote}
          leadId={leadId}
          onSent={setSent}
        />
      ) : (
        <SentQuote quote={quote} leadId={leadId} onSent={setSent} />
      )}
      <ResponsiveSheet
        open={sent !== null}
        onOpenChange={(open) => !open && setSent(null)}
        title={`Quote ${sent?.quote.number ?? ""} sent`}
        footer={
          <Button size="lg" className="w-full" onClick={() => setSent(null)}>
            Done
          </Button>
        }
      >
        {sent && <SendResult url={sent.quote.url} messages={sent.messages} />}
      </ResponsiveSheet>
    </>
  );
}

function Header({
  quote,
  leadId,
  actions,
}: {
  quote: QuoteDetail;
  leadId: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="space-y-3">
      <Link
        href={`/leads/${leadId}`}
        className="-ml-1 inline-flex min-h-11 items-center gap-1 text-[15px] font-medium text-muted-foreground hover:text-foreground"
      >
        <IconChevronLeft className="size-5" /> {quote.customer.name ?? "Back to the job"}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-[28px] leading-[34px] font-semibold">
              Quote {quote.number}
            </h1>
            <QuoteStatusChip quote={quote} />
          </div>
          <p className="text-[15px] text-muted-foreground">
            For {quote.customer.name ?? "your customer"}
            {quote.customer.phone ? `, ${formatPhone(quote.customer.phone)}` : ""}
          </p>
        </div>
        {actions}
      </div>
    </header>
  );
}

function DraftNote({
  quote,
  onRedraft,
  busy,
}: {
  quote: QuoteDetail;
  /** Offered when the draft came without the AI and has no unsaved changes. */
  onRedraft?: () => void;
  busy: boolean;
}) {
  const { draft } = quote;
  if (draft.source === "ai") {
    const secs = draft.ms != null ? `${(draft.ms / 1000).toFixed(1)} s` : null;
    return (
      <p className="flex items-start gap-2 rounded-lg bg-info-subtle p-3 text-[15px] text-info-strong">
        <IconSparkles className="mt-0.5 size-4 shrink-0" />
        <span>
          Drafted by AI{secs ? ` in ${secs}` : ""} from{" "}
          {draft.photos > 0
            ? `${draft.photos === 1 ? "the photo" : `${draft.photos} photos`}, `
            : ""}
          the request and your price list. Every price comes from your list. Check the lines marked
          for you, then send.
        </span>
      </p>
    );
  }
  if (!draft.note && !onRedraft) return null;
  return (
    <div className="space-y-3 rounded-lg bg-muted p-3 text-[15px] text-muted-foreground">
      {draft.note && (
        <p className="flex items-start gap-2">
          <IconListDetails className="mt-0.5 size-4 shrink-0" />
          {draft.note}
        </p>
      )}
      {onRedraft && (
        <Button variant="outline" className="bg-background" onClick={onRedraft} disabled={busy}>
          {busy ? <Spinner /> : <IconSparkles />} {busy ? "Drafting…" : "Try the AI again"}
        </Button>
      )}
    </div>
  );
}

let keySeed = 0;
const newKey = () => `new-${Date.now()}-${keySeed++}`;

function DraftEditor({
  quote,
  leadId,
  onSent,
}: {
  quote: QuoteDetail;
  leadId: string;
  onSent: (result: QuoteSendResult) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: services } = useServices();
  const [draft, setDraft] = useState<Draft>(() => toDraft(quote));
  const [saved, setSaved] = useState(() => JSON.stringify(toInput(toDraft(quote))));
  const [picking, setPicking] = useState(false);
  const [sending, setSending] = useState(false);
  const dirty = JSON.stringify(toInput(draft)) !== saved;

  // Changes from elsewhere (another device) are picked up unless the owner is mid-edit.
  const [shown, setShown] = useState(quote);
  if (quote !== shown) {
    setShown(quote);
    if (!dirty) {
      setDraft(toDraft(quote));
      setSaved(JSON.stringify(toInput(toDraft(quote))));
    }
  }

  // Leaving with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const save = useMutation({
    mutationFn: () =>
      api<QuoteDetail>(`/quotes/${quote.id}`, { method: "PATCH", body: toInput(draft) }),
    onSuccess: (data) => {
      queryClient.setQueryData(keys.quote(data.id), data);
      void queryClient.invalidateQueries({ queryKey: keys.lead(leadId) });
      setDraft(toDraft(data));
      setSaved(JSON.stringify(toInput(toDraft(data))));
    },
    onError: (error) =>
      toast.error(
        isApiError(error)
          ? (Object.values(error.fields ?? {})[0]?.[0] ?? error.message)
          : "Couldn't save the quote.",
      ),
  });

  const redraft = useMutation({
    mutationFn: () => api<QuoteDetail>(`/quotes/${quote.id}/redraft`, { method: "POST" }),
    onSuccess: (data) => {
      queryClient.setQueryData(keys.quote(data.id), data);
      void queryClient.invalidateQueries({ queryKey: keys.lead(leadId) });
      setDraft(toDraft(data));
      setSaved(JSON.stringify(toInput(toDraft(data))));
      if (data.draft.source === "ai")
        toast.success("Drafted by AI. Check the lines marked for you.");
      else toast(data.draft.note ?? "The AI couldn't help this time.");
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "Couldn't redraft the quote."),
  });

  const discard = useMutation({
    mutationFn: () => api(`/quotes/${quote.id}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.lead(leadId) });
      toast.success("Draft deleted.");
      router.replace(`/leads/${leadId}`);
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "Couldn't delete the draft."),
  });

  const update = (key: string, change: Partial<EditableLine>) =>
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => (line.key === key ? { ...line, ...change } : line)),
    }));

  const setPrice = (line: EditableLine, price: string) => {
    const cents = priceCents(price);
    // Lines the owner wrote or took from their list are checked once they have a price; the AI's need a "Looks right".
    if (line.origin !== "ai")
      update(line.key, {
        price,
        flagged: cents == null,
        flagReason: cents == null ? "Needs a price." : null,
      });
    else
      update(line.key, {
        price,
        ...(cents == null && { flagged: true, flagReason: line.flagReason ?? "Needs a price." }),
      });
  };

  const addService = (service: ServiceItem) => {
    setDraft((current) => ({
      ...current,
      lines: [
        ...current.lines,
        {
          key: newKey(),
          serviceId: service.id,
          description: service.name,
          quantity: 1,
          price: centsToText(service.priceCents),
          flagged: service.priceCents == null,
          flagReason:
            service.priceCents == null ? `“${service.name}” has no price on your list yet.` : null,
          origin: "price_list",
        },
      ],
    }));
    setPicking(false);
  };

  const addCustom = () =>
    setDraft((current) => ({
      ...current,
      lines: [
        ...current.lines,
        {
          key: newKey(),
          serviceId: null,
          description: "",
          quantity: 1,
          price: "",
          flagged: true,
          flagReason: "Needs a price.",
          origin: "custom",
        },
      ],
    }));

  const totals = useMemo(() => {
    const total = draft.lines.reduce(
      (sum, line) => sum + (priceCents(line.price) ?? 0) * line.quantity,
      0,
    );
    return { total, flagged: draft.lines.filter((line) => line.flagged).length };
  }, [draft.lines]);
  const depositCents = draft.deposit ? priceCents(draft.depositAmount) : null;
  const depositProblem =
    draft.deposit &&
    (depositCents == null || depositCents < 100
      ? "Enter the deposit."
      : depositCents > totals.total
        ? "The deposit is more than the total."
        : null);
  const sendBlocker =
    draft.lines.length === 0
      ? "Add at least one line."
      : totals.flagged > 0
        ? `Check the ${totals.flagged === 1 ? "line" : `${totals.flagged} lines`} marked for you first.`
        : totals.total <= 0
          ? "Add a price first."
          : draft.title.trim().length < 2
            ? "Give the quote a title."
            : depositProblem;

  const previewPdf = async () => {
    const url = `/api/quotes/${quote.id}/pdf`;
    if (!dirty) return void window.open(url, "_blank", "noopener");
    // Open the tab now (browsers block it after a wait), then point it at the saved PDF.
    const tab = window.open("", "_blank");
    try {
      await save.mutateAsync();
      if (tab) tab.location.href = url;
    } catch {
      tab?.close();
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-36 lg:pb-8">
      <Header
        quote={quote}
        leadId={leadId}
        actions={
          !quote.sentAt && (
            <DropdownMenu>
              <DropdownMenuTrigger
                className="flex size-11 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
                aria-label="More for this quote"
              >
                <IconDots className="size-5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem variant="destructive" onClick={() => discard.mutate()}>
                  <IconTrash /> Delete draft
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )
        }
      />

      <DraftNote
        quote={quote}
        onRedraft={quote.draft.source !== "ai" && !dirty ? () => redraft.mutate() : undefined}
        busy={redraft.isPending}
      />

      <Field>
        <FieldLabel htmlFor="quote-title">What the quote is for</FieldLabel>
        <Input
          id="quote-title"
          value={draft.title}
          maxLength={120}
          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
        />
      </Field>

      <section className="space-y-3" aria-label="Lines">
        <h2 className="text-[17px] font-bold">Lines</h2>
        {draft.lines.length === 0 && (
          <p className="rounded-lg border border-dashed px-4 py-8 text-center text-[15px] text-muted-foreground">
            No lines yet. Add from your price list or write your own.
          </p>
        )}
        <ul className="space-y-3">
          {draft.lines.map((line) => (
            <LineEditor
              key={line.key}
              line={line}
              service={services?.find((service) => service.id === line.serviceId) ?? null}
              onChange={(change) => update(line.key, change)}
              onPrice={(price) => setPrice(line, price)}
              onRemove={() =>
                setDraft({ ...draft, lines: draft.lines.filter((item) => item.key !== line.key) })
              }
            />
          ))}
        </ul>
        {draft.lines.length < MAX_QUOTE_LINES && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setPicking(true)}>
              <IconListDetails /> Add from price list
            </Button>
            <Button variant="ghost" onClick={addCustom}>
              <IconPlus /> Add your own line
            </Button>
          </div>
        )}
      </section>

      <section className="space-y-4 rounded-lg border bg-card p-4">
        <Field orientation="horizontal" className="items-start justify-between gap-4">
          <div className="space-y-1">
            <FieldLabel htmlFor="quote-deposit-on">Ask for a deposit to book</FieldLabel>
            <p className="text-sm text-muted-foreground">
              They pay it when they accept, so the booking is locked in.
            </p>
          </div>
          <Switch
            id="quote-deposit-on"
            checked={draft.deposit}
            onCheckedChange={(checked) =>
              setDraft({
                ...draft,
                deposit: checked,
                depositAmount:
                  draft.depositAmount ||
                  centsToText(Math.round((totals.total * 0.2) / 100) * 100 || null),
              })
            }
          />
        </Field>
        {draft.deposit && (
          <div className="space-y-3">
            <Field data-invalid={Boolean(depositProblem)}>
              <FieldLabel htmlFor="quote-deposit">Deposit</FieldLabel>
              <InputGroup className="max-w-48">
                <InputGroupAddon>
                  <InputGroupText>$</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput
                  id="quote-deposit"
                  type="number"
                  inputMode="decimal"
                  min={1}
                  step="0.01"
                  value={draft.depositAmount}
                  onChange={(event) => setDraft({ ...draft, depositAmount: event.target.value })}
                />
              </InputGroup>
              {depositProblem && <p className="text-sm text-destructive">{depositProblem}</p>}
            </Field>
            {quote.cardPayments ? (
              <div
                className="grid gap-2 sm:grid-cols-2"
                role="radiogroup"
                aria-label="How the deposit is taken"
              >
                <CaptureChoice
                  selected={draft.depositCapture === "hold"}
                  onSelect={() => setDraft({ ...draft, depositCapture: "hold" })}
                  title="Hold it on their card"
                  body="Charged only when you collect it. Holds last 7 days."
                />
                <CaptureChoice
                  selected={draft.depositCapture === "charge"}
                  onSelect={() => setDraft({ ...draft, depositCapture: "charge" })}
                  title="Charge it straight away"
                  body="Better when the visit is more than a week out."
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Card payments are off, so customers pay the deposit by Zelle or Venmo.{" "}
                <Link href="/settings#payments" className="font-semibold text-primary">
                  Turn on card payments
                </Link>
              </p>
            )}
          </div>
        )}
      </section>

      <Field>
        <FieldLabel htmlFor="quote-notes">Note to the customer (optional)</FieldLabel>
        <Textarea
          id="quote-notes"
          rows={3}
          maxLength={1000}
          placeholder="What's included, what it assumes, when you can start…"
          value={draft.notes}
          onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
        />
      </Field>

      <section className="rounded-lg border bg-card p-4">
        <dl className="space-y-2 text-[15px]">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="font-semibold">Total</dt>
            <dd className="tabular font-display text-2xl font-semibold">{amount(totals.total)}</dd>
          </div>
          {depositCents != null && draft.deposit && (
            <div className="flex items-baseline justify-between gap-3 text-muted-foreground">
              <dt>Deposit to book</dt>
              <dd className="tabular">{amount(depositCents)}</dd>
            </div>
          )}
        </dl>
      </section>

      <div className="pb-safe fixed inset-x-0 bottom-14 z-30 border-t bg-background px-4 pt-3 lg:static lg:border-0 lg:bg-transparent lg:p-0">
        <div className="mx-auto max-w-3xl space-y-2">
          {sendBlocker && (
            <p className="text-center text-sm text-signal-strong lg:text-left">{sendBlocker}</p>
          )}
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="lg"
              className="flex-1 lg:flex-none"
              onClick={() => void previewPdf()}
            >
              <IconFileTypePdf /> PDF
            </Button>
            <Button
              variant="outline"
              size="lg"
              className="flex-1 lg:flex-none"
              disabled={!dirty || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending && <Spinner />} {dirty ? "Save" : "Saved"}
            </Button>
            <Button
              size="lg"
              className="flex-[2] lg:flex-none"
              disabled={Boolean(sendBlocker) || save.isPending}
              onClick={() => setSending(true)}
            >
              <IconSend /> Send<span className="hidden sm:inline"> to customer</span>
            </Button>
          </div>
        </div>
      </div>

      <ServicePicker
        services={services ?? []}
        open={picking}
        onClose={() => setPicking(false)}
        onPick={addService}
      />
      <SendSheet
        quote={quote}
        open={sending}
        beforeSend={async () => {
          if (dirty) await save.mutateAsync();
        }}
        onClose={() => setSending(false)}
        onSent={onSent}
      />
    </div>
  );
}

function LineEditor({
  line,
  service,
  onChange,
  onPrice,
  onRemove,
}: {
  line: EditableLine;
  service: ServiceItem | null;
  onChange: (change: Partial<EditableLine>) => void;
  onPrice: (price: string) => void;
  onRemove: () => void;
}) {
  const cents = priceCents(line.price);
  return (
    <li className={cn("space-y-3 rounded-lg border bg-card p-4", line.flagged && "border-signal")}>
      {line.flagged && (
        <div className="flex flex-wrap items-start gap-2 rounded-md bg-signal-subtle p-3 text-[15px] text-signal-strong">
          <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1">{line.flagReason ?? "Check this line."}</span>
          {cents != null && (
            <Button
              size="sm"
              variant="outline"
              className="bg-background"
              onClick={() => onChange({ flagged: false, flagReason: null })}
            >
              <IconCheck /> Looks right
            </Button>
          )}
        </div>
      )}
      <Field>
        <FieldLabel htmlFor={`line-${line.key}`} className="sr-only">
          Description
        </FieldLabel>
        <Input
          id={`line-${line.key}`}
          value={line.description}
          maxLength={200}
          placeholder="What the customer pays for"
          onChange={(event) => onChange({ description: event.target.value })}
        />
      </Field>
      {service && (
        <p className="text-sm text-muted-foreground">
          From your price list: {service.name},{" "}
          {service.priceCents != null ? money(service.priceCents) : "no price yet"}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <span className="text-sm text-muted-foreground">Qty</span>
          <div className="flex items-center rounded-md border">
            <button
              type="button"
              className="flex size-11 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
              aria-label="One fewer"
              disabled={line.quantity <= 1}
              onClick={() => onChange({ quantity: Math.max(1, line.quantity - 1) })}
            >
              <IconMinus className="size-4" />
            </button>
            <span className="tabular w-8 text-center font-semibold">{line.quantity}</span>
            <button
              type="button"
              className="flex size-11 items-center justify-center text-muted-foreground hover:text-foreground disabled:opacity-40"
              aria-label="One more"
              disabled={line.quantity >= 999}
              onClick={() => onChange({ quantity: Math.min(999, line.quantity + 1) })}
            >
              <IconPlus className="size-4" />
            </button>
          </div>
        </div>
        <div className="w-36 space-y-1">
          <label htmlFor={`price-${line.key}`} className="text-sm text-muted-foreground">
            Price each
          </label>
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText>$</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              id={`price-${line.key}`}
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              placeholder="Price"
              value={line.price}
              onChange={(event) => onPrice(event.target.value)}
            />
          </InputGroup>
        </div>
        <div className="ml-auto flex items-center gap-1">
          <span className="tabular min-w-16 text-right font-semibold">
            {cents == null ? "—" : amount(cents * line.quantity)}
          </span>
          <Button variant="ghost" size="icon" aria-label="Remove this line" onClick={onRemove}>
            <IconTrash />
          </Button>
        </div>
      </div>
    </li>
  );
}

function CaptureChoice({
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
        "flex items-start gap-3 rounded-lg border p-3 text-left transition-colors",
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

function ServicePicker({
  services,
  open,
  onClose,
  onPick,
}: {
  services: ServiceItem[];
  open: boolean;
  onClose: () => void;
  onPick: (service: ServiceItem) => void;
}) {
  const active = services.filter((service) => service.active);
  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Add from your price list"
    >
      {active.length === 0 ? (
        <p className="pb-4 text-[15px] text-muted-foreground">
          Your price list is empty. Add services and prices in{" "}
          <Link href="/settings" className="font-semibold text-primary">
            Settings
          </Link>
          .
        </p>
      ) : (
        <ul className="-mx-1 flex flex-col gap-1 pb-2">
          {active.map((service) => (
            <li key={service.id}>
              <button
                type="button"
                onClick={() => onPick(service)}
                className="flex min-h-12 w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-muted"
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{service.name}</span>
                  {service.description && (
                    <span className="block truncate text-sm text-muted-foreground">
                      {service.description}
                    </span>
                  )}
                </span>
                <span className="tabular shrink-0 text-[15px] font-semibold">
                  {service.priceCents != null ? money(service.priceCents) : "No price"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </ResponsiveSheet>
  );
}

/** The owner's approval (C-45): how the quote goes out, then the Send tap. */
function SendSheet({
  quote,
  open,
  beforeSend,
  onClose,
  onSent,
}: {
  quote: QuoteDetail;
  open: boolean;
  beforeSend?: () => Promise<void>;
  onClose: () => void;
  onSent: (result: QuoteSendResult) => void;
}) {
  const queryClient = useQueryClient();
  const [text, setText] = useState(Boolean(quote.customer.phone));
  const [email, setEmail] = useState(quote.customer.email ?? "");

  const send = useMutation({
    mutationFn: async () => {
      await beforeSend?.();
      return api<QuoteSendResult>(`/quotes/${quote.id}/send`, {
        method: "POST",
        body: { text, email: email.trim() || null },
      });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(keys.quote(data.quote.id), data.quote);
      void queryClient.invalidateQueries({ queryKey: keys.lead(data.quote.leadId) });
      onClose();
      onSent(data);
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't send the quote."),
  });

  const first = quote.customer.name?.split(" ")[0] ?? "the customer";
  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title={quote.status === "draft" ? `Send the quote to ${first}` : "Send the quote again"}
      description={`${amount(quote.totalCents)}${quote.depositCents != null ? `, with a ${amount(quote.depositCents)} deposit to book` : ""}. They get a link to see it, download the PDF and accept it.`}
      footer={
        <Button
          size="lg"
          className="w-full"
          disabled={send.isPending}
          onClick={() => send.mutate()}
        >
          {send.isPending ? <Spinner /> : <IconSend />}{" "}
          {text || email.trim() ? "Send quote" : "Create the link only"}
        </Button>
      }
    >
      <div className="space-y-3 pb-2">
        {quote.customer.phone && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-[15px]">
            <Checkbox checked={text} onCheckedChange={(checked) => setText(checked === true)} />
            Text it to {formatPhone(quote.customer.phone)}
          </label>
        )}
        <Field>
          <FieldLabel htmlFor="send-email">Email it too (optional)</FieldLabel>
          <Input
            id="send-email"
            type="email"
            autoComplete="off"
            placeholder="name@example.com"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <p className="text-sm text-muted-foreground">
          Sending moves the job to Quoted and makes this total the job&apos;s price.
        </p>
      </div>
    </ResponsiveSheet>
  );
}

/** A quote that has gone out: what the customer sees, and where it stands. */
function SentQuote({
  quote,
  leadId,
  onSent,
}: {
  quote: QuoteDetail;
  leadId: string;
  onSent: (result: QuoteSendResult) => void;
}) {
  const queryClient = useQueryClient();
  const [resending, setResending] = useState(false);
  const state = quoteState(quote);
  const reopen = useMutation({
    mutationFn: () => api<QuoteDetail>(`/quotes/${quote.id}/reopen`, { method: "POST" }),
    onSuccess: (data) => {
      queryClient.setQueryData(keys.quote(data.id), data);
      void queryClient.invalidateQueries({ queryKey: keys.lead(leadId) });
      toast.success(
        "Back to a draft. The customer's link shows it's being updated until you send it again.",
      );
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "Couldn't reopen the quote."),
  });

  const banner =
    state === "accepted"
      ? {
          tone: "bg-primary-subtle text-primary-subtle-foreground",
          text: `Accepted ${timeAgo(quote.acceptedAt!)}. ${quote.depositCents != null ? "The deposit is on the job page." : "Book the visit."}`,
        }
      : state === "declined"
        ? {
            tone: "bg-destructive-subtle text-destructive-strong",
            text: `Declined ${timeAgo(quote.declinedAt!)}.${quote.declineReason ? ` “${quote.declineReason}”` : ""}`,
          }
        : state === "expired"
          ? {
              tone: "bg-muted text-muted-foreground",
              text: `Expired on ${fullDate(quote.validUntil!)}. Change it and send it again if they're still interested.`,
            }
          : {
              tone: "bg-info-subtle text-info-strong",
              text: `Sent ${timeAgo(quote.sentAt!)}. ${quote.viewedAt ? `They opened it ${timeAgo(quote.viewedAt)}.` : "Not opened yet."} Valid until ${fullDate(quote.validUntil!)}.`,
            };

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-24 lg:pb-8">
      <Header quote={quote} leadId={leadId} />
      <p className={cn("rounded-lg p-3 text-[15px]", banner.tone)}>{banner.text}</p>

      <div className="flex flex-wrap gap-2">
        {quote.url && (
          <Button
            variant="outline"
            onClick={async () =>
              (await copyText(quote.url!))
                ? toast.success("Customer link copied.")
                : toast.error("Couldn't copy the link.")
            }
          >
            <IconCopy /> Copy customer link
          </Button>
        )}
        <Button
          variant="outline"
          nativeButton={false}
          render={<a href={`/api/quotes/${quote.id}/pdf`} target="_blank" rel="noreferrer" />}
        >
          <IconFileTypePdf /> PDF
        </Button>
        {quote.status === "sent" && state !== "expired" && (
          <Button variant="outline" onClick={() => setResending(true)}>
            <IconSend /> Send again
          </Button>
        )}
        {quote.status !== "accepted" && (
          <Button variant="ghost" onClick={() => reopen.mutate()} disabled={reopen.isPending}>
            {reopen.isPending ? <Spinner /> : <IconArrowBackUp />} Change it
          </Button>
        )}
      </div>

      <section className="rounded-lg border bg-card">
        <h2 className="border-b px-4 py-3 text-[17px] font-bold">{quote.title}</h2>
        <ul className="divide-y">
          {quote.lines.map((line) => (
            <li key={line.id} className="flex items-start justify-between gap-3 px-4 py-3">
              <span className="min-w-0">
                <span className="block font-medium">{line.description}</span>
                <span className="tabular block text-sm text-muted-foreground">
                  {line.quantity} ×{" "}
                  {line.unitPriceCents != null ? amount(line.unitPriceCents) : "—"}
                </span>
              </span>
              <span className="tabular shrink-0 font-semibold">
                {line.unitPriceCents != null ? amount(line.unitPriceCents * line.quantity) : "—"}
              </span>
            </li>
          ))}
        </ul>
        <dl className="space-y-1 border-t px-4 py-3 text-[15px]">
          <div className="flex items-baseline justify-between">
            <dt className="font-semibold">Total</dt>
            <dd className="tabular font-display text-2xl font-semibold">
              {amount(quote.totalCents)}
            </dd>
          </div>
          {quote.depositCents != null && (
            <div className="flex items-baseline justify-between text-muted-foreground">
              <dt>
                Deposit to book
                {quote.depositCapture === "hold" && quote.cardPayments
                  ? " (held on their card)"
                  : ""}
              </dt>
              <dd className="tabular">{amount(quote.depositCents)}</dd>
            </div>
          )}
        </dl>
        {quote.notes && (
          <p className="border-t px-4 py-3 text-[15px] whitespace-pre-wrap text-muted-foreground">
            {quote.notes}
          </p>
        )}
      </section>

      <SendSheet
        quote={quote}
        open={resending}
        onClose={() => setResending(false)}
        onSent={onSent}
      />
    </div>
  );
}

function EditorSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 pt-12">
      <Skeleton className="h-9 w-56" />
      <Skeleton className="h-16 rounded-lg" />
      <Skeleton className="h-11 rounded-md" />
      <Skeleton className="h-40 rounded-lg" />
      <Skeleton className="h-40 rounded-lg" />
    </div>
  );
}
