"use client";

import {
  ACCOUNT_STATUSES,
  type AccountStatus,
  type OpsHealth,
  type OpsOverview,
  type OpsTenantDetail,
  type OpsTenantRow,
  TIER_DETAILS,
  TRADE_LABELS,
} from "@leadanchor/contracts";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCircleCheck,
  IconExternalLink,
  IconSearch,
} from "@tabler/icons-react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api, isApiError } from "@/lib/api";
import { formatPhone, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const STATUS_LABEL: Record<AccountStatus, string> = {
  trial: "Trial",
  active: "Paying",
  past_due: "Past due",
  suspended: "Suspended",
  cancelled: "Cancelled",
};
const STATUS_TONE: Record<AccountStatus, string> = {
  trial: "bg-info-subtle text-info-strong",
  active: "bg-primary-subtle text-primary-subtle-foreground",
  past_due: "bg-signal-subtle text-signal-strong",
  suspended: "bg-destructive-subtle text-destructive-strong",
  cancelled: "bg-muted text-muted-foreground",
};
const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function StatusChip({ status }: { status: AccountStatus }) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center rounded-full px-2 text-[13px] font-semibold",
        STATUS_TONE[status],
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

function Card({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("space-y-3 rounded-lg border bg-card p-4", className)}>
      <h2 className="font-bold">{title}</h2>
      {children}
    </section>
  );
}

/** Staff only: a signed-in owner who isn't LeadAnchor staff sees why, not an error. */
function NotStaff() {
  return (
    <div className="mx-auto max-w-md space-y-3 py-20 text-center">
      <h1 className="font-display text-2xl font-semibold">LeadAnchor staff only</h1>
      <p className="text-muted-foreground">
        The operator console is for LeadAnchor&apos;s own team.
      </p>
      <Button nativeButton={false} render={<Link href="/dashboard" />}>
        Back to the app
      </Button>
    </div>
  );
}

const forbidden = (error: unknown) =>
  error instanceof ApiError && (error.status === 403 || error.status === 401);

/* ── The overview: businesses, health and onboarding ───────────────────── */

