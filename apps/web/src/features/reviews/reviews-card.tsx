"use client";

import { IconBrandGoogle, IconChevronRight } from "@tabler/icons-react";
import Link from "next/link";
import { useReviewsSummary } from "@/lib/queries";
import { Stars } from "./stars";

/** C-23 on Today: the Google rating at a glance, and how many reviews wait for a reply. */
export function ReviewsCard() {
  const { data } = useReviewsSummary();
  if (!data) return null;
  if (!data.connected) {
    return (
      <Link
        href="/reviews"
        className="flex min-h-14 items-center gap-3 rounded-lg border bg-card p-4 hover:bg-muted/40"
      >
        <IconBrandGoogle className="size-5 shrink-0 text-muted-foreground" />
        <span className="flex-1 text-[15px]">
          <span className="font-semibold">Connect Google</span>{" "}
          <span className="text-muted-foreground">
            to see new reviews here with a reply drafted for each.
          </span>
        </span>
        <IconChevronRight className="size-5 shrink-0 text-muted-foreground" />
      </Link>
    );
  }
  return (
    <Link
      href="/reviews"
      className="flex items-center gap-4 rounded-lg border bg-card p-4 hover:bg-muted/40"
    >
      <span className="tabular font-display text-[32px] leading-none font-semibold">
        {data.rating?.toFixed(1) ?? "–"}
      </span>
      <span className="min-w-0 flex-1">
        <Stars rating={data.rating ?? 0} className="text-[17px]" />
        <span className="block text-sm text-muted-foreground">
          {data.count} Google {data.count === 1 ? "review" : "reviews"}
          {data.newThisWeek > 0 && ` · ${data.newThisWeek} new this week`}
        </span>
      </span>
      {data.needReply > 0 && (
        <span className="inline-flex h-7 shrink-0 items-center rounded-full bg-signal-subtle px-2.5 text-[13px] font-semibold text-signal-strong">
          {data.needReply} to reply
        </span>
      )}
      <IconChevronRight className="size-5 shrink-0 text-muted-foreground" />
    </Link>
  );
}
