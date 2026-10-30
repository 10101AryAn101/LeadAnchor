"use client";

import {
  type MembershipActionInput,
  type MembershipDetail,
  type PlanItem,
  planPrice,
} from "@leadanchor/contracts";
import {
  IconAlertTriangle,
  IconExternalLink,
  IconFlask,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { api, isApiError } from "@/lib/api";
import { amount, formatPhone } from "@/lib/format";
import { keys, useMe, useMembership } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { MemberStatus, memberLine, shortDate } from "./membership-meta";

const DONE: Record<MembershipActionInput["action"], string> = {
  pause: "Paused. Nothing is charged until you resume it.",
  resume: "Resumed. Billing picks up at the next bill date.",
  cancel: "Cancelled. They keep the plan to the end of what they've paid for.",
  retry: "Tried the card again.",
  change_plan: "Moved to the new plan.",
};

/** C-50: one member, with the owner's actions; each goes to Stripe and is logged. */
export function MemberSheet({
  id,
  plans,
  onClose,
}: {
  id: string | null;
  plans: PlanItem[];
  onClose: () => void;
}) {
  const { data } = useMembership(id);
  return (
    <ResponsiveSheet
      open={Boolean(id)}
      onOpenChange={(open) => !open && onClose()}
      title={data?.customer.name ?? "Member"}
      description={
        data ? `${data.plan.name} · ${planPrice(data.priceCents, data.interval)}` : undefined
      }
      className="sm:max-w-lg"
    >
      {data && data.id === id ? (
        <MemberBody member={data} plans={plans} />
      ) : (
        <Skeleton className="mb-4 h-72 rounded-lg" />
      )}
    </ResponsiveSheet>
  );
}

function MemberBody({ member, plans }: { member: MembershipDetail; plans: PlanItem[] }) {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const owner = me?.role === "owner";
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [moveTo, setMoveTo] = useState("");
  const refresh = (next: MembershipDetail) => {
    queryClient.setQueryData(keys.membership(member.id), next);
    void queryClient.invalidateQueries({ queryKey: keys.memberships });
    void queryClient.invalidateQueries({ queryKey: keys.plans });
  };
  const act = useMutation({
    mutationFn: (input: MembershipActionInput) =>
      api<MembershipDetail>(`/memberships/${member.id}/action`, { method: "POST", body: input }),
    onSuccess: (next, input) => {
      refresh(next);
      setConfirmCancel(false);
      setMoveTo("");
      toast.success(
        input.action === "retry" && next.issue
          ? "The card was declined again."
          : DONE[input.action],
      );
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't do that."),
  });
  const simulate = useMutation({
    mutationFn: (step: "pay" | "decline" | "retry") =>
      step === "retry"
        ? api<MembershipDetail>(`/dev/simulator/memberships/${member.id}/retry`, { method: "POST" })
        : api<MembershipDetail>(`/dev/simulator/memberships/${member.id}/renew`, {
            method: "POST",
            body: { outcome: step },
          }),
    onSuccess: refresh,
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "The simulator couldn't do that."),
  });

  const live =
    member.status === "active" || member.status === "past_due" || member.status === "paused";
  const others = plans.filter(
    (plan) =>
      plan.status === "active" && plan.id !== member.plan.id && plan.interval === member.interval,
  );
  const facts: Array<[string, string]> = [
    ["Member since", member.startedAt ? shortDate(member.startedAt) : "—"],
    member.status === "canceled"
      ? ["Keeps it until", member.endsAt ? shortDate(member.endsAt) : "—"]
      : [
          "Next bill",
          member.nextBillAt
            ? `${shortDate(member.nextBillAt)} · ${amount(member.priceCents)}`
            : "—",
        ],
    [
      "Card",
      member.card
        ? `${member.card.brand.charAt(0).toUpperCase()}${member.card.brand.slice(1)} •••• ${member.card.last4}`
        : "—",
    ],
    [
      "Paid so far",
      `${amount(member.lifetimeCents)} · ${member.billsPaid} ${member.billsPaid === 1 ? "bill" : "bills"}`,
    ],
    ["Phone", member.customer.phone ? formatPhone(member.customer.phone) : "—"],
    ["Email", member.customer.email ?? "—"],
  ];

  return (
    <div className="space-y-5 pb-4">
      <div className="flex flex-wrap items-center gap-2">
        <MemberStatus status={member.status} />
        <span className="text-[15px] text-muted-foreground">{memberLine(member)}</span>
      </div>

      {member.issue && (
        <p className="flex items-start gap-2 rounded-lg bg-signal-subtle p-3 text-[15px] text-signal-strong">
          <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>
            Declined {member.issue.attempts} {member.issue.attempts === 1 ? "time" : "times"}.{" "}
            {member.issue.kind === "retrying" && member.issue.nextAttemptAt
              ? `Stripe tries again ${shortDate(member.issue.nextAttemptAt)}, and they've been emailed a link to update the card.`
              : "Stripe has stopped retrying. It stays past due until they update the card or you cancel it."}
          </span>
        </p>
      )}

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 rounded-lg border p-4 text-[15px]">
        {facts.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="wrap-anywhere">{value}</dd>
          </div>
        ))}
      </dl>

      {owner && live && (
        <section className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {member.status === "paused" ? (
              <Button
                variant="outline"
                disabled={act.isPending}
                onClick={() => act.mutate({ action: "resume" })}
              >
                {act.isPending && act.variables?.action === "resume" ? (
                  <Spinner />
                ) : (
                  <IconPlayerPlay />
                )}{" "}
                Resume
              </Button>
            ) : (
              <Button
                variant="outline"
                disabled={act.isPending}
                onClick={() => act.mutate({ action: "pause" })}
              >
                {act.isPending && act.variables?.action === "pause" ? (
                  <Spinner />
                ) : (
                  <IconPlayerPause />
                )}{" "}
                Pause
              </Button>
            )}
            {member.issue && (
              <Button
                variant="outline"
                disabled={act.isPending}
                onClick={() => act.mutate({ action: "retry" })}
              >
                {act.isPending && act.variables?.action === "retry" ? <Spinner /> : <IconRefresh />}{" "}
                Try the card again
              </Button>
            )}
            <Button
              variant="ghost"
              className="text-destructive-strong"
              disabled={act.isPending}
              onClick={() => setConfirmCancel(true)}
            >
              Cancel membership
            </Button>
          </div>
          {confirmCancel && (
            <div className="space-y-3 rounded-lg border border-destructive/40 p-3">
              <p className="text-[15px]">
                Cancel {member.customer.name ?? "this member"}&apos;s {member.plan.name}? They
                won&apos;t be charged again
                {member.nextBillAt && member.status !== "past_due"
                  ? ` and keep it until ${shortDate(member.nextBillAt)}`
                  : ""}
                , and they&apos;ll get an email saying so.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="destructive"
                  disabled={act.isPending}
                  onClick={() => act.mutate({ action: "cancel" })}
                >
                  {act.isPending && act.variables?.action === "cancel" && <Spinner />} Cancel
                  membership
                </Button>
                <Button variant="ghost" onClick={() => setConfirmCancel(false)}>
                  Keep it
                </Button>
              </div>
            </div>
          )}
          {member.status === "active" && others.length > 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <label className="min-w-0 flex-1 space-y-1 text-sm">
                <span className="font-medium">Move to another plan</span>
                <select
                  className="h-11 w-full rounded-md border border-input bg-background px-3 text-[15px]"
                  value={moveTo}
                  onChange={(event) => setMoveTo(event.target.value)}
                >
                  <option value="">Pick a plan</option>
                  {others.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} · {planPrice(plan.priceCents, plan.interval)}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                variant="outline"
                disabled={!moveTo || act.isPending}
                onClick={() => act.mutate({ action: "change_plan", planId: moveTo })}
              >
                {act.isPending && act.variables?.action === "change_plan" && <Spinner />} Move
              </Button>
              {moveTo && (
                <p className="w-full text-sm text-muted-foreground">
                  Stripe works out the difference for the rest of this {member.interval} and emails
                  them.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      <section className="space-y-2">
        <h3 className="font-semibold">Bills</h3>
        <ul className="divide-y rounded-lg border text-[15px]">
          {member.invoices.map((invoice) => (
            <li key={invoice.id} className="flex items-center gap-3 px-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block">
                  {shortDate(invoice.paidAt ?? invoice.createdAt)}
                  {invoice.kind === "proration" && (
                    <span className="text-muted-foreground"> · plan change</span>
                  )}
                </span>
                {invoice.status !== "paid" && invoice.failure && (
                  <span className="block text-sm text-muted-foreground">{invoice.failure}</span>
                )}
              </span>
              {invoice.leadId && (
                <Link
                  href={`/leads/${invoice.leadId}`}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-primary"
                >
                  Job <IconExternalLink className="size-3.5" />
                </Link>
              )}
              <span className="tabular w-16 text-right">{amount(invoice.amountCents)}</span>
              <span
                className={cn(
                  "w-20 text-right text-sm",
                  invoice.status === "paid"
                    ? "text-muted-foreground"
                    : "font-semibold text-signal-strong",
                )}
              >
                {invoice.status === "paid"
                  ? "Paid"
                  : invoice.status === "retrying"
                    ? "Retrying"
                    : "Unpaid"}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {member.consent && (
        <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
          Agreed {shortDate(member.consent.at)}: “{member.consent.text}” ({member.consent.version})
        </p>
      )}

      {owner && live && member.status !== "paused" && (
        <section className="space-y-2 rounded-lg border border-dashed p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            <IconFlask className="size-4" /> Simulator: Stripe&apos;s billing clock
          </p>
          <p className="text-sm text-muted-foreground">
            Ends this {member.interval} now: the next bill is charged today, and the one after is
            due a {member.interval} from today.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={simulate.isPending}
              onClick={() => simulate.mutate("pay")}
            >
              Bill the next {member.interval} now: card pays
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={simulate.isPending}
              onClick={() => simulate.mutate("decline")}
            >
              Card declines
            </Button>
            {member.issue?.kind === "retrying" && (
              <Button
                size="sm"
                variant="outline"
                disabled={simulate.isPending}
                onClick={() => simulate.mutate("retry")}
              >
                Run the next retry now
              </Button>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