export function OpsHome() {
  const [query, setQuery] = useState("");
  const overview = useQuery({
    queryKey: ["ops", "overview"],
    queryFn: () => api<OpsOverview>("/ops/overview"),
    refetchInterval: 60_000,
    retry: false,
  });
  const tenants = useQuery({
    queryKey: ["ops", "tenants", query],
    queryFn: () => api<{ tenants: OpsTenantRow[] }>(`/ops/tenants?q=${encodeURIComponent(query)}`),
    placeholderData: keepPreviousData,
    retry: false,
  });

  if (forbidden(overview.error)) return <NotStaff />;
  const data = overview.data;
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-[28px] font-semibold">Operator console</h1>
        <p className="text-muted-foreground">
          Every business on LeadAnchor: who needs help, and whether the system is healthy.
        </p>
      </div>

      {!data ? (
        <div className="grid gap-4 md:grid-cols-3">
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {ACCOUNT_STATUSES.map((status) => (
              <div key={status} className="rounded-md border bg-card p-3">
                <p className="text-sm text-muted-foreground">{STATUS_LABEL[status]}</p>
                <p className="tabular font-display text-2xl font-semibold">
                  {data.businesses[status]}
                </p>
              </div>
            ))}
            <div className="rounded-md border bg-card p-3">
              <p className="text-sm text-muted-foreground">New this week</p>
              <p className="tabular font-display text-2xl font-semibold">{data.newThisWeek}</p>
            </div>
            <div className="rounded-md border bg-card p-3">
              <p className="text-sm text-muted-foreground">Websites</p>
              <p className="tabular font-display text-2xl font-semibold">{data.websites}</p>
            </div>
            <div className="rounded-md border bg-card p-3">
              <p className="text-sm text-muted-foreground">In the network</p>
              <p className="tabular font-display text-2xl font-semibold">{data.networkMembers}</p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <HealthCard health={data.health} />
            <Card title="Needs attention">
              <AttentionList
                title="Trials ending in 3 days"
                rows={data.trialsEndingSoon}
                empty="None."
              />
              <AttentionList title="Payment failed" rows={data.pastDue} empty="None." />
              <div className="space-y-1">
                <p className="text-sm font-semibold">Signed up, no business yet</p>
                {data.stuckSignups.length === 0 ? (
                  <p className="text-sm text-muted-foreground">None.</p>
                ) : (
                  <ul className="text-[15px]">
                    {data.stuckSignups.map((user) => (
                      <li key={user.email} className="flex justify-between gap-3 py-0.5">
                        <span className="truncate">
                          {user.name} · {user.email}
                        </span>
                        <span className="shrink-0 text-sm text-muted-foreground">
                          {timeAgo(user.createdAt)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </Card>
          </div>

          <Card title="Data retention">
            <p className="text-[15px] text-muted-foreground">
              Deleted every night once past their time. A business&apos;s own customers, jobs and
              payments stay while it&apos;s a customer; after it cancels, staff can erase them from
              its page here.
            </p>
            <ul className="grid gap-x-6 gap-y-1 text-[15px] sm:grid-cols-2">
              {data.retention.map((rule) => (
                <li key={rule.what} className="flex justify-between gap-3">
                  <span>{rule.what}</span>
                  <span className="tabular shrink-0 text-muted-foreground">
                    {rule.keepDays} days
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      <Card title="Businesses">
        <div className="relative max-w-md">
          <IconSearch className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, web address, owner email or phone"
            className="pl-9"
            aria-label="Find a business"
          />
        </div>
        {!tenants.data ? (
          <Skeleton className="h-40 rounded-md" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-[15px]">
              <thead>
                <tr className="text-left text-sm text-muted-foreground">
                  <th className="pb-2 font-medium">Business</th>
                  <th className="pb-2 font-medium">Owner</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Can use</th>
                  <th className="pb-2 text-right font-medium">Leads (30 days)</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {tenants.data.tenants.map((tenant) => (
                  <tr key={tenant.id}>
                    <td className="py-2 pr-3">
                      <Link
                        href={`/ops/t/${tenant.id}`}
                        className="font-semibold text-primary underline-offset-2 hover:underline"
                      >
                        {tenant.name}
                      </Link>
                      <span className="block text-sm text-muted-foreground">
                        {TRADE_LABELS[tenant.trade]}
                        {tenant.place && ` · ${tenant.place}`}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-sm">{tenant.ownerEmail ?? "–"}</td>
                    <td className="py-2 pr-3">
                      <StatusChip status={tenant.status} />
                      {tenant.status === "trial" && tenant.trialEndsAt && (
                        <span className="block text-sm text-muted-foreground">
                          until {shortDate(tenant.trialEndsAt)}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-sm">
                      {tenant.tier ? TIER_DETAILS[tenant.tier].name : "Starter features only"}
                    </td>
                    <td className="tabular py-2 text-right">{tenant.leads30d}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {tenants.data.tenants.length === 0 && (
              <p className="py-4 text-muted-foreground">No business matches.</p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

function AttentionList({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: OpsTenantRow[];
  empty: string;
}) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-semibold">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="text-[15px]">
          {rows.map((row) => (
            <li key={row.id} className="flex justify-between gap-3 py-0.5">
              <Link href={`/ops/t/${row.id}`} className="truncate font-medium text-primary">
                {row.name}
              </Link>
              <span className="shrink-0 text-sm text-muted-foreground">{row.ownerEmail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Monitoring: what failed in the last 24 hours, and the alerts staff were emailed about. */
function HealthCard({ health }: { health: OpsHealth }) {
  const clear =
    health.failedJobs.length === 0 &&
    health.failedWebhooks.length === 0 &&
    health.errors.length === 0 &&
    health.alerts.length === 0 &&
    health.messages.failed === 0;
  return (
    <Card title="System health (last 24 hours)">
      {clear ? (
        <p className="flex items-center gap-2 text-[15px]">
          <IconCircleCheck className="size-5 text-primary" /> All clear: no failed jobs, webhooks,
          messages or server errors.
        </p>
      ) : (
        <div className="space-y-3 text-[15px]">
          {health.alerts.map((alert) => (
            <p
              key={alert.id}
              className="flex items-start gap-2 rounded-md bg-destructive-subtle p-2.5 text-destructive-strong"
            >
              <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                {alert.message}{" "}
                <span className="text-sm opacity-80">({timeAgo(alert.raisedAt)})</span>
              </span>
            </p>
          ))}
          {health.failedJobs.map((job) => (
            <p key={job.queue}>
              <span className="font-semibold">{job.count} failed</span> {job.queue} jobs
              {job.lastError && (
                <span className="block truncate text-sm text-muted-foreground">
                  {job.lastError}
                </span>
              )}
            </p>
          ))}
          {health.failedWebhooks.map((hook) => (
            <p key={hook.provider}>
              <span className="font-semibold">{hook.count} failed</span> {hook.provider} webhooks
              {hook.lastError && (
                <span className="block truncate text-sm text-muted-foreground">
                  {hook.lastError}
                </span>
              )}
            </p>
          ))}
          {health.errors.length > 0 && (
            <div>
              <p className="font-semibold">{health.errors.length} server errors</p>
              <ul className="text-sm text-muted-foreground">
                {health.errors.slice(0, 5).map((error) => (
                  <li key={`${error.at}-${error.route}`} className="truncate">
                    {timeAgo(error.at)} · {error.route}: {error.message}
                    {error.requestId && ` (request ${error.requestId})`}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        Messages: {health.messages.sent} sent, {health.messages.failed} failed,{" "}
        {health.messages.blocked} held back by the sending rules.
      </p>
    </Card>
  );
}

/* ── One business: support and administration ───────────────────────────── */

export function OpsTenant({ id }: { id: string }) {
  const queryClient = useQueryClient();
  const detail = useQuery({
    queryKey: ["ops", "tenant", id],
    queryFn: () => api<OpsTenantDetail>(`/ops/tenants/${id}`),
    retry: false,
  });
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState<"suspend" | "network" | null>(null);
  const act = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: Record<string, unknown> }) =>
      api<OpsTenantDetail>(`/ops/tenants/${id}/${path}`, { method: "POST", body: body ?? {} }),
    onSuccess: (next, { path }) => {
      queryClient.setQueryData(["ops", "tenant", id], next);
      void queryClient.invalidateQueries({ queryKey: ["ops", "overview"] });
      setConfirming(null);
      setReason("");
      toast.success(
        path === "suspend"
          ? "Suspended."
          : path === "unsuspend"
            ? "Back on."
            : path === "trial"
              ? "Trial extended."
              : "Removed from the network.",
      );
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "That didn't work."),
  });

  if (forbidden(detail.error)) return <NotStaff />;
  const tenant = detail.data;
  if (!tenant) return <Skeleton className="h-96 rounded-lg" />;

  return (
    <div className="space-y-6">
      <Link
        href="/ops"
        className="inline-flex min-h-11 items-center gap-1 text-[15px] font-medium text-muted-foreground hover:text-foreground"
      >
        <IconArrowLeft className="size-4" /> All businesses
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-[28px] font-semibold">{tenant.name}</h1>
        <StatusChip status={tenant.status} />
        <a
          href={tenant.profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[15px] font-semibold text-primary"
        >
          Public profile <IconExternalLink className="size-4" />
        </a>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card title="Owner">
          <Facts
            rows={[
              ["Name", tenant.ownerName],
              ["Email", tenant.ownerEmail],
              ["Cell", tenant.ownerCell ? formatPhone(tenant.ownerCell) : null],
              ["Signed up", shortDate(tenant.createdAt)],
            ]}
          />
        </Card>
        <Card title="Plan and billing">
          <Facts
            rows={[
              ["Can use", tenant.tier ? TIER_DETAILS[tenant.tier].name : "Starter features only"],
              [
                "Trial ends",
                tenant.status === "trial" && tenant.trialEndsAt
                  ? shortDate(tenant.trialEndsAt)
                  : null,
              ],
              ["Next bill", tenant.billing.periodEnd ? shortDate(tenant.billing.periodEnd) : null],
              ["Cancels", tenant.billing.cancelsAt ? shortDate(tenant.billing.cancelsAt) : null],
              [
                "Website add-on",
                tenant.billing.websiteStatus === "none" ? null : tenant.billing.websiteStatus,
              ],
              ["Billing customer", tenant.billing.customerId],
            ]}
          />
        </Card>
        <Card title="Phone and texting">
          <Facts
            rows={[
              [
                "LeadAnchor line",
                tenant.trackingNumber ? formatPhone(tenant.trackingNumber) : null,
              ],
              ["Forwarding", tenant.forwardingStatus.replace("_", " ")],
              [
                "Carrier registration",
                tenant.registration
                  ? `${tenant.registration.status}${tenant.registration.stage ? ` (${tenant.registration.stage})` : ""}`
                  : "Not started",
              ],
            ]}
          />
        </Card>
        <Card title="Connected">
          <Facts
            rows={[
              ["Card payments", tenant.integrations.payments ?? "Not set up"],
              ["Google listing", tenant.integrations.listing ? "Connected" : "Not connected"],
              ["Calendar", tenant.integrations.calendar ? "Connected" : "Not connected"],
              [
                "Trusted pros",
                tenant.network
                  ? tenant.network.available
                    ? "Taking jobs"
                    : "Member, not taking jobs"
                  : "Not a member",
              ],
            ]}
          />
        </Card>
        <Card title="Last 30 days">
          <Facts
            rows={[
              ["Leads", String(tenant.activity.leads30d)],
              ["Calls", String(tenant.activity.calls30d)],
              ["Messages sent", String(tenant.activity.messagesSent30d)],
              ["Messages failed", String(tenant.activity.messagesFailed30d)],
              ["Bookings", String(tenant.activity.bookings30d)],
            ]}
          />
        </Card>
        <Card title="Support actions">
          <div className="space-y-3">
            {tenant.status === "trial" && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[15px]">Extend the trial:</span>
                {[7, 14].map((days) => (
                  <Button
                    key={days}
                    variant="outline"
                    size="sm"
                    disabled={act.isPending}
                    onClick={() => act.mutate({ path: "trial", body: { days } })}
                  >
                    +{days} days
                  </Button>
                ))}
              </div>
            )}
            {tenant.status === "suspended" ? (
              <Button
                variant="outline"
                disabled={act.isPending}
                onClick={() => act.mutate({ path: "unsuspend" })}
              >
                {act.isPending && <Spinner />} Unsuspend
              </Button>
            ) : (
              <Button
                variant="outline"
                className="text-destructive-strong"
                onClick={() => setConfirming("suspend")}
              >
                Suspend…
              </Button>
            )}
            {tenant.network && (
              <Button variant="outline" onClick={() => setConfirming("network")}>
                Remove from the trusted pros network…
              </Button>
            )}
            {tenant.status === "cancelled" && <EraseData tenant={tenant} />}
            {confirming && (
              <div className="space-y-2 rounded-md border border-destructive/40 p-3">
                <p className="text-[15px]">
                  {confirming === "suspend"
                    ? "Suspending turns off the business's public pages and paid features at once. Calls are still answered."
                    : "They'll stop getting jobs from other pros straight away."}
                </p>
                <Textarea
                  rows={2}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="Why (kept in their audit trail)"
                />
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    disabled={act.isPending || reason.trim().length < 3}
                    onClick={() =>
                      act.mutate({
                        path: confirming === "suspend" ? "suspend" : "network/remove",
                        body: { reason },
                      })
                    }
                  >
                    {act.isPending && <Spinner />} {confirming === "suspend" ? "Suspend" : "Remove"}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Recent failures">
          {tenant.failures.length === 0 ? (
            <p className="text-[15px] text-muted-foreground">Nothing failed recently.</p>
          ) : (
            <ul className="divide-y text-[15px]">
              {tenant.failures.map((failure) => (
                <li key={`${failure.at}-${failure.what}-${failure.detail}`} className="py-1.5">
                  <span className="font-medium">{failure.what}</span>{" "}
                  <span className="text-sm text-muted-foreground">{timeAgo(failure.at)}</span>
                  <span className="block truncate text-sm text-muted-foreground">
                    {failure.detail}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Audit trail">
          <ul className="divide-y text-[15px]">
            {tenant.audit.map((entry) => (
              <li key={`${entry.at}-${entry.action}`} className="flex justify-between gap-3 py-1.5">
                <span className="truncate">
                  {entry.action}{" "}
                  <span className="text-sm text-muted-foreground">by {entry.actor}</span>
                </span>
                <span className="shrink-0 text-sm text-muted-foreground">{timeAgo(entry.at)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

/** Data retention: a cancelled business's customer data, erased for good once its name is typed. */
function EraseData({ tenant }: { tenant: OpsTenantDetail }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const erase = useMutation({
    mutationFn: () =>
      api<{ customers: number; messages: number; calls: number; photos: number; files: number }>(
        `/ops/tenants/${tenant.id}/erase`,
        { method: "POST", body: { confirm } },
      ),
    onSuccess: (removed) => {
      void queryClient.invalidateQueries({ queryKey: ["ops", "tenant", tenant.id] });
      setOpen(false);
      setConfirm("");
      toast.success(
        `Erased ${removed.customers} customers, ${removed.messages} messages, ${removed.calls} calls and ${removed.files} files.`,
      );
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "That didn't work."),
  });
  if (!open) {
    return (
      <Button variant="outline" className="text-destructive-strong" onClick={() => setOpen(true)}>
        Erase customer data…
      </Button>
    );
  }
  return (
    <div className="space-y-2 rounded-md border border-destructive/40 p-3">
      <p className="text-[15px]">
        This deletes every customer, job, message, call, chat and photo of {tenant.name}, for good.
        The business, its billing history, the consent ledger and the audit trail stay.
      </p>
      <Input
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
        placeholder={`Type “${tenant.name}” to confirm`}
        aria-label="Business name, to confirm"
      />
      <div className="flex gap-2">
        <Button
          variant="destructive"
          disabled={
            erase.isPending || confirm.trim().toLowerCase() !== tenant.name.trim().toLowerCase()
          }
          onClick={() => erase.mutate()}
        >
          {erase.isPending && <Spinner />} Erase for good
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function Facts({ rows }: { rows: Array<[string, string | null]> }) {
  return (
    <dl className="space-y-1 text-[15px]">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-3">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="min-w-0 truncate text-right">{value ?? "–"}</dd>
        </div>
      ))}
    </dl>
  );
}
