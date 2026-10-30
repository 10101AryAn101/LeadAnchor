"use client";

import type { CampaignKind, CampaignSummary, CampaignsResponse } from "@leadanchor/contracts";
import { IconAlertTriangle, IconChevronRight, IconMailOff, IconPlus } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { api, isApiError } from "@/lib/api";
import { keys, useCampaigns } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { STARTERS, StatusChip, TRIGGER_ICON, statsLine } from "./campaign-meta";

/** Module 11 (C-28, C-29, C-30, C-44): email campaigns to past customers, and the offers suggested for them. */
export function CampaignsView() {
  const { data, isPending } = useCampaigns();
  const [picking, setPicking] = useState(false);
  const create = useCreateCampaign();
  return (
    <div className="space-y-6 pb-24 lg:pb-0">
      <PageHeader
        title="Campaigns"
        description="Email offers to your past customers. Nothing goes out until you approve it."
        actions={
          <Button onClick={() => setPicking(true)}>
            <IconPlus /> New campaign
          </Button>
        }
      />
      {isPending || !data ? (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
        </div>
      ) : (
        <Content
          data={data}
          onStart={(kind) => create.mutate(kind)}
          starting={create.isPending ? create.variables : null}
        />
      )}
      <ResponsiveSheet
        open={picking}
        onOpenChange={setPicking}
        title="New campaign"
        description="Pick a starting point. You can change everything before it goes out."
      >
        <Starters
          onPick={(kind) => create.mutate(kind)}
          starting={create.isPending ? create.variables : null}
        />
      </ResponsiveSheet>
    </div>
  );
}

function useCreateCampaign() {
  const router = useRouter();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (kind: CampaignKind) =>
      api<{ id: string }>("/campaigns", { method: "POST", body: { kind } }),
    onSuccess: ({ id }) => {
      void queryClient.invalidateQueries({ queryKey: keys.campaigns });
      router.push(`/campaigns/${id}`);
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "Couldn't start a campaign."),
  });
}

function Content({
  data,
  onStart,
  starting,
}: {
  data: CampaignsResponse;
  onStart: (kind: CampaignKind) => void;
  starting: CampaignKind | null;
}) {
  const suggested = data.campaigns.filter((campaign) => campaign.status === "suggested");
  const working = data.campaigns.filter((campaign) =>
    ["draft", "scheduled", "sending"].includes(campaign.status),
  );
  const sent = data.campaigns.filter((campaign) => campaign.status === "sent");
  return (
    <div className="space-y-6">
      {!data.setup.postalAddress && (
        <p className="flex items-start gap-2 rounded-lg border border-signal/40 bg-signal-subtle p-4 text-[15px] text-signal-strong">
          <IconAlertTriangle className="mt-0.5 size-5 shrink-0" />
          <span>
            US anti-spam law needs your business address in every marketing email.{" "}
            <Link href="/settings#profile" className="font-semibold underline underline-offset-2">
              Add it in Settings
            </Link>{" "}
            before sending.
          </span>
        </p>
      )}
      {data.setup.customersWithEmail === 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-dashed p-4 text-[15px] text-muted-foreground">
          <IconMailOff className="mt-0.5 size-5 shrink-0" />
          None of your customers have an email address yet. They add one when they book online, fill
          in a request form or accept a quote.
        </p>
      )}

      {suggested.length > 0 && (
        <section aria-labelledby="suggested" className="space-y-3">
          <h2 id="suggested" className="text-[17px] font-bold">
            Suggested for you
          </h2>
          {suggested.map((campaign) => (
            <SuggestionCard key={campaign.id} campaign={campaign} />
          ))}
        </section>
      )}

      {data.campaigns.length === 0 ? (
        <section aria-labelledby="start" className="space-y-3">
          <h2 id="start" className="text-[17px] font-bold">
            Start your first campaign
          </h2>
          <Starters onPick={onStart} starting={starting} />
          <p className="text-sm text-muted-foreground">
            We&apos;ll also suggest offers when a freeze or heat wave is forecast, and before
            holidays that matter to your trade.
          </p>
        </section>
      ) : (
        <>
          {working.length > 0 && <CampaignList title="In progress" campaigns={working} />}
          {sent.length > 0 && <CampaignList title="Sent" campaigns={sent} />}
        </>
      )}
    </div>
  );
}

function Starters({
  onPick,
  starting,
}: {
  onPick: (kind: CampaignKind) => void;
  starting: CampaignKind | null;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 pb-2 sm:grid-cols-3">
      {STARTERS.map(({ kind, icon: Icon, title, body }) => (
        <button
          key={kind}
          type="button"
          disabled={starting !== null}
          onClick={() => onPick(kind)}
          className="flex items-start gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-primary-subtle/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60 sm:flex-col"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary-subtle-foreground">
            {starting === kind ? <Spinner /> : <Icon className="size-5" />}
          </span>
          <span className="min-w-0">
            <span className="block font-semibold">{title}</span>
            <span className="block text-sm text-muted-foreground">{body}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function SuggestionCard({ campaign }: { campaign: CampaignSummary }) {
  const queryClient = useQueryClient();
  const dismiss = useMutation({
    mutationFn: () => api(`/campaigns/${campaign.id}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.campaigns });
      toast.success("Dismissed. We won't suggest it again.");
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't dismiss it."),
  });
  const trigger = campaign.trigger;
  const Icon = trigger ? TRIGGER_ICON[trigger.kind] : TRIGGER_ICON.holiday;
  return (
    <article className="rounded-lg border border-signal/40 bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-signal-subtle text-signal-strong">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{trigger?.title ?? campaign.name}</h3>
          {trigger && <p className="text-[15px] text-muted-foreground">{trigger.detail}</p>}
          <p className="mt-2 text-[15px]">
            We drafted <span className="font-semibold">“{campaign.name}”</span> for{" "}
            {campaign.audienceLabel.toLowerCase()}.
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 sm:pl-[52px]">
        <Button nativeButton={false} render={<Link href={`/campaigns/${campaign.id}`} />}>
          Review the offer
        </Button>
        <Button variant="ghost" disabled={dismiss.isPending} onClick={() => dismiss.mutate()}>
          {dismiss.isPending && <Spinner />} Dismiss
        </Button>
      </div>
    </article>
  );
}

function CampaignList({ title, campaigns }: { title: string; campaigns: CampaignSummary[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-[17px] font-bold">{title}</h2>
      <ul className="divide-y rounded-lg border bg-card">
        {campaigns.map((campaign) => {
          const stats = statsLine(campaign);
          return (
            <li key={campaign.id}>
              <Link
                href={`/campaigns/${campaign.id}`}
                className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{campaign.name}</span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {stats ?? campaign.audienceLabel}
                  </span>
                </span>
                <StatusChip
                  campaign={campaign}
                  className={cn(campaign.status === "sent" && "hidden sm:inline-flex")}
                />
                <IconChevronRight className="size-5 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
