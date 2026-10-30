"use client";

import { type DashboardRange, type DashboardSummary, type LeadCard, type Urgency, dashboardRange } from "@leadanchor/contracts";
import NumberFlow from "@number-flow/react";
import { IconFlask, IconInfoCircle, IconMessage, IconPhone, IconRefresh } from "@tabler/icons-react";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { useMemo, useState } from "react";
import { Bar, BarChart, XAxis } from "recharts";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { Button } from "@/components/ui/button";
import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { UrgencyChip, WaitingChip, isWaiting } from "@/features/leads/lead-meta";
import { useRecordContact } from "@/features/leads/use-lead-actions";
import { ReviewsCard } from "@/features/reviews/reviews-card";
import { formatPhone, money, percent, smsHref, telHref, timeAgo } from "@/lib/format";
import { useHydrated } from "@/hooks/use-hydrated";
import { keys, useDashboard, useLeads, useMe } from "@/lib/queries";

const rangeParam = parseAsStringLiteral(dashboardRange.options).withDefault("30d").withOptions({ history: "replace" });
const RANGE_LABEL: Record<DashboardRange, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days" };

const chartConfig = {
  captured: { label: "Calls caught", color: "var(--chart-2)" },
  won: { label: "Jobs won", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function DashboardView() {
  // Content comes from browser-side queries; render it only after hydration (see useHydrated).
  return useHydrated() ? <DashboardContent /> : <DashboardSkeleton withHeader />;
}

function DashboardContent() {
  const [range, setRange] = useQueryState("range", rangeParam);
  const { data, isPending, dataUpdatedAt, isFetching } = useDashboard(range);
  const { data: leads } = useLeads();
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const [explainer, setExplainer] = useState(false);

  const waiting = useMemo(
    () => (leads ?? []).filter(isWaiting).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 6),
    [leads],
  );

  const firstName = me?.user.name.split(" ")[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title={firstName ? `Hi ${firstName}` : "Today"}
        description={
          <span className="inline-flex items-center gap-1">
            {dataUpdatedAt ? `Updated ${timeAgo(new Date(dataUpdatedAt).toISOString())}` : "Loading"}
            <button
              type="button"
              aria-label="Refresh"
              onClick={() => void queryClient.invalidateQueries({ queryKey: keys.dashboardAll })}
              className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <IconRefresh className={isFetching ? "size-4 motion-safe:animate-spin" : "size-4"} />
            </button>
          </span>
        }
        actions={
          <ToggleGroup
            value={[range]}
            onValueChange={(value) => {
              const next = value[0] as DashboardRange | undefined;
              if (next) void setRange(next);
            }}
            variant="outline"
            aria-label="Time range"
          >
            {dashboardRange.options.map((option) => (
              <ToggleGroupItem key={option} value={option} className="px-3.5">
                {RANGE_LABEL[option]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      />

      {isPending || !data ? (
        <DashboardSkeleton />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <HeroCard data={data} range={range} onExplain={() => setExplainer(true)} />
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <Tile
                label="Missed calls caught"
                value={data.callsCaptured}
                detail={
                  data.callsCaptured === 0
                    ? "None missed yet in this period."
                    : [
                        data.dispatcherConversations && `${data.dispatcherConversations} by the AI Dispatcher`,
                        data.voicemails && `${data.voicemails} voicemail${data.voicemails === 1 ? "" : "s"}`,
                        data.ghostCalls && `${data.ghostCalls} hang-up${data.ghostCalls === 1 ? "" : "s"}`,
                      ]
                        .filter(Boolean)
                        .join(", ")
                }
              />
              <Tile
                label="Open jobs (est.)"
                value={money(data.pipelineCents)}
                detail={`${data.leadsCreated} new lead${data.leadsCreated === 1 ? "" : "s"}, ${data.leadsWon} won in the last ${RANGE_LABEL[range]}`}
              />
            </div>
          </div>

          {data.leadsCreated > 0 && <UrgencyStrip data={data} />}

          <NeedsYouNow leads={waiting} />

          <ReviewsCard />

          <p className="rounded-lg border bg-card p-4 text-[15px] leading-6">
            <span className="font-semibold">{data.valueProof.headline}</span> <span className="text-muted-foreground">{data.valueProof.detail}</span>
          </p>
        </>
      )}

      <ResponsiveSheet open={explainer} onOpenChange={setExplainer} title="How we count recovered money">
        <div className="space-y-3 pb-2 text-[15px] leading-6 text-muted-foreground">
          <p>
            <span className="font-semibold text-foreground">Recovered</span> adds up the job values you enter when you mark a lead as won — only for
            leads that started as a missed call, a voicemail or an AI Dispatcher call.
          </p>
          <p>We never count estimates there. Open jobs use your typical job value until you set a real amount, and they&apos;re always labelled “est.”</p>
          <p>Calls you answered yourself are not counted as recovered.</p>
        </div>
      </ResponsiveSheet>
    </div>
  );
}

function HeroCard({ data, range, onExplain }: { data: DashboardSummary; range: DashboardRange; onExplain: () => void }) {
  const hasActivity = data.series.some((day) => day.captured > 0 || day.won > 0);
  return (
    <section className="flex flex-col rounded-lg border bg-card p-5">
      <p className="text-[15px] text-muted-foreground">Recovered in the last {RANGE_LABEL[range]}</p>
      <div className="mt-1 font-display text-5xl leading-none font-semibold sm:text-[56px]">
        <NumberFlow value={data.recoveredCents / 100} format={{ style: "currency", currency: "USD", maximumFractionDigits: 0 }} />
      </div>
      <p className="mt-2 text-[15px] text-muted-foreground">
        {data.leadsWon > 0
          ? `${data.leadsWon} job${data.leadsWon === 1 ? "" : "s"} won from calls you would have missed.`
          : "Mark a lead as won with its value and it shows up here."}
      </p>
      <button type="button" onClick={onExplain} className="mt-1 inline-flex min-h-11 items-center gap-1 self-start text-[15px] font-semibold text-primary">
        <IconInfoCircle className="size-4" /> How we count this
      </button>

      {hasActivity ? (
        <ChartContainer config={chartConfig} className="mt-auto aspect-auto h-28 w-full pt-3">
          <BarChart data={data.series} margin={{ left: 0, right: 0, top: 4, bottom: 0 }} barGap={1}>
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              interval="preserveStartEnd"
              minTickGap={24}
              tickFormatter={(value: string) =>
                new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })
              }
              className="text-xs"
            />
            <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="dot" />} />
            <Bar dataKey="captured" fill="var(--color-captured)" radius={[3, 3, 0, 0]} />
            <Bar dataKey="won" fill="var(--color-won)" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ChartContainer>
      ) : (
        <div className="mt-auto flex flex-col items-start gap-3 rounded-md bg-muted p-4 text-[15px] text-muted-foreground">
          <p>$0 recovered so far. Missed calls you&apos;d normally lose will start showing up here.</p>
          <Button variant="outline" nativeButton={false} render={<Link href="/simulator" />}>
            <IconFlask /> Place a test call
          </Button>
        </div>
      )}
    </section>
  );
}

function Tile({ label, value, detail }: { label: string; value: number | string; detail: string }) {
  return (
    <section className="rounded-lg border bg-card p-5">
      <p className="text-[15px] text-muted-foreground">{label}</p>
      <p className="tabular mt-1 font-display text-[34px] leading-tight font-semibold">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </section>
  );
}

const URGENCY_ORDER: Urgency[] = ["emergency", "high", "normal", "low"];

/** C-14: how urgent the new leads were, and how many turned into won jobs. */
function UrgencyStrip({ data }: { data: DashboardSummary }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center sm:gap-4">
      <p className="text-[15px] font-semibold">
        {data.leadsCreated} new lead{data.leadsCreated === 1 ? "" : "s"}
      </p>
      <ul className="flex flex-1 flex-wrap items-center gap-x-4 gap-y-2" aria-label="By urgency">
        {URGENCY_ORDER.filter((level) => data.urgency[level] > 0).map((level) => (
          <li key={level} className="inline-flex items-center gap-1.5">
            <UrgencyChip urgency={level} showRoutine />
            <span className="tabular text-[15px] font-semibold">{data.urgency[level]}</span>
          </li>
        ))}
      </ul>
      <p className="text-[15px] text-muted-foreground">Win rate {percent(data.winRate)}</p>
    </section>
  );
}

function NeedsYouNow({ leads }: { leads: LeadCard[] }) {
  const recordContact = useRecordContact();
  return (
    <section className="rounded-lg border bg-card">
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <h2 className="text-[17px] font-bold">Needs you now</h2>
        <Link href="/leads" className="min-h-11 content-center text-[15px] font-semibold text-primary">
          All leads
        </Link>
      </div>
      {leads.length === 0 ? (
        <p className="px-5 pb-5 text-[15px] text-muted-foreground">No one is waiting on a call back. Nice.</p>
      ) : (
        <ul className="divide-y">
          {leads.map((lead) => (
            <li key={lead.id} className="flex min-h-[72px] items-center gap-3 px-5 py-3">
              <Link href={`/leads/${lead.id}`} className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-semibold">{lead.customer.name ?? formatPhone(lead.customer.phone)}</span>
                  <WaitingChip since={lead.createdAt} />
                </span>
                <span className="mt-0.5 block truncate text-[15px] text-muted-foreground">{lead.title}</span>
              </Link>
              <Button
                variant="outline"
                size="icon"
                nativeButton={false}
                render={<a href={smsHref(lead.customer.phone)} />}
                onClick={() => recordContact(lead, "text")}
                aria-label="Text"
              >
                <IconMessage />
              </Button>
              <Button size="icon" nativeButton={false} render={<a href={telHref(lead.customer.phone)} />} onClick={() => recordContact(lead, "call")} aria-label="Call">
                <IconPhone />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function DashboardSkeleton({ withHeader = false }: { withHeader?: boolean }) {
  return (
    <div className="space-y-4" aria-busy>
      {withHeader && <Skeleton className="mb-2 h-9 w-48" />}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Skeleton className="h-72 rounded-lg" />
        <div className="grid gap-4">
          <Skeleton className="h-32 rounded-lg" />
          <Skeleton className="h-32 rounded-lg" />
        </div>
      </div>
      <Skeleton className="h-56 rounded-lg" />
    </div>
  );
}
