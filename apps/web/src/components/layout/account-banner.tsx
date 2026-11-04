"use client";

import { type TenantSummary, trialDaysLeft } from "@leadanchor/contracts";
import { IconAlertTriangle, IconClock } from "@tabler/icons-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/** Days before the trial's end when every page starts saying so. */
const TRIAL_WARNING_DAYS = 3;

/**
 * A strip above every page when the LeadAnchor plan needs the owner: the trial's last days, an
 * ended trial or plan, or a payment that didn't go through. Nothing otherwise.
 */
export function AccountBanner({ account }: { account: TenantSummary["account"] }) {
  const left = trialDaysLeft(account.trialEndsAt);
  const notice: { urgent: boolean; text: string; action: string } | null =
    account.status === "trial"
      ? account.tier
        ? left <= TRIAL_WARNING_DAYS
          ? {
              urgent: false,
              text: `Your free trial ends in ${left} ${left === 1 ? "day" : "days"}. Choose a plan to keep booking, the assistant and campaigns.`,
              action: "Choose a plan",
            }
          : null
        : {
            urgent: true,
            text: "Your free trial has ended. Missed calls are still caught; choose a plan to switch everything else back on.",
            action: "Choose a plan",
          }
      : account.status === "past_due"
        ? {
            urgent: true,
            text: "Your last LeadAnchor payment didn't go through. Update your card so nothing pauses.",
            action: "Update card",
          }
        : account.status === "cancelled"
          ? {
              urgent: true,
              text: "Your LeadAnchor plan has ended. Choose a plan to switch it back on.",
              action: "Choose a plan",
            }
          : account.status === "suspended"
            ? {
                urgent: true,
                text: "Your LeadAnchor account is paused. Contact support to switch it back on.",
                action: "",
              }
            : null;
  if (!notice) return null;

  const Icon = notice.urgent ? IconAlertTriangle : IconClock;
  return (
    <div
      role="status"
      className={cn(
        "mb-4 flex items-start gap-3 rounded-lg px-4 py-3 text-[15px] sm:items-center",
        notice.urgent
          ? "bg-destructive-subtle text-destructive-strong"
          : "bg-signal-subtle text-signal-strong",
      )}
    >
      <Icon className="mt-0.5 size-5 shrink-0 sm:mt-0" />
      <p className="min-w-0 flex-1">{notice.text}</p>
      {notice.action && (
        <Link
          href="/settings#plan"
          className="-my-2 inline-flex min-h-11 shrink-0 items-center font-semibold underline underline-offset-2"
        >
          {notice.action}
        </Link>
      )}
    </div>
  );
}
