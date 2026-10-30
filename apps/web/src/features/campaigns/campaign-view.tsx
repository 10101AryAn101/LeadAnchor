"use client";

import type { CampaignDetail, CampaignRecipient } from "@leadanchor/contracts";
import {
  IconArrowLeft,
  IconCalendarClock,
  IconChevronDown,
  IconExternalLink,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { api, isApiError } from "@/lib/api";
import { money, percent } from "@/lib/format";
import { keys, useCampaign, useMe } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { CampaignEditor } from "./campaign-editor";
import { StatusChip, zonedWhen } from "./campaign-meta";
import { EmailPreview } from "./email-preview";

/** One campaign: the editor while it's a draft, then who it reached and what they did (module 11). */
export function CampaignView({ id }: { id: string }) {
  const { data, isPending, isError } = useCampaign(id);
  return (
    <div className="space-y-5 pb-24 lg:pb-0">
      <Link
        href="/campaigns"
        className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-muted-foreground hover:text-foreground"
      >
        <IconArrowLeft className="size-4" /> Campaigns
      </Link>
      {isError ? (
        <p className="rounded-lg border border-dashed p-6 text-[15px] text-muted-foreground">
          This campaign isn&apos;t here any more. It may have been deleted or dismissed.
        </p>
      ) : isPending || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-10 w-2/3 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      ) : (
        <>
          <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="min-w-0 font-display text-[26px] leading-tight font-semibold wrap-anywhere">
              {data.name}
            </h1>
            <StatusChip campaign={data} timeZone={data.timezone} />
          </header>
          {data.status === "draft" || data.status === "suggested" ? (
            <CampaignEditor key={data.id} campaign={data} />
          ) : (
            <CampaignReport campaign={data} />
          )}
        </>
      )}
    </div>
  );
}

function CampaignReport({ campaign }: { campaign: CampaignDetail }) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="min-w-0 space-y-5">
        {campaign.status === "scheduled" ? (
          <ScheduledNote campaign={campaign} />
        ) : (
          <Results campaign={campaign} />
        )}
        {campaign.recipients.length > 0 && <Recipients recipients={campaign.recipients} />}
      </div>
      <aside className="min-w-0 space-y-3 lg:sticky lg:top-20 lg:self-start">
        <AboutCard campaign={campaign} />
        <SentEmail id={campaign.id} />
      </aside>
    </div>
  );
}

function ScheduledNote({ campaign }: { campaign: CampaignDetail }) {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const cancel = useMutation({
    mutationFn: () =>
      api<CampaignDetail>(`/campaigns/${campaign.id}/unschedule`, { method: "POST" }),
    onSuccess: (next) => {
      queryClient.setQueryData(keys.campaign(campaign.id), next);
      void queryClient.invalidateQueries({ queryKey: keys.campaigns });
      toast.success("Schedule cancelled. It's a draft again.");
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't cancel it."),
  });
  return (
    <section className="flex flex-wrap items-center gap-4 rounded-lg border bg-info-subtle p-5">
      <IconCalendarClock className="size-6 shrink-0 text-info-strong" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-info-strong">
          Sends{" "}
          {campaign.scheduledFor ? zonedWhen(campaign.scheduledFor, campaign.timezone) : "soon"}
        </p>
        <p className="text-[15px] text-foreground/80">
          {campaign.audienceLabel}. Anyone who unsubscribes before then is left out.
        </p>
      </div>
      {me?.role === "owner" && (
        <Button variant="outline" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
          {cancel.isPending && <Spinner />} Cancel the schedule
        </Button>
      )}
    </section>
  );
}

function Results({ campaign }: { campaign: CampaignDetail }) {
  const stats = campaign.stats;
  if (!stats) return null;
  const share = (count: number) => (stats.sent > 0 ? ` · ${percent(count / stats.sent)}` : "");
  const tiles = [
    {
      label: "Sent",
      value: String(stats.sent),
      note: campaign.status === "sending" ? "Going out now" : null,
    },
    {
      label: "Tapped the button",
      value: String(stats.clicked),
      note: stats.clicked ? share(stats.clicked).slice(3) : null,
    },
    {
      label: "Booked or asked",
      value: String(stats.booked),
      note: stats.booked ? share(stats.booked).slice(3) : null,
    },
    { label: "Won from it", value: money(stats.wonCents), note: null },
  ];
  const quiet = [
    stats.skipped && `${stats.skipped} left out`,
    stats.unsubscribed && `${stats.unsubscribed} unsubscribed`,
    stats.bounced && `${stats.bounced} bounced`,
    stats.complained && `${stats.complained} marked it as spam`,
  ].filter(Boolean);
  return (
    <section aria-label="Results" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-lg border bg-card p-4">
            <p className="text-sm text-muted-foreground">{tile.label}</p>
            <p className="tabular mt-1 text-[26px] leading-none font-semibold">{tile.value}</p>
            {tile.note && <p className="mt-1.5 text-sm text-muted-foreground">{tile.note}</p>}
          </div>
        ))}
      </div>
      {quiet.length > 0 && <p className="text-[15px] text-muted-foreground">{quiet.join(" · ")}</p>}
    </section>
  );
}

