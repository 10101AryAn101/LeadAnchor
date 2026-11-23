"use client";

import {
  DAYPARTS,
  type Daypart,
  LEAD_SOURCE_LABELS,
  PAYMENT_METHOD_LABELS,
  REPORT_PERIODS,
  type ReportPeriod,
  type ReportsResponse,
} from "@leadanchor/contracts";
import { IconDownload } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { parseAsStringLiteral, useQueryState } from "nuqs";
import { type ReactNode, useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { UpgradeNotice, useFeature } from "@/features/billing/upgrade-notice";
import { api } from "@/lib/api";
import { money, percent } from "@/lib/format";
import { cn } from "@/lib/utils";

const PERIOD_LABEL: Record<ReportPeriod, string> = {
  "30d": "30 days",
  "90d": "90 days",
  "12m": "12 months",
};
const DAYPART_LABEL: Record<Daypart, string> = {
  morning: "Morning",
  afternoon: "Afternoon",
  evening: "Evening",
  night: "Night",
};
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** Monday first, the way owners think about their week. */
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

const bucketLabel = (start: string, monthly: boolean) =>
  new Date(`${start}T12:00:00`).toLocaleDateString(
    "en-US",
    monthly ? { month: "short" } : { month: "short", day: "numeric" },
  );

/** One report as a CSV file: the same numbers as on screen. */
function downloadCsv(name: string, header: string[], lines: Array<Array<string | number>>) {
  const cell = (value: string | number) => {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const csv = [header, ...lines].map((line) => line.map(cell).join(",")).join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  link.download = `${name}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

/** Module 10: a fixed suite of reports over the business's own records. Full reports are Pro. */
export function ReportsView() {
  const [period, setPeriod] = useQueryState(
    "period",
    parseAsStringLiteral(REPORT_PERIODS).withDefault("30d").withOptions({ history: "replace" }),
  );
  const allowed = useFeature("reports");
  const { data, isPending } = useQuery({
    queryKey: ["reports", period],
    queryFn: () => api<ReportsResponse>(`/reports?period=${period}`),
    enabled: allowed,
  });

  return (
    <div className="space-y-6 pb-24 lg:pb-0">
      <PageHeader
        title="Reports"
        description="How the business is doing, from your own calls, jobs and payments."
        actions={
          <ToggleGroup
            value={[period]}
            onValueChange={(value) => {
              const next = value[0] as ReportPeriod | undefined;
              if (next) void setPeriod(next);
            }}
            variant="outline"
            aria-label="Period"
          >
            {REPORT_PERIODS.map((option) => (
              <ToggleGroupItem key={option} value={option} className="px-3.5">
                {PERIOD_LABEL[option]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        }
      />
      <UpgradeNotice feature="reports">
        Your Today page still shows calls caught, jobs won and money recovered.
      </UpgradeNotice>
      {!allowed ? null : isPending || !data ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-72 rounded-lg" />
          <Skeleton className="h-72 rounded-lg" />
          <Skeleton className="h-56 rounded-lg" />
          <Skeleton className="h-56 rounded-lg" />
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <MoneyReport data={data} />
          <SourcesReport data={data} />
          <CallsReport data={data} />
          <ResponseReport data={data} />
          <BookingsReport data={data} />
          <ReviewsReport data={data} />
          <CampaignsReport data={data} />
        </div>
      )}
    </div>
  );
}

function Report({
  title,
  description,
  onCsv,
  wide,
  children,
}: {
  title: string;
  description: string;
  onCsv?: () => void;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <section className={cn("space-y-4 rounded-lg border bg-card p-5", wide && "lg:col-span-2")}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-[17px] font-bold">{title}</h2>
          <p className="text-[15px] text-muted-foreground">{description}</p>
        </div>
        {onCsv && (
          <Button variant="ghost" size="sm" onClick={onCsv} aria-label={`Download ${title} as CSV`}>
            <IconDownload /> CSV
          </Button>
        )}
      </div>
      {children}
    </section>
  );
}

function Stat({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail?: string;
}) {
  return (
    <div className="rounded-md bg-muted/60 p-3">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="tabular font-display text-2xl leading-tight font-semibold">{value}</p>
      {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
    </div>
  );
}

/** A single-series bar chart: one hue, rounded data-ends on the baseline, the value on hover or focus. */
function Bars({ points }: { points: Array<{ label: string; value: number; text: string }> }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...points.map((point) => point.value));
  const shown = active === null ? null : points[active];
  return (
    <div className="space-y-1.5">
      <p className="h-5 text-sm text-muted-foreground" aria-live="polite">
        {shown ? `${shown.label}: ${shown.text}` : "Hover or tap a bar for its value"}
      </p>
      <div className="flex h-36 items-end gap-0.5 border-b" onMouseLeave={() => setActive(null)}>
        {points.map((point, index) => (
          <button
            key={point.label}
            type="button"
            aria-label={`${point.label}: ${point.text}`}
            onMouseEnter={() => setActive(index)}
            onFocus={() => setActive(index)}
            onBlur={() => setActive(null)}
            onClick={() => setActive(index)}
            className="group flex h-full flex-1 items-end focus-visible:outline-none"
          >
            <span
              className={cn(
                "block w-full rounded-t-[4px] bg-primary transition-opacity",
                active !== null && active !== index && "opacity-50",
                "group-focus-visible:ring-2 group-focus-visible:ring-ring",
              )}
              style={{
                height: `${point.value === 0 ? 0 : Math.max(3, (point.value / max) * 100)}%`,
              }}
            />
          </button>
        ))}
      </div>
      <div className="flex justify-between text-[13px] text-muted-foreground">
        <span>{points[0]?.label}</span>
        <span>{points.at(-1)?.label}</span>
      </div>
    </div>
  );
}

function MoneyReport({ data }: { data: ReportsResponse }) {
  const { money: report } = data;
  const monthly = data.period === "12m";
  return (
    <Report
      title="Money"
      description="Real job values of jobs you won, and payments you received. Never estimates."
      wide
      onCsv={() =>
        downloadCsv(
          `money-${data.period}`,
          [monthly ? "Month starting" : "Week starting", "Won ($)", "Collected ($)"],
          report.buckets.map((bucket) => [
            bucket.start,
            bucket.wonCents / 100,
            bucket.collectedCents / 100,
          ]),
        )
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Jobs won"
          value={money(report.wonCents)}
          detail={report.averageJobCents ? `${money(report.averageJobCents)} average` : undefined}
        />
        <Stat label="Collected" value={money(report.collectedCents)} />
        <Stat
          label="Held on cards"
          value={money(report.heldCents)}
          detail="Deposits not yet collected"
        />
        <Stat
          label="Still to collect"
          value={money(report.openCents)}
          detail="Payment requests not paid"
        />
      </div>
      <div>
        <p className="mb-1 text-sm font-semibold">Jobs won, by {monthly ? "month" : "week"}</p>
        <Bars
          points={report.buckets.map((bucket) => ({
            label: bucket.start ? bucketLabel(bucket.start, monthly) : "",
            value: bucket.wonCents,
            text: `${money(bucket.wonCents)} won, ${money(bucket.collectedCents)} collected`,
          }))}
        />
      </div>
      {report.byMethod.length > 0 && (
        <p className="text-[15px] text-muted-foreground">
          Paid by{" "}
          {report.byMethod
            .map((row) => `${PAYMENT_METHOD_LABELS[row.method]} ${money(row.cents)} (${row.count})`)
            .join(" · ")}
        </p>
      )}
    </Report>
  );
}

function SourcesReport({ data }: { data: ReportsResponse }) {
  const max = Math.max(1, ...data.sources.map((row) => row.leads));
  return (
    <Report
      title="Where your leads come from"
      description="New leads in the period, and how many of them you won."
      onCsv={() =>
        downloadCsv(
          `lead-sources-${data.period}`,
          ["Source", "Leads", "Won", "Won ($)"],
          data.sources.map((row) => [
            LEAD_SOURCE_LABELS[row.source],
            row.leads,
            row.won,
            row.wonCents / 100,
          ]),
        )
      }
    >
      {data.sources.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">No new leads in this period.</p>
      ) : (
        <table className="w-full text-[15px]">
          <thead>
            <tr className="text-left text-sm text-muted-foreground">
              <th className="pb-2 font-medium">Source</th>
              <th className="pb-2 text-right font-medium">Leads</th>
              <th className="pb-2 text-right font-medium">Won</th>
              <th className="hidden pb-2 text-right font-medium sm:table-cell">Won value</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.sources.map((row) => (
              <tr key={row.source}>
                <td className="py-2 pr-2">
                  <span className="block">{LEAD_SOURCE_LABELS[row.source]}</span>
                  <span
                    className="mt-1 block h-1.5 rounded-full bg-primary/80"
                    style={{ width: `${(row.leads / max) * 100}%` }}
                    aria-hidden
                  />
                </td>
                <td className="tabular py-2 text-right">{row.leads}</td>
                <td className="tabular py-2 text-right">
                  {row.won}{" "}
                  <span className="text-sm text-muted-foreground">
                    ({percent(row.leads ? row.won / row.leads : 0)})
                  </span>
                </td>
                <td className="tabular hidden py-2 text-right sm:table-cell">
                  {money(row.wonCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Report>
  );
}

function CallsReport({ data }: { data: ReportsResponse }) {
  const { calls } = data;
  const cell = (weekday: number, daypart: Daypart) =>
    calls.byTime.find((row) => row.weekday === weekday && row.daypart === daypart)?.missed ?? 0;
  const max = Math.max(1, ...calls.byTime.map((row) => row.missed));
  // One hue, light to dark: more missed calls, darker cell. The number is always written in it.
  const shade = (count: number) =>
    count === 0
      ? "bg-muted/50 text-muted-foreground"
      : count / max > 0.66
        ? "bg-primary text-primary-foreground"
        : count / max > 0.33
          ? "bg-primary/55"
          : "bg-primary/20";
  return (
    <Report
      title="Missed calls"
      description="Calls you couldn't answer that LeadAnchor caught, and when they happen."
      onCsv={() =>
        downloadCsv(
          `missed-calls-${data.period}`,
          ["Day", ...DAYPARTS.map((daypart) => DAYPART_LABEL[daypart])],
          WEEK_ORDER.map((weekday) => [
            WEEKDAYS[weekday]!,
            ...DAYPARTS.map((daypart) => cell(weekday, daypart)),
          ]),
        )
      }
    >
      <div className="grid grid-cols-3 gap-2">
        <Stat
          label="Caught"
          value={calls.missed}
          detail={`${calls.ghost} hang-ups, ${calls.voicemail} voicemails`}
        />
        <Stat label="Became leads" value={calls.toLeads} />
        <Stat label="You answered" value={calls.answered} />
      </div>
      <table className="w-full table-fixed text-center text-[13px]">
        <caption className="mb-1 text-left text-sm font-semibold">When calls are missed</caption>
        <thead>
          <tr>
            <th className="w-16" />
            {DAYPARTS.map((daypart) => (
              <th key={daypart} className="pb-1 font-medium text-muted-foreground">
                {DAYPART_LABEL[daypart]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {WEEK_ORDER.map((weekday) => (
            <tr key={weekday}>
              <th className="py-0.5 pr-2 text-left font-medium text-muted-foreground">
                {WEEKDAYS[weekday]}
              </th>
              {DAYPARTS.map((daypart) => {
                const count = cell(weekday, daypart);
                return (
                  <td key={daypart} className="p-0.5">
                    <span
                      className={cn(
                        "tabular flex h-8 items-center justify-center rounded-[4px] font-semibold",
                        shade(count),
                      )}
                    >
                      {count}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </Report>
  );
}

function ResponseReport({ data }: { data: ReportsResponse }) {
  const { response } = data;
  const median =
    response.medianMinutes === null
      ? "–"
      : response.medianMinutes < 60
        ? `${Math.round(response.medianMinutes)} min`
        : `${Math.round((response.medianMinutes / 60) * 10) / 10} h`;
  return (
    <Report
      title="How fast you reach new leads"
      description="From a lead arriving to you tapping Call or Text, or answering their call."
      onCsv={() =>
        downloadCsv(
          `response-${data.period}`,
          ["New leads", "Reached", "Median minutes", "Within 5 min", "Within 1 hour"],
          [
            [
              response.leads,
              response.contacted,
              response.medianMinutes ?? "",
              response.within5,
              response.within60,
            ],
          ],
        )
      }
    >
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Typical time" value={median} detail="Half are faster" />
        <Stat
          label="Within 5 min"
          value={percent(response.leads ? response.within5 / response.leads : 0)}
        />
        <Stat
          label="Within an hour"
          value={percent(response.leads ? response.within60 / response.leads : 0)}
        />
      </div>
      <p className="text-[15px] text-muted-foreground">
        You reached {response.contacted} of {response.leads} new{" "}
        {response.leads === 1 ? "lead" : "leads"} from the app. Calls and texts from your own phone
        aren&apos;t counted.
      </p>
    </Report>
  );
}

function BookingsReport({ data }: { data: ReportsResponse }) {
  const { bookings } = data;
  const finished = bookings.completed + bookings.noShows;
  return (
    <Report
      title="Bookings"
      description="Visits booked in the period, and how the ones due went."
      onCsv={() =>
        downloadCsv(
          `bookings-${data.period}`,
          ["Booked", "Online", "By you", "From the waitlist", "Done", "No-shows", "Cancelled"],
          [
            [
              bookings.total,
              bookings.online,
              bookings.byOwner,
              bookings.fromWaitlist,
              bookings.completed,
              bookings.noShows,
              bookings.canceled,
            ],
          ],
        )
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <Stat
          label="Booked"
          value={bookings.total}
          detail={`${bookings.online} online, ${bookings.byOwner} by you`}
        />
        <Stat label="From the waitlist" value={bookings.fromWaitlist} />
        <Stat label="Done" value={bookings.completed} />
        <Stat
          label="No-shows"
          value={bookings.noShows}
          detail={finished ? `${percent(bookings.noShows / finished)} of visits due` : undefined}
        />
        <Stat label="Cancelled" value={bookings.canceled} />
      </div>
    </Report>
  );
}

function ReviewsReport({ data }: { data: ReportsResponse }) {
  const { reviews } = data;
  return (
    <Report
      title="Reviews"
      description="Review requests after finished jobs, and the Google reviews that came in."
      onCsv={() =>
        downloadCsv(
          `reviews-${data.period}`,
          ["Requests sent", "Reviews received", "Average rating", "Replies posted"],
          [[reviews.requested, reviews.received, reviews.averageRating ?? "", reviews.replied]],
        )
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <Stat label="Requests sent" value={reviews.requested} />
        <Stat label="Reviews in" value={reviews.received} />
        <Stat
          label="Average"
          value={reviews.averageRating?.toFixed(1) ?? "–"}
          detail="of 5 stars"
        />
        <Stat label="Replied" value={reviews.replied} />
      </div>
    </Report>
  );
}

function CampaignsReport({ data }: { data: ReportsResponse }) {
  return (
    <Report
      title="Campaigns"
      description="Emails sent in the period: who opened the offer, and who booked or asked for a visit."
      wide
      onCsv={() =>
        downloadCsv(
          `campaigns-${data.period}`,
          ["Campaign", "Sent on", "Sent to", "Tapped", "Booked"],
          data.campaigns.map((row) => [
            row.name,
            row.sentAt.slice(0, 10),
            row.sent,
            row.clicked,
            row.booked,
          ]),
        )
      }
    >
      {data.campaigns.length === 0 ? (
        <p className="text-[15px] text-muted-foreground">No campaigns went out in this period.</p>
      ) : (
        <table className="w-full text-[15px]">
          <thead>
            <tr className="text-left text-sm text-muted-foreground">
              <th className="pb-2 font-medium">Campaign</th>
              <th className="pb-2 text-right font-medium">Sent to</th>
              <th className="pb-2 text-right font-medium">Tapped</th>
              <th className="pb-2 text-right font-medium">Booked</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {data.campaigns.map((row) => (
              <tr key={row.id}>
                <td className="py-2 pr-2">
                  <span className="block">{row.name}</span>
                  <span className="block text-sm text-muted-foreground">
                    {new Date(row.sentAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </td>
                <td className="tabular py-2 text-right">{row.sent}</td>
                <td className="tabular py-2 text-right">{row.clicked}</td>
                <td className="tabular py-2 text-right">{row.booked}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Report>
  );
}
