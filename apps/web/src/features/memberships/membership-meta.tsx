import {
  MEMBERSHIP_STATUS_LABELS,
  type MembershipItem,
  type MembershipStatus,
} from "@leadanchor/contracts";
import { cn } from "@/lib/utils";

const TONE: Record<MembershipStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  active: "bg-primary-subtle text-primary-subtle-foreground",
  past_due: "bg-signal-subtle text-signal-strong",
  paused: "bg-info-subtle text-info-strong",
  canceled: "bg-muted text-muted-foreground",
};

/** Status as a word and a colour: amber only when money is owed. */
export function MemberStatus({
  status,
  className,
}: {
  status: MembershipStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full px-2 text-[13px] font-medium",
        TONE[status],
        className,
      )}
    >
      {MEMBERSHIP_STATUS_LABELS[status]}
    </span>
  );
}

/** "Nov 30", with the year when it isn't this year. */
export function shortDate(iso: string) {
  const date = new Date(iso);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== new Date().getFullYear() && { year: "numeric" }),
  });
}

/** What the owner needs to know about a member, in one line next to the status badge. */
export function memberLine(item: MembershipItem) {
  if (item.issue)
    return item.issue.kind === "retrying" && item.issue.nextAttemptAt
      ? `Card declined · Stripe retries ${shortDate(item.issue.nextAttemptAt)}`
      : "Retries ran out · waiting on a new card";
  switch (item.status) {
    case "active":
      return item.nextBillAt ? `Next bill ${shortDate(item.nextBillAt)}` : "Active";
    case "paused":
      return item.pausedAt ? `Since ${shortDate(item.pausedAt)}` : "Paused";
    case "canceled": {
      const ended = item.endsAt ?? item.canceledAt;
      if (item.endsAt && Date.parse(item.endsAt) > Date.now())
        return `Keeps it until ${shortDate(item.endsAt)}`;
      return ended ? `Ended ${shortDate(ended)}` : "Ended";
    }
    default:
      return MEMBERSHIP_STATUS_LABELS[item.status];
  }
}

export const per = (interval: "month" | "year") => (interval === "month" ? "/mo" : "/yr");
