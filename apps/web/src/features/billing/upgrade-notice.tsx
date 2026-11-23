"use client";

import {
  type Feature,
  FEATURE_LABELS,
  FEATURE_TIER,
  type TenantSummary,
  TIER_DETAILS,
  tierAllows,
} from "@leadanchor/contracts";
import { IconLock } from "@tabler/icons-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useHydrated } from "@/hooks/use-hydrated";
import { useMe } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** The business's LeadAnchor account, once this screen has hydrated (so the first render matches the server's HTML). */
function useAccount() {
  const { data: me } = useMe();
  return useHydrated() ? me?.tenant?.account : undefined;
}

/**
 * Whether the business's plan covers a feature right now. True until the session has loaded, so
 * nothing flashes locked; the API refuses anything the plan doesn't cover either way.
 */
export function useFeature(feature: Feature) {
  const account = useAccount();
  return !account || tierAllows(account.tier, feature);
}

/** Why a feature is locked, in the owner's words: the trial ended, the plan ended, or it's a higher tier. */
export function lockedReason(account: TenantSummary["account"], feature: Feature) {
  const label = FEATURE_LABELS[feature];
  const tier = TIER_DETAILS[FEATURE_TIER[feature]].name;
  switch (account.status) {
    case "trial":
      return {
        title: "Your free trial has ended",
        body: `${label} is part of ${tier}. Choose a plan to switch it back on.`,
      };
    case "cancelled":
      return {
        title: "Your plan has ended",
        body: `${label} is part of ${tier}. Choose a plan to switch it back on.`,
      };
    case "suspended":
      return {
        title: "Your account is paused",
        body: "Contact LeadAnchor support to switch it back on.",
      };
    default:
      return {
        title: `${label} is part of ${tier}`,
        body: `Your plan doesn't include it. Switch to ${tier} to use it.`,
      };
  }
}

/**
 * Shown where a feature lives that the plan doesn't cover: why, what still works (children), and
 * a link to the plans. Renders nothing while the feature is included.
 */
export function UpgradeNotice({
  feature,
  children,
  className,
}: {
  feature: Feature;
  children?: ReactNode;
  className?: string;
}) {
  const account = useAccount();
  if (!account || tierAllows(account.tier, feature)) return null;
  const { title, body } = lockedReason(account, feature);
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg bg-signal-subtle p-4 text-signal-strong",
        className,
      )}
    >
      <IconLock className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{title}</p>
        <p className="text-[15px]">
          {body}
          {children && <> {children}</>}
        </p>
        {account.status !== "suspended" && (
          <Link
            href="/settings#plan"
            className="inline-flex min-h-11 items-center font-semibold underline underline-offset-2"
          >
            See plans
          </Link>
        )}
      </div>
    </div>
  );
}
