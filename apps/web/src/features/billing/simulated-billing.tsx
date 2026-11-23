"use client";

import type {
  SimRedirect,
  SimTierCheckout,
  SimTierPortal,
  SimTierPortalAction,
} from "@leadanchor/contracts";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconCircleCheck,
  IconCreditCard,
  IconFlask,
  IconGift,
  IconLock,
} from "@tabler/icons-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { BrokenLink } from "@/features/money/business-header";
import { api, isApiError } from "@/lib/api";
import { amount } from "@/lib/format";

/**
 * Stand-ins for Stripe's checkout and billing pages for LeadAnchor's own plans, used while no
 * Stripe key is set. In the live app these are Stripe's pages: the owner's card is typed there
 * and never reaches LeadAnchor. Here nothing needs typing.
 */
const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

function SimulatorNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/60 p-3 text-sm text-muted-foreground">
      <IconFlask className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function TestCard() {
  return (
    <div className="flex items-center gap-3 rounded-md border p-3">
      <IconCreditCard className="size-6 text-muted-foreground" />
      <span className="flex-1">
        <span className="block font-semibold">Test card</span>
        <span className="block text-sm text-muted-foreground">Visa •••• 4242</span>
      </span>
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-md space-y-4 px-5 py-10">
      <Skeleton className="h-14 rounded-lg" />
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

export function SimulatedTierCheckout({ id }: { id: string }) {
  const [failure, setFailure] = useState<string | null>(null);
  const { data, isPending, error } = useQuery({
    queryKey: ["sim-tier-checkout", id],
    queryFn: () => api<SimTierCheckout>(`/dev/simulator/billing/checkout/${id}`),
    retry: false,
  });
  const finish = useMutation({
    mutationFn: (outcome: "pay" | "decline") =>
      api<SimRedirect>(`/dev/simulator/billing/checkout/${id}`, {
        method: "POST",
        body: { outcome },
      }),
    onSuccess: ({ redirectUrl }) => window.location.assign(redirectUrl),
    onError: (problem) =>
      setFailure(isApiError(problem) ? problem.message : "Something went wrong."),
  });

  if (isPending) return <PageSkeleton />;
  if (error || !data)
    return (
      <BrokenLink
        title="This checkout isn't available"
        body="Go back to Settings in LeadAnchor and choose your plan again."
      />
    );

  return (
    <div className="mx-auto max-w-md space-y-6 px-5 py-10">
      <SimulatorNote>
        Simulated Stripe checkout for your LeadAnchor plan. In the live app this is Stripe&apos;s
        own page, where you type your card. No card details are needed here.
      </SimulatorNote>
      <section className="space-y-5 rounded-xl border bg-card p-6 shadow-sm">
        <div>
          <p className="text-[15px] text-muted-foreground">
            {data.product === "website" ? data.tierName : `LeadAnchor ${data.tierName}`} for{" "}
            {data.businessName}
          </p>
          <p className="tabular font-display text-[40px] leading-tight font-semibold">
            {amount(data.priceCents)}
            <span className="text-[17px] font-normal text-muted-foreground"> / month</span>
          </p>
          <p className="mt-2 rounded-md bg-muted p-3 text-sm">
            {data.setupCents
              ? `Today: ${amount(data.setupCents + data.priceCents)} (${amount(data.setupCents)} to set up, and the first month's hosting). Then ${amount(data.priceCents)} a month. Stop hosting any time in Settings.`
              : data.firstChargeAt
                ? `Nothing today. Your first bill is on ${longDate(data.firstChargeAt)}, when your free trial ends, then every month. Cancel any time before then and you pay nothing.`
                : "Charged today, then every month on the same date. Cancel any time: you keep the plan until the end of the month you paid for."}
          </p>
        </div>

        {data.status === "complete" ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 rounded-md bg-muted p-3 text-[15px]">
              <IconCircleCheck className="size-5 text-primary" /> This checkout is complete.
            </p>
            <Button
              size="lg"
              className="w-full"
              nativeButton={false}
              render={<a href={data.cancelUrl} />}
            >
              Back to LeadAnchor
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <TestCard />
            {failure && (
              <p className="rounded-md bg-destructive-subtle p-3 text-[15px] text-destructive-strong">
                {failure}
              </p>
            )}
            <Button
              size="lg"
              className="w-full"
              onClick={() => {
                setFailure(null);
                finish.mutate("pay");
              }}
              disabled={finish.isPending}
            >
              {finish.isPending && finish.variables === "pay" ? <Spinner /> : <IconLock />}{" "}
              {data.setupCents
                ? `Pay ${amount(data.setupCents + data.priceCents)}`
                : data.firstChargeAt
                  ? "Start my plan"
                  : `Subscribe: ${amount(data.priceCents)} a month`}
            </Button>
            <div className="flex flex-wrap justify-between gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setFailure(null);
                  finish.mutate("decline");
                }}
                disabled={finish.isPending}
              >
                Try a declined card
              </Button>
              <Button variant="ghost" nativeButton={false} render={<a href={data.cancelUrl} />}>
                Cancel and go back
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

const ACTION_DONE: Record<SimTierPortalAction, string> = {
  cancel: "Your plan will end at the end of the paid month.",
  resume: "Your plan carries on.",
  fail_next: "The next payment will be declined.",
  renew: "The next bill ran.",
};

export function SimulatedTierPortal({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false);
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["sim-tier-portal", id],
    queryFn: () => api<SimTierPortal>(`/dev/simulator/billing/portal/${id}`),
    retry: false,
  });
  const act = useMutation({
    mutationFn: (action: SimTierPortalAction) =>
      api<SimTierPortal>(`/dev/simulator/billing/portal/${id}`, {
        method: "POST",
        body: { action },
      }),
    onSuccess: (next, action) => {
      setConfirming(false);
      void refetch();
      if (action === "renew" && next.subscription?.status === "past_due")
        toast.error("The bill was declined. The plan is now past due.");
      else toast.success(ACTION_DONE[action]);
    },
    onError: (problem) =>
      toast.error(isApiError(problem) ? problem.message : "Something went wrong."),
  });

  if (isPending) return <PageSkeleton />;
  if (error || !data)
    return (
      <BrokenLink
        title="This billing page has expired"
        body="Open it again from Settings in LeadAnchor."
      />
    );

  const plan = data.subscription;
  const cancelled = plan?.status === "canceled";
  return (
    <div className="mx-auto max-w-md space-y-6 px-5 py-10">
      <SimulatorNote>
        Simulated Stripe billing page. In the live app this is Stripe&apos;s own page, so your card
        details never reach LeadAnchor.
      </SimulatorNote>
      <a
        href={data.returnUrl}
        className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-muted-foreground hover:text-foreground"
      >
        <IconArrowLeft className="size-4" /> Back to LeadAnchor
      </a>
      <section className="space-y-4 rounded-xl border bg-card p-6 shadow-sm">
        <div>
          <p className="text-[15px] text-muted-foreground">{data.email}</p>
          {plan ? (
            <>
              <p className="font-display text-[26px] leading-tight font-semibold">
                LeadAnchor {plan.tierName}
              </p>
              <p className="tabular text-[15px]">{amount(plan.priceCents)} a month</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {cancelled
                  ? "Cancelled. Nothing more is charged."
                  : plan.cancelAtPeriodEnd
                    ? `Ends on ${longDate(plan.periodEnd)}. You won't be charged again.`
                    : `Renews on ${longDate(plan.periodEnd)}.`}
              </p>
            </>
          ) : (
            <p className="font-display text-[26px] leading-tight font-semibold">No plan yet</p>
          )}
        </div>
        {plan?.status === "past_due" && (
          <p className="flex items-start gap-2 rounded-md bg-destructive-subtle p-3 text-[15px] text-destructive-strong">
            <IconAlertTriangle className="mt-0.5 size-4 shrink-0" /> Your last payment didn&apos;t
            go through. It&apos;s retried in a few days.
          </p>
        )}
        {data.creditCents > 0 && (
          <p className="flex items-start gap-2 rounded-md bg-primary-subtle p-3 text-[15px] text-primary-subtle-foreground">
            <IconGift className="mt-0.5 size-4 shrink-0" /> {amount(data.creditCents)} credit comes
            off your next bills.
          </p>
        )}
        <TestCard />
        {plan &&
          !cancelled &&
          (plan.cancelAtPeriodEnd ? (
            <Button
              className="w-full"
              disabled={act.isPending}
              onClick={() => act.mutate("resume")}
            >
              {act.isPending && act.variables === "resume" && <Spinner />} Don&apos;t cancel
            </Button>
          ) : confirming ? (
            <div className="space-y-3 rounded-md border border-destructive/40 p-3">
              <p className="text-[15px]">
                Cancel LeadAnchor {plan.tierName}? You keep it until {longDate(plan.periodEnd)} and
                won&apos;t be charged again.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="destructive"
                  disabled={act.isPending}
                  onClick={() => act.mutate("cancel")}
                >
                  {act.isPending && act.variables === "cancel" && <Spinner />} Cancel plan
                </Button>
                <Button variant="ghost" onClick={() => setConfirming(false)}>
                  Keep plan
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="outline" className="w-full" onClick={() => setConfirming(true)}>
              Cancel plan
            </Button>
          ))}
      </section>

      {plan && !cancelled && (
        <section className="space-y-2 rounded-lg border border-dashed p-4">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <IconFlask className="size-4 shrink-0" /> For testing: what Stripe would do over time.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={act.isPending}
              onClick={() => act.mutate("renew")}
            >
              {act.isPending && act.variables === "renew" && <Spinner />} Run the next bill now
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={act.isPending}
              onClick={() => act.mutate("fail_next")}
            >
              {act.isPending && act.variables === "fail_next" && <Spinner />} Make the next bill
              fail
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
