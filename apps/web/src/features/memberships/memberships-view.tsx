"use client";

import {
  type MembershipItem,
  type MembershipStatus,
  type MembershipsResponse,
  PRICE_MOVE_NOTICE_DAYS,
  type PlanItem,
  type PlansResponse,
  cadenceLabel,
  planPrice,
} from "@leadanchor/contracts";
import {
  IconAlertTriangle,
  IconArchive,
  IconArchiveOff,
  IconCheck,
  IconChevronRight,
  IconCopy,
  IconExternalLink,
  IconPencil,
  IconPlus,
  IconRepeat,
  IconTrendingDown,
  IconTrendingUp,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UpgradeNotice, useFeature } from "@/features/billing/upgrade-notice";
import { useHydrated } from "@/hooks/use-hydrated";
import { api, isApiError } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { amount, money } from "@/lib/format";
import { keys, useMe, useMemberships, usePlans } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { MemberSheet } from "./member-sheet";
import { MemberStatus, memberLine, per, shortDate } from "./membership-meta";
import { PlanEditor } from "./plan-editor";

const TABS = ["members", "plans"] as const;
const FILTERS: Array<{ id: "all" | MembershipStatus; label: string }> = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "past_due", label: "Past due" },
  { id: "paused", label: "Paused" },
  { id: "canceled", label: "Cancelled" },
];

/** Module 12 (C-48 … C-52): the business's own plans, its members, and the income it can count on. */
export function MembershipsView() {
  const [tab, setTab] = useQueryState(
    "tab",
    parseAsStringLiteral(TABS).withDefault("members").withOptions({ history: "replace" }),
  );
  const [memberId, setMemberId] = useQueryState("m", parseAsString);
  // A job paid for by a plan links here with the bill that paid for it (C-51).
  const [billId, setBillId] = useQueryState("bill", parseAsString);
  const [editing, setEditing] = useState<PlanItem | "new" | null>(null);
  const members = useMemberships();
  const plans = usePlans();
  const { data: me } = useMe();
  // The session can load before this view hydrates; owner-only buttons wait for hydration so
  // the first browser render matches the server's HTML (see useHydrated).
  const owner = useHydrated() && me?.role === "owner";
  const allowed = useFeature("memberships");

  return (
    <div className="space-y-5 pb-24 lg:pb-0">
      <PageHeader
        title="Memberships"
        description="Your own maintenance plans. Members pay automatically, and the work lands on your board."
        actions={
          owner && (
            <Button
              disabled={!allowed}
              onClick={() => {
                void setTab("plans");
                setEditing("new");
              }}
            >
              <IconPlus /> New plan
            </Button>
          )
        }
      />
      <UpgradeNotice feature="memberships">
        Members you already have keep paying as usual, and you can still look after them here. New
        plans and sign-ups are paused.
      </UpgradeNotice>
      {allowed && plans.data && !plans.data.cardsReady && (
        <p className="flex items-start gap-2 rounded-lg border border-signal/40 bg-signal-subtle p-4 text-[15px] text-signal-strong">
          <IconAlertTriangle className="mt-0.5 size-5 shrink-0" />
          <span>
            Members pay by card through Stripe.{" "}
            <Link href="/settings#payments" className="font-semibold underline underline-offset-2">
              Turn on card payments
            </Link>{" "}
            to take sign-ups; you can build plans in the meantime.
          </span>
        </p>
      )}
      <Tabs value={tab} onValueChange={(value) => void setTab(value as (typeof TABS)[number])}>
        <TabsList className="w-full sm:w-auto">
          <TabsTrigger value="members" className="flex-1 sm:flex-none">
            Members
          </TabsTrigger>
          <TabsTrigger value="plans" className="flex-1 sm:flex-none">
            Plans
          </TabsTrigger>
        </TabsList>
        <TabsContent value="members" className="mt-5">
          {members.isPending || !members.data || !plans.data ? (
            <ListSkeleton />
          ) : (
            <Members
              data={members.data}
              plans={plans.data}
              onOpen={(id) => void setMemberId(id)}
              onPlans={() => void setTab("plans")}
            />
          )}
        </TabsContent>
        <TabsContent value="plans" className="mt-5">
          {plans.isPending || !plans.data ? (
            <ListSkeleton />
          ) : (
            <Plans
              data={plans.data}
              owner={owner && allowed}
              onEdit={(plan) => setEditing(plan)}
              onNew={() => setEditing("new")}
            />
          )}
        </TabsContent>
      </Tabs>
      <MemberSheet
        id={memberId}
        bill={billId}
        plans={plans.data?.plans ?? []}
        onClose={() => {
          void setMemberId(null);
          void setBillId(null);
        }}
      />
      <PlanEditor
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        plan={editing === "new" ? null : editing}
      />
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-28 rounded-lg" />
      <Skeleton className="h-16 rounded-lg" />
      <Skeleton className="h-16 rounded-lg" />
    </div>
  );
}