const STATUS_TEXT = (recipient: CampaignRecipient) => {
  if (recipient.bookedAt)
    return { label: "Booked", tone: "bg-primary-subtle text-primary-subtle-foreground" };
  if (recipient.status === "bounced")
    return { label: "Bounced", tone: "bg-destructive-subtle text-destructive-strong" };
  if (recipient.complainedAt)
    return { label: "Marked as spam", tone: "bg-destructive-subtle text-destructive-strong" };
  if (recipient.unsubscribedAt)
    return { label: "Unsubscribed", tone: "bg-muted text-muted-foreground" };
  if (recipient.clickedAt) return { label: "Tapped", tone: "bg-info-subtle text-info-strong" };
  if (recipient.status === "skipped")
    return { label: "Left out", tone: "bg-muted text-muted-foreground" };
  if (recipient.status === "failed")
    return { label: "Failed", tone: "bg-destructive-subtle text-destructive-strong" };
  return { label: "Sent", tone: "bg-muted text-muted-foreground" };
};

function Recipients({ recipients }: { recipients: CampaignRecipient[] }) {
  const reached = recipients.filter((recipient) => recipient.status !== "skipped");
  const left = recipients.filter((recipient) => recipient.status === "skipped");
  return (
    <section className="space-y-3">
      <h2 className="text-[17px] font-bold">
        Sent to <span className="font-normal text-muted-foreground">· {reached.length}</span>
      </h2>
      <RecipientList recipients={reached} />
      {left.length > 0 && (
        <>
          <h2 className="pt-2 text-[17px] font-bold">
            Left out <span className="font-normal text-muted-foreground">· {left.length}</span>
          </h2>
          <RecipientList recipients={left} />
        </>
      )}
    </section>
  );
}

function RecipientList({ recipients }: { recipients: CampaignRecipient[] }) {
  return (
    <ul className="divide-y rounded-lg border bg-card">
      {recipients.map((recipient) => {
        const status = STATUS_TEXT(recipient);
        return (
          <li key={recipient.id} className="flex items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{recipient.name}</p>
              <p className="truncate text-sm text-muted-foreground">
                {recipient.status === "skipped"
                  ? (recipient.skipReason ?? "Left out")
                  : (recipient.email ?? "")}
              </p>
            </div>
            {recipient.leadId ? (
              <Link
                href={`/leads/${recipient.leadId}`}
                className={cn(
                  "inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-[13px] font-semibold",
                  status.tone,
                )}
              >
                {status.label} <IconExternalLink className="size-3.5" />
              </Link>
            ) : (
              <span
                className={cn(
                  "inline-flex h-7 shrink-0 items-center rounded-full px-2.5 text-[13px] font-medium",
                  status.tone,
                )}
              >
                {status.label}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** "Sunday, November 15" for a "2026-11-15" date. */
const longDate = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

function AboutCard({ campaign }: { campaign: CampaignDetail }) {
  const rows = [
    ["To", campaign.audienceLabel],
    [
      "Offer",
      campaign.offer
        ? `${campaign.offer}${campaign.offerEndsOn ? ` (until ${longDate(campaign.offerEndsOn)})` : ""}`
        : "None",
    ],
    [
      "Approved",
      campaign.approvedAt
        ? `${zonedWhen(campaign.approvedAt, campaign.timezone)}${campaign.approvedBy ? ` by ${campaign.approvedBy}` : ""}`
        : "—",
    ],
    ["Sent", campaign.sentAt ? zonedWhen(campaign.sentAt, campaign.timezone) : "Not yet"],
  ];
  return (
    <section className="rounded-lg border bg-card p-4">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-[15px]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="wrap-anywhere">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function SentEmail({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3">
      <Button
        variant="outline"
        className="w-full justify-between"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Hide the email" : "See the email"}{" "}
        <IconChevronDown className={cn("transition-transform", open && "rotate-180")} />
      </Button>
      {open && <EmailPreview id={id} />}
    </div>
  );
}
