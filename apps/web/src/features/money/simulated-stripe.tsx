"use client";

import type { SimCheckout, SimOnboarding, SimPortal, SimRedirect } from "@leadanchor/contracts";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconBuildingBank,
  IconCircleCheck,
  IconCreditCard,
  IconFlask,
  IconId,
  IconLock,
  IconUser,
} from "@tabler/icons-react";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { api, isApiError } from "@/lib/api";
import { amount } from "@/lib/format";
import { BrokenLink } from "./business-header";

/**
 * Stand-ins for Stripe's own hosted pages while no Stripe account is connected. In the live
 * app these pages are Stripe's: the customer's card and the owner's bank details are typed
 * there and never reach LeadAnchor. Here nothing needs typing at all.
 */
function SimulatorNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/60 p-3 text-sm text-muted-foreground">
      <IconFlask className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

export function SimulatedCheckout({ id }: { id: string }) {
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["sim-checkout", id],
    queryFn: () => api<SimCheckout>(`/dev/simulator/stripe/checkout/${id}`),
    retry: false,
  });
  const finish = useMutation({
    mutationFn: (outcome: "pay" | "decline" | "cancel") =>
      api<SimRedirect | SimCheckout>(`/dev/simulator/stripe/checkout/${id}`, {
        method: "POST",
        body: { outcome },
      }),
    onSuccess: (result) => {
      if ("redirectUrl" in result) return window.location.assign(result.redirectUrl);
      void refetch();
    },
    onError: (failure) =>
      toast.error(isApiError(failure) ? failure.message : "Something went wrong."),
  });

  if (isPending) return <PageSkeleton />;
  if (error || !data)
    return (
      <BrokenLink
        title="This checkout isn't available"
        body="It may have expired. Go back and tap Pay again."
      />
    );

  const hold = data.capture === "hold";
  const subscription = data.mode === "subscription";
  const done = data.status !== "open";
  return (
    <div className="mx-auto max-w-md space-y-6 px-5 py-10">
      <SimulatorNote>
        Simulated Stripe checkout. In the live app this is Stripe&apos;s own page, where card
        details are typed. No card details are needed here.
      </SimulatorNote>
      <section className="space-y-5 rounded-xl border bg-card p-6 shadow-sm">
        <div>
          <p className="text-[15px] text-muted-foreground">{data.businessName}</p>
          <p className="tabular font-display text-[40px] leading-tight font-semibold">
            {amount(data.amountCents)}
            {subscription && data.interval && (
              <span className="text-[17px] font-normal text-muted-foreground"> / {data.interval}</span>
            )}
          </p>
          <p className="text-[15px]">{data.description}</p>
          {subscription && data.terms.length > 0 && (
            <ul className="mt-3 space-y-1.5 rounded-md bg-muted p-3 text-sm">
              {data.terms.map((term) => (
                <li key={term}>{term}</li>
              ))}
            </ul>
          )}
          {hold && (
            <p className="mt-2 text-sm text-muted-foreground">
              This is a hold: the card is authorised now and only charged when the business collects
              it.
            </p>
          )}
        </div>

        {done ? (
          <p className="flex items-center gap-2 rounded-md bg-muted p-3 text-[15px]">
            <IconCircleCheck className="size-5 text-primary" />{" "}
            {data.status === "expired"
              ? "This checkout has expired."
              : "This checkout is complete."}
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-md border p-3">
              <IconCreditCard className="size-6 text-muted-foreground" />
              <span className="flex-1">
                <span className="block font-semibold">Test card</span>
                <span className="block text-sm text-muted-foreground">Visa •••• 4242</span>
              </span>
            </div>
            {data.lastFailure && (
              <p className="rounded-md bg-destructive-subtle p-3 text-[15px] text-destructive-strong">
                {data.lastFailure}
              </p>
            )}
            <Button
              size="lg"
              className="w-full"
              onClick={() => finish.mutate("pay")}
              disabled={finish.isPending}
            >
              {finish.isPending && finish.variables === "pay" ? <Spinner /> : <IconLock />}{" "}
              {subscription
                ? `Subscribe: ${amount(data.amountCents)} a ${data.interval ?? "month"}`
                : hold
                  ? `Hold ${amount(data.amountCents)}`
                  : `Pay ${amount(data.amountCents)}`}
            </Button>
            <div className="flex flex-wrap justify-between gap-2">
              <Button
                variant="ghost"
                onClick={() => finish.mutate("decline")}
                disabled={finish.isPending}
              >
                Try a declined card
              </Button>
              <Button
                variant="ghost"
                onClick={() => finish.mutate("cancel")}
                disabled={finish.isPending}
              >
                Cancel and go back
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export function SimulatedOnboarding({ id }: { id: string }) {
  const { data, isPending, error } = useQuery({
    queryKey: ["sim-onboarding", id],
    queryFn: () => api<SimOnboarding>(`/dev/simulator/stripe/onboarding/${id}`),
    retry: false,
  });
  const finish = useMutation({
    mutationFn: (outcome: "finish" | "later") =>
      api<SimRedirect>(`/dev/simulator/stripe/onboarding/${id}`, {
        method: "POST",
        body: { outcome },
      }),
    onSuccess: ({ redirectUrl }) => window.location.assign(redirectUrl),
    onError: (failure) =>
      toast.error(isApiError(failure) ? failure.message : "Something went wrong."),
  });

  if (isPending) return <PageSkeleton />;
  if (error || !data)
    return (
      <BrokenLink
        title="This setup link isn't available"
        body="Go back to LeadAnchor's settings and start again."
      />
    );

  const steps = [
    { icon: IconUser, title: "Business details", body: "Legal name, address and what you sell." },
    {
      icon: IconBuildingBank,
      title: "Bank account for payouts",
      body: "Where your card payments are paid out.",
    },
    {
      icon: IconId,
      title: "Identity check",
      body: "Required by law for anyone taking card payments.",
    },
  ];
  return (
    <div className="mx-auto max-w-md space-y-6 px-5 py-10">
      <SimulatorNote>
        Simulated Stripe account setup. In the live app this is Stripe&apos;s own page: your bank
        and identity details go to Stripe, never to LeadAnchor. Nothing needs typing here.
      </SimulatorNote>
      <section className="space-y-5 rounded-xl border bg-card p-6 shadow-sm">
        <div>
          <p className="text-[15px] text-muted-foreground">Set up payments for</p>
          <h1 className="font-display text-2xl font-semibold">{data.businessName}</h1>
        </div>
        <ul className="space-y-3">
          {steps.map((step) => (
            <li key={step.title} className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <step.icon className="size-[18px]" />
              </span>
              <span>
                <span className="block font-semibold">{step.title}</span>
                <span className="block text-sm text-muted-foreground">{step.body}</span>
              </span>
            </li>
          ))}
        </ul>
        {data.status === "active" ? (
          <p className="flex items-center gap-2 rounded-md bg-primary-subtle p-3 text-[15px] text-primary-subtle-foreground">
            <IconCircleCheck className="size-5" /> Setup is complete.
          </p>
        ) : null}
        <div className="space-y-2">
          <Button
            size="lg"
            className="w-full"
            onClick={() => finish.mutate("finish")}
            disabled={finish.isPending}
          >
            {finish.isPending && finish.variables === "finish" && <Spinner />}{" "}
            {data.status === "active" ? "Back to LeadAnchor" : "Finish setup"}
          </Button>
          {data.status !== "active" && (
            <Button
              variant="ghost"
              className="w-full"
              onClick={() => finish.mutate("later")}
              disabled={finish.isPending}
            >
              I&apos;ll finish later
            </Button>
          )}
        </div>
      </section>
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

const BRAND: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", amex: "Amex" };

/**
 * Stripe's hosted customer portal (C-52), simulated: the member swaps the card, sees their bills,
 * or cancels in two taps, with no reason asked and nothing in the way.
 */
export function SimulatedPortal({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false);
  const { data, isPending, error, refetch } = useQuery({
    queryKey: ["sim-portal", id],
    queryFn: () => api<SimPortal>(`/dev/simulator/stripe/portal/${id}`),
    retry: false,
  });
  const act = useMutation({
    mutationFn: (action: "cancel" | "update_card") =>
      api<SimPortal>(`/dev/simulator/stripe/portal/${id}`, { method: "POST", body: { action } }),
    onSuccess: (next, action) => {
      setConfirming(false);
      // A new card pays what was overdue straight away (as Stripe does): say so.
      const owed = (data?.invoices ?? []).filter((invoice) => invoice.status !== "paid");
      const paid = owed.filter((invoice) =>
        next.invoices.some((after) => after.id === invoice.id && after.status === "paid"),
      );
      void refetch();
      toast.success(
        action === "cancel"
          ? "Your plan is cancelled."
          : paid.length > 0
            ? `Card updated, and your overdue ${amount(paid.reduce((sum, invoice) => sum + invoice.amountCents, 0))} is paid.`
            : "Card updated.",
      );
    },
    onError: (failure) => toast.error(isApiError(failure) ? failure.message : "Something went wrong."),
  });

  if (isPending) return <PageSkeleton />;
  if (error || !data)
    return <BrokenLink title="This page has expired" body="Open the link in your receipt again." />;

  const cancelled = data.status === "canceled";
  const until = data.currentPeriodEnd
    ? new Date(data.currentPeriodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;
  return (
    <div className="mx-auto max-w-md space-y-6 px-5 py-10">
      <SimulatorNote>
        Simulated Stripe customer portal. In the live app this is Stripe&apos;s own page, so card
        details never reach {data.businessName}.
      </SimulatorNote>
      <a href={data.returnUrl} className="inline-flex min-h-11 items-center gap-1.5 text-[15px] font-semibold text-muted-foreground hover:text-foreground">
        <IconArrowLeft className="size-4" /> Back to {data.businessName}
      </a>
      <section className="space-y-4 rounded-xl border bg-card p-6 shadow-sm">
        <div>
          <p className="text-[15px] text-muted-foreground">Current plan</p>
          <p className="font-display text-[26px] leading-tight font-semibold">{data.plan.name}</p>
          <p className="tabular text-[15px]">
            {amount(data.plan.priceCents)} a {data.plan.interval}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {cancelled
              ? `Cancelled. You keep it until ${until ?? "the end of the paid period"} and won't be charged again.`
              : data.status === "paused"
                ? "Paused by the business. Nothing is charged while it's paused."
                : `Renews ${until ?? "next period"}.`}
          </p>
        </div>
        {data.status === "past_due" && (
          <p className="flex items-start gap-2 rounded-md bg-destructive-subtle p-3 text-[15px] text-destructive-strong">
            <IconAlertTriangle className="mt-0.5 size-4 shrink-0" /> Your last payment didn&apos;t go
            through. Update your card to pay it.
          </p>
        )}
        <div className="flex items-center gap-3 rounded-md border p-3">
          <IconCreditCard className="size-6 text-muted-foreground" />
          <span className="flex-1">
            <span className="block font-semibold">
              {BRAND[data.card.brand] ?? data.card.brand} •••• {data.card.last4}
            </span>
            {data.card.failing && <span className="block text-sm text-destructive-strong">This card is being declined</span>}
          </span>
          {!cancelled && (
            <Button variant="outline" size="sm" disabled={act.isPending} onClick={() => act.mutate("update_card")}>
              {act.isPending && act.variables === "update_card" && <Spinner />} Update card
            </Button>
          )}
        </div>
        <div>
          <p className="mb-2 font-semibold">Bills</p>
          <ul className="divide-y rounded-md border text-[15px]">
            {data.invoices.map((invoice) => (
              <li key={invoice.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span>{new Date(invoice.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                <span className="tabular">
                  {amount(invoice.amountCents)}{" "}
                  <span className="text-sm text-muted-foreground">
                    {invoice.status === "paid" ? "Paid" : invoice.status === "open" ? "Retrying" : "Unpaid"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        {!cancelled &&
          (confirming ? (
            <div className="space-y-3 rounded-md border border-destructive/40 p-3">
              <p className="text-[15px]">
                Cancel {data.plan.name}? You keep it until {until ?? "the end of the period"} and
                won&apos;t be charged again.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant="destructive" disabled={act.isPending} onClick={() => act.mutate("cancel")}>
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
    </div>
  );
}