/** C-50: the headline income (active members only) and its movement since last month. */
function Summary({ summary }: { summary: MembershipsResponse["summary"] }) {
  const up = summary.mrrChangeCents >= 0;
  const Trend = up ? IconTrendingUp : IconTrendingDown;
  // Against last month's close once it's on record; a 30-day estimate until then.
  const since =
    summary.mrrChangeBasis === "last_month" ? "since last month" : "in the last 30 days";
  return (
    <section className="rounded-lg border bg-card p-5">
      <p className="text-sm text-muted-foreground">Recurring income</p>
      <p className="tabular font-display text-[34px] leading-tight font-semibold">
        {money(summary.mrrCents)}
        <span className="text-[17px] font-normal text-muted-foreground"> a month</span>
      </p>
      <p
        className={cn(
          "mt-1 flex flex-wrap items-center gap-x-1.5 text-[15px]",
          summary.mrrChangeCents === 0
            ? "text-muted-foreground"
            : up
              ? "text-primary"
              : "text-signal-strong",
        )}
      >
        {summary.mrrChangeCents === 0 ? (
          `No change ${since}`
        ) : (
          <>
            <Trend className="size-4" />
            {up ? "+" : "−"}
            {money(Math.abs(summary.mrrChangeCents))} {since}
          </>
        )}
        <span className="text-muted-foreground">
          · {summary.joined30d} joined · {summary.canceled30d} cancelled
        </span>
      </p>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <span className="rounded-full bg-primary-subtle px-2.5 py-1 font-medium text-primary-subtle-foreground">
          {summary.active} active
        </span>
        {summary.pastDue > 0 && (
          <span className="rounded-full bg-signal-subtle px-2.5 py-1 font-medium text-signal-strong">
            {summary.pastDue} past due
          </span>
        )}
        {summary.paused > 0 && (
          <span className="rounded-full bg-info-subtle px-2.5 py-1 font-medium text-info-strong">
            {summary.paused} paused
          </span>
        )}
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        Counts active members only: past due and paused members aren&apos;t counted until they pay.
      </p>
    </section>
  );
}

const monthName = (month: string) =>
  new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

