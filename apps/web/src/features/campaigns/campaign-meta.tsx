import type { CampaignKind, CampaignSummary, CampaignTriggerKind } from "@leadanchor/contracts";
import {
  type Icon,
  IconCalendarStar,
  IconHeartHandshake,
  IconRosette,
  IconSnowflake,
  IconSunHigh,
} from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export const TRIGGER_ICON: Record<CampaignTriggerKind, Icon> = {
  freeze: IconSnowflake,
  heat: IconSunHigh,
  holiday: IconCalendarStar,
};

/** The three ways to start a campaign (C-28 win-back, C-29 promotion, seasonal). */
export const STARTERS: Array<{ kind: CampaignKind; icon: Icon; title: string; body: string }> = [
  {
    kind: "winback",
    icon: IconHeartHandshake,
    title: "Win back quiet customers",
    body: "A friendly hello to people you haven't worked for in a while.",
  },
  {
    kind: "promotion",
    icon: IconRosette,
    title: "Promote an offer",
    body: "A special price or a service you want to fill your calendar with.",
  },
  {
    kind: "seasonal",
    icon: IconCalendarStar,
    title: "Seasonal check-up",
    body: "A timely reminder as the season turns.",
  },
];

/** "Fri, Nov 6 at 9:00 AM" in the business's own time zone. */
export function zonedWhen(iso: string, timeZone: string) {
  const at = new Date(iso);
  const day = at.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  });
  const time = at.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
  return `${day} at ${time}`;
}

/** Status as a word and a colour: drafts neutral, scheduled informational, sent good. */
export function StatusChip({
  campaign,
  timeZone,
  className,
}: {
  campaign: CampaignSummary;
  timeZone?: string;
  className?: string;
}) {
  const [label, tone] =
    campaign.status === "suggested"
      ? ["Suggested", "bg-signal-subtle text-signal-strong"]
      : campaign.status === "draft"
        ? ["Draft", "bg-muted text-muted-foreground"]
        : campaign.status === "scheduled"
          ? [
              campaign.scheduledFor
                ? `Sends ${zonedWhen(campaign.scheduledFor, timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)}`
                : "Scheduled",
              "bg-info-subtle text-info-strong",
            ]
          : campaign.status === "sending"
            ? ["Sending", "bg-info-subtle text-info-strong"]
            : ["Sent", "bg-primary-subtle text-primary-subtle-foreground"];
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full px-2 text-[13px] font-medium",
        tone,
        className,
      )}
    >
      {label}
    </span>
  );
}

/** "7 sent · 2 tapped · 1 booked" */
export function statsLine(campaign: CampaignSummary) {
  const stats = campaign.stats;
  if (!stats) return null;
  const parts = [`${stats.sent} sent`];
  if (stats.clicked) parts.push(`${stats.clicked} tapped`);
  if (stats.booked) parts.push(`${stats.booked} booked`);
  return parts.join(" · ");
}
