import type { QuoteSummary } from "@leadanchor/contracts";
import { cn } from "@/lib/utils";

/** Where a quote stands, in a word: Draft, Sent, Opened, Accepted, Declined or Expired. */
export function quoteState(quote: Pick<QuoteSummary, "status" | "viewedAt" | "validUntil">) {
  if (
    quote.status === "sent" &&
    quote.validUntil &&
    new Date(quote.validUntil).getTime() < Date.now()
  )
    return "expired" as const;
  if (quote.status === "sent" && quote.viewedAt) return "opened" as const;
  return quote.status;
}

const STATE: Record<ReturnType<typeof quoteState>, [string, string]> = {
  draft: ["Draft", "bg-muted text-muted-foreground"],
  sent: ["Sent", "bg-info-subtle text-info-strong"],
  opened: ["Opened", "bg-info-subtle text-info-strong"],
  accepted: ["Accepted", "bg-primary-subtle text-primary-subtle-foreground"],
  declined: ["Declined", "bg-destructive-subtle text-destructive-strong"],
  expired: ["Expired", "bg-muted text-muted-foreground"],
};

export function QuoteStatusChip({
  quote,
  className,
}: {
  quote: Pick<QuoteSummary, "status" | "viewedAt" | "validUntil" | "flaggedCount">;
  className?: string;
}) {
  const [label, tone] = STATE[quoteState(quote)];
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        className={cn(
          "inline-flex h-6 items-center rounded-full px-2 text-[13px] font-semibold",
          tone,
        )}
      >
        {label}
      </span>
      {quote.status === "draft" && quote.flaggedCount > 0 && (
        <span className="inline-flex h-6 items-center rounded-full bg-signal-subtle px-2 text-[13px] font-semibold text-signal-strong">
          {quote.flaggedCount} to check
        </span>
      )}
    </span>
  );
}