/** C-50: month by month, what members paid and the recurring income at each month's end. */
function IncomeHistory({ income }: { income: MembershipsResponse["income"] }) {
  const months = [...income].reverse().slice(0, 6);
  if (!months.some((row) => row.collectedCents > 0 || row.mrrCents !== null)) return null;
  return (
    <section className="rounded-lg border bg-card p-5">
      <h2 className="text-[17px] font-bold">Income by month</h2>
      <table className="mt-3 w-full text-[15px]">
        <thead>
          <tr className="text-left text-sm text-muted-foreground">
            <th className="pb-2 font-medium">Month</th>
            <th className="pb-2 text-right font-medium">Members paid</th>
            <th className="pb-2 text-right font-medium">Recurring</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {months.map((row, index) => (
            <tr key={row.month}>
              <td className="py-2">
                {monthName(row.month)}
                {index === 0 && <span className="text-sm text-muted-foreground"> · so far</span>}
              </td>
              <td className="tabular py-2 text-right">{money(row.collectedCents)}</td>
              <td className="tabular py-2 text-right">
                {row.mrrCents === null ? "—" : `${money(row.mrrCents)}/mo`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-sm text-muted-foreground">
        Recurring is the month&apos;s closing figure, active members only. Months before LeadAnchor
        kept the record show —.
      </p>
    </section>
  );
}

function Members({
  data,
  plans,
  onOpen,
  onPlans,
}: {
  data: MembershipsResponse;
  plans: PlansResponse;
  onOpen: (id: string) => void;
  onPlans: () => void;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["id"]>("all");
  if (data.memberships.length === 0)
    return (
      <Empty className="rounded-lg border border-dashed py-14">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconRepeat />
          </EmptyMedia>
          <EmptyTitle>No members yet</EmptyTitle>
          <EmptyDescription>
            {plans.plans.length === 0
              ? "Build a plan, then share its sign-up link by text, WhatsApp or email."
              : "Share a plan's sign-up link by text, WhatsApp or email. Members show up here as they join."}
          </EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" onClick={onPlans}>
          {plans.plans.length === 0 ? "Build a plan" : "See the sign-up links"}
        </Button>
      </Empty>
    );
  const counts = (id: (typeof FILTERS)[number]["id"]) =>
    id === "all"
      ? data.memberships.length
      : data.memberships.filter((item) => item.status === id).length;
  const shown =
    filter === "all" ? data.memberships : data.memberships.filter((item) => item.status === filter);
  return (
    <div className="space-y-4">
      <Summary summary={data.summary} />
      <IncomeHistory income={data.income} />
      <div className="scrollbar-none flex gap-2 overflow-x-auto" role="tablist" aria-label="Show">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            onClick={() => setFilter(item.id)}
            className={cn(
              "h-9 shrink-0 rounded-full border px-3 text-sm font-medium transition-colors",
              filter === item.id
                ? "border-primary bg-primary text-primary-foreground"
                : "bg-card hover:bg-muted",
            )}
          >
            {item.label} <span className="tabular opacity-70">{counts(item.id)}</span>
          </button>
        ))}
      </div>
      <ul className="divide-y rounded-lg border bg-card">
        {shown.map((item) => (
          <MemberRow key={item.id} item={item} onOpen={() => onOpen(item.id)} />
        ))}
        {shown.length === 0 && (
          <li className="p-4 text-[15px] text-muted-foreground">Nobody here.</li>
        )}
      </ul>
    </div>
  );
}

function MemberRow({ item, onOpen }: { item: MembershipItem; onOpen: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate font-semibold">
              {item.customer.name ?? item.customer.email ?? "Member"}
            </span>
            <MemberStatus status={item.status} />
          </span>
          <span className="block truncate text-sm text-muted-foreground">
            {item.plan.name} · {amount(item.priceCents)}
            {per(item.interval)}
            {item.startedAt ? ` · since ${shortDate(item.startedAt)}` : ""}
          </span>
          <span
            className={cn(
              "block truncate text-sm",
              item.issue ? "font-semibold text-signal-strong" : "text-muted-foreground",
            )}
          >
            {memberLine(item)} · {amount(item.lifetimeCents)} paid
          </span>
        </span>
        <IconChevronRight className="size-5 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}

function Plans({
  data,
  owner,
  onEdit,
  onNew,
}: {
  data: PlansResponse;
  owner: boolean;
  onEdit: (plan: PlanItem) => void;
  onNew: () => void;
}) {
  if (data.plans.length === 0)
    return (
      <Empty className="rounded-lg border border-dashed py-14">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconRepeat />
          </EmptyMedia>
          <EmptyTitle>Build your first plan</EmptyTitle>
          <EmptyDescription>
            For example “Gold AC Care, $29 a month: two tune-ups a year, priority booking and 10%
            off repairs”. Customers sign up from a link, and pay automatically.
          </EmptyDescription>
        </EmptyHeader>
        {owner && (
          <Button onClick={onNew}>
            <IconPlus /> New plan
          </Button>
        )}
      </Empty>
    );
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {data.plans.map((plan) => (
        <PlanCard
          key={plan.id}
          plan={plan}
          owner={owner}
          cardsReady={data.cardsReady}
          onEdit={() => onEdit(plan)}
        />
      ))}
    </div>
  );
}

function PlanCard({
  plan,
  owner,
  cardsReady,
  onEdit,
}: {
  plan: PlanItem;
  owner: boolean;
  cardsReady: boolean;
  onEdit: () => void;
}) {
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const archived = plan.status === "archived";
  const archive = useMutation({
    mutationFn: () =>
      api<PlanItem>(`/membership-plans/${plan.id}/archive`, {
        method: "POST",
        body: { archived: !archived },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.plans });
      toast.success(
        archived
          ? "Taking sign-ups again."
          : "Archived. No new sign-ups; current members carry on.",
      );
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't change it."),
  });
  const members = plan.members.active + plan.members.pastDue + plan.members.paused;
  // C-48 AC 2: members on an older price move only when the owner says so, with notice.
  const [moving, setMoving] = useState(false);
  const move = useMutation({
    mutationFn: () =>
      api<{ moving: number; otherSchedule: number }>(`/membership-plans/${plan.id}/move-members`, {
        method: "POST",
      }),
    onSuccess: (result) => {
      setMoving(false);
      void queryClient.invalidateQueries({ queryKey: keys.plans });
      void queryClient.invalidateQueries({ queryKey: keys.memberships });
      toast.success(
        result.moving > 0
          ? `${result.moving} ${result.moving === 1 ? "member has" : "members have"} been told. The new price starts at their first renewal after ${PRICE_MOVE_NOTICE_DAYS} days.${result.otherSchedule > 0 ? ` ${result.otherSchedule} on another billing schedule kept theirs.` : ""}`
          : "Nobody to move: everyone on another schedule keeps their price. Change them one by one.",
      );
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't move them."),
  });
  return (
    <article
      className={cn("flex flex-col gap-4 rounded-lg border bg-card p-5", archived && "opacity-75")}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[17px] font-bold wrap-anywhere">{plan.name}</h3>
          <p className="tabular text-[15px] font-semibold text-primary">
            {planPrice(plan.priceCents, plan.interval)}
          </p>
        </div>
        {archived && (
          <span className="inline-flex h-6 items-center rounded-full bg-muted px-2 text-[13px] font-medium text-muted-foreground">
            Archived
          </span>
        )}
      </div>
      {plan.description && <p className="text-[15px] text-muted-foreground">{plan.description}</p>}
      {plan.includes.length > 0 && (
        <ul className="space-y-1 text-[15px]">
          {plan.includes.map((item) => (
            <li key={item} className="flex items-start gap-2">
              <IconCheck className="mt-0.5 size-4 shrink-0 text-primary" /> {item}
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted-foreground">
        Job on your board:{" "}
        {plan.workCadence.kind === "none"
          ? "none"
          : `${plan.workServiceName ?? plan.name}, ${cadenceLabel(plan.workCadence).toLowerCase()}`}
      </p>
      <p className="text-sm">
        <span className="font-semibold">{members}</span> {members === 1 ? "member" : "members"}
        {plan.members.pastDue > 0 && (
          <span className="text-signal-strong"> · {plan.members.pastDue} past due</span>
        )}
        {plan.members.olderPrice > 0 && (
          <span className="text-muted-foreground">
            {" "}
            · {plan.members.olderPrice} on an earlier price
          </span>
        )}
        {plan.members.moving > 0 && (
          <span className="text-muted-foreground">
            {" "}
            · {plan.members.moving} moving to this price
          </span>
        )}
      </p>
      {owner && cardsReady && plan.members.olderPrice > 0 && (
        <Button size="sm" variant="outline" className="self-start" onClick={() => setMoving(true)}>
          Move them to {planPrice(plan.priceCents, plan.interval)}
        </Button>
      )}
      <ResponsiveSheet
        open={moving}
        onOpenChange={setMoving}
        title={`Move members to ${planPrice(plan.priceCents, plan.interval)}?`}
        description={`They're told by email now. Each keeps their price for at least ${PRICE_MOVE_NOTICE_DAYS} days, and the new price starts at their first renewal after that. They can cancel before then.`}
        footer={
          <Button disabled={move.isPending} onClick={() => move.mutate()}>
            {move.isPending && <Spinner />} Tell them and move them
          </Button>
        }
      >
        <p className="pb-2 text-[15px] text-muted-foreground">
          Members billed on another schedule (monthly against yearly) keep their price. You can move
          them one by one from their membership.
        </p>
      </ResponsiveSheet>
      {!archived && cardsReady && (
        <div className="space-y-2">
          <p className="rounded-md bg-muted px-3 py-2 text-sm break-all">{plan.signupUrl}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                if (await copyText(plan.signupUrl)) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                } else toast.error("Couldn't copy. Select the link and copy it instead.");
              }}
            >
              {copied ? <IconCheck /> : <IconCopy />} {copied ? "Copied" : "Copy sign-up link"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              nativeButton={false}
              render={<a href={plan.signupUrl} target="_blank" rel="noreferrer" />}
            >
              <IconExternalLink /> Open
            </Button>
          </div>
        </div>
      )}
      {owner && (
        <div className="mt-auto flex flex-wrap gap-2 border-t pt-3">
          <Button size="sm" variant="ghost" onClick={onEdit}>
            <IconPencil /> Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={archive.isPending}
            onClick={() => archive.mutate()}
          >
            {archive.isPending ? <Spinner /> : archived ? <IconArchiveOff /> : <IconArchive />}{" "}
            {archived ? "Take sign-ups again" : "Archive"}
          </Button>
        </div>
      )}
    </article>
  );
}
