"use client";

import {
  type BillingResponse,
  FEATURE_LABELS,
  FEATURES,
  MIN_TRIAL_LEFT_MS,
  TIER_DETAILS,
  TIERS,
  type Tier,
  type TierChoiceResult,
  WEBSITE_ADDON,
  tierAllows,
  trialDaysLeft,
} from "@leadanchor/contracts";
import {
  IconAlertTriangle,
  IconCheck,
  IconCircleCheck,
  IconClock,
  IconExternalLink,
  IconFlask,
  IconGift,
  IconWorld,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { parseAsString, useQueryStates } from "nuqs";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { api, isApiError } from "@/lib/api";
import { amount } from "@/lib/format";
import { keys, useBilling, useMe } from "@/lib/queries";
import { cn } from "@/lib/utils";

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

/** A feature's label partway through a sentence: "the AI chat assistant", "online booking". */
const inSentence = (label: string) =>
  /^AI\b/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1);

const monthly = (tier: Tier) => `${amount(TIER_DETAILS[tier].priceCents)} a month`;

/** Paying for a tier: a subscription the billing provider can switch in place. */
const subscribed = (billing: BillingResponse) =>
  billing.paidTier !== null && (billing.status === "active" || billing.status === "past_due");

/** How much of the free trial is left, in milliseconds. */
const trialLeftMs = (billing: BillingResponse) =>
  billing.trialEndsAt ? Math.max(0, Date.parse(billing.trialEndsAt) - Date.now()) : 0;

/** A tier chosen during the trial: nothing is charged until the trial's end, which is the first bill. */
const beforeFirstBill = (billing: BillingResponse) =>
  billing.periodEnd !== null &&
  billing.trialEndsAt !== null &&
  Math.abs(Date.parse(billing.periodEnd) - Date.parse(billing.trialEndsAt)) < 60_000 &&
  Date.parse(billing.periodEnd) > Date.now();

/**
 * What the business pays LeadAnchor (the Excel's tier key): Starter, Pro or Growth, a 14-day trial
 * of everything, and the provider's own page for the card, past bills and cancelling.
 */
export function PlanSection() {
  const { data: billing, isPending } = useBilling();
  const { data: me } = useMe();
  const ref = useRef<HTMLElement>(null);
  const ready = Boolean(billing);

  // Settings loads in pieces, so the browser can't jump to #plan (or the website add-on in it) on its own.
  useEffect(() => {
    const hash = window.location.hash;
    if (ready && (hash === "#plan" || hash === "#website")) {
      document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
    }
  }, [ready]);

  return (
    <section ref={ref} id="plan" className="scroll-mt-24 rounded-lg border bg-card p-5">
      <div className="mb-4 space-y-1">
        <h2 className="text-[17px] font-bold">Your LeadAnchor plan</h2>
        <p className="text-[15px] text-muted-foreground">
          What you pay LeadAnchor each month. Every plan catches your missed calls.
        </p>
      </div>
      {isPending || !billing ? (
        <div className="space-y-3">
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-72 rounded-lg" />
        </div>
      ) : (
        <PlanBody billing={billing} owner={me?.role === "owner"} />
      )}
    </section>
  );
}

function PlanBody({ billing, owner }: { billing: BillingResponse; owner: boolean }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<Tier | null>(null);
  const [back, setBack] = useQueryStates({ billing: parseAsString, checkout: parseAsString });

  const settle = (data: BillingResponse) => {
    queryClient.setQueryData(keys.billing, data);
    void queryClient.invalidateQueries({ queryKey: keys.me });
  };

  const choose = useMutation({
    mutationFn: (tier: Tier) =>
      api<TierChoiceResult>("/billing/choose", { method: "POST", body: { tier } }),
    onSuccess: (result, tier) => {
      if ("url" in result) return window.location.assign(result.url);
      setConfirming(null);
      settle(result.billing);
      toast.success(`You're on ${TIER_DETAILS[tier].name}.`);
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "Couldn't change your plan."),
  });
  const portal = useMutation({
    mutationFn: () => api<{ url: string }>("/billing/portal", { method: "POST" }),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't open billing."),
  });
  const refresh = useMutation({
    mutationFn: (checkout: string | null) =>
      api<BillingResponse>("/billing/refresh", {
        method: "POST",
        body: checkout ? { checkout } : {},
      }),
    onSuccess: (data, checkout) => {
      settle(data);
      if (!checkout) return;
      // Back from the website add-on's checkout (C-33), not a plan's.
      if (window.location.hash === "#website") {
        if (data.website.status === "active") toast.success("Your website is live. Thank you!");
        else toast("Checkout wasn't finished, so the website isn't live yet.");
        return;
      }
      if (subscribed(data))
        toast.success(`You're on ${TIER_DETAILS[data.paidTier!].name}. Thank you!`);
      else toast("Checkout wasn't finished, so your plan hasn't changed.");
    },
  });

  // Back from the provider's checkout or billing page: ask it where things stand, once.
  const checked = useRef(false);
  useEffect(() => {
    if (back.billing !== "back" || checked.current) return;
    checked.current = true;
    if (owner) refresh.mutate(back.checkout);
    void setBack({ billing: null, checkout: null });
  }, [back, owner, refresh, setBack]);

  const current = subscribed(billing) ? billing.paidTier : null;
  const canChoose = owner && billing.status !== "suspended";
  const trialLeft = trialLeftMs(billing);
  const busy = choose.isPending || portal.isPending;

  return (
    <div className="space-y-4">
      <Standing billing={billing} />

      {billing.creditCents > 0 && (
        <p className="flex items-start gap-2 rounded-lg bg-primary-subtle p-3 text-[15px] text-primary-subtle-foreground">
          <IconGift className="mt-0.5 size-[18px] shrink-0" />
          {/* One balance: free months from referrals and what's left from moving down a plan. */}
          {amount(billing.creditCents)} credit{" "}
          {billing.status === "cancelled"
            ? "stays on your account if you come back."
            : "comes off your next bills."}
        </p>
      )}

      <ul className="grid gap-3 md:grid-cols-3">
        {TIERS.map((tier) => {
          const details = TIER_DETAILS[tier];
          const mine = current === tier;
          return (
            <li
              key={tier}
              className={cn(
                "flex flex-col rounded-lg border bg-background p-4",
                mine && "border-primary ring-1 ring-primary",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-display text-xl font-semibold">{details.name}</p>
                {mine && (
                  <span className="inline-flex h-6 items-center gap-1 rounded-full bg-primary-subtle px-2 text-[13px] font-semibold text-primary-subtle-foreground">
                    <IconCircleCheck className="size-3.5" /> Your plan
                  </span>
                )}
              </div>
              <p className="tabular mt-1">
                <span className="text-2xl font-semibold">{amount(details.priceCents)}</span>
                <span className="text-muted-foreground"> / month</span>
              </p>
              <p className="mt-1 text-[15px] text-muted-foreground">{details.pitch}</p>
              <ul className="mt-3 flex-1 space-y-1.5 text-[15px]">
                {details.includes.map((item) => (
                  <li key={item} className="flex items-start gap-2">
                    <IconCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                    {item}
                  </li>
                ))}
              </ul>
              {canChoose && (
                <div className="mt-4">
                  {mine && !billing.cancelsAt ? null : mine ? (
                    <Button className="w-full" disabled={busy} onClick={() => choose.mutate(tier)}>
                      {choose.isPending && choose.variables === tier && <Spinner />} Keep{" "}
                      {details.name}
                    </Button>
                  ) : current && confirming === tier ? (
                    <SwitchConfirm
                      billing={billing}
                      from={current}
                      to={tier}
                      pending={choose.isPending}
                      onConfirm={() => choose.mutate(tier)}
                      onCancel={() => setConfirming(null)}
                    />
                  ) : current ? (
                    <Button
                      variant="outline"
                      className="w-full"
                      disabled={busy}
                      onClick={() => setConfirming(tier)}
                    >
                      Switch to {details.name}
                    </Button>
                  ) : (
                    <Button className="w-full" disabled={busy} onClick={() => choose.mutate(tier)}>
                      {choose.isPending && choose.variables === tier && <Spinner />} Choose{" "}
                      {details.name}
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {canChoose && !current && billing.status === "trial" && trialLeft > 0 && (
        <p className="flex items-start gap-2 text-sm text-muted-foreground">
          <IconClock className="mt-0.5 size-4 shrink-0" />
          {trialLeft >= MIN_TRIAL_LEFT_MS
            ? `Nothing is charged until your trial ends on ${longDate(billing.trialEndsAt!)}. The plan you choose starts straight away.`
            : "Your trial ends in under two days, so the first month is charged when you subscribe."}
        </p>
      )}
      {!owner && (
        <p className="text-sm text-muted-foreground">Only the owner can change the plan.</p>
      )}

      {owner && billing.manageable && (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={busy} onClick={() => portal.mutate()}>
            {portal.isPending ? <Spinner /> : <IconExternalLink />} Manage billing
          </Button>
          <span className="text-sm text-muted-foreground">
            Your card, past bills and cancelling.
          </span>
        </div>
      )}

      <WebsiteAddon billing={billing} owner={owner} onChange={settle} />

      {billing.simulated && (
        <p className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/60 p-3 text-sm text-muted-foreground">
          <IconFlask className="mt-0.5 size-4 shrink-0" />
          <span>
            Stripe isn&apos;t connected for LeadAnchor&apos;s own billing, so a simulator plays its
            part: no real money moves.
          </span>
        </p>
      )}

      {owner && billing.status === "trial" && process.env.NODE_ENV !== "production" && (
        <TrialClock onMoved={settle} />
      )}
    </div>
  );
}

/** C-33: the website add-on, on any plan: a one-page site built from LeadAnchor, and the Google link pointed at it. */
function WebsiteAddon({
  billing,
  owner,
  onChange,
}: {
  billing: BillingResponse;
  owner: boolean;
  onChange: (data: BillingResponse) => void;
}) {
  const site = billing.website;
  const live = site.status === "active" || site.status === "past_due";
  const buy = useMutation({
    mutationFn: () => api<{ url: string }>("/billing/website", { method: "POST" }),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "Couldn't open the checkout."),
  });
  const hosting = useMutation({
    mutationFn: (cancel: boolean) =>
      api<BillingResponse>("/billing/website/cancel", { method: "POST", body: { cancel } }),
    onSuccess: (data, cancel) => {
      onChange(data);
      toast.success(
        cancel && data.website.cancelsAt
          ? `Hosting stops on ${longDate(data.website.cancelsAt)}. The site stays up until then.`
          : "Your website stays live.",
      );
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't change that."),
  });

  return (
    <div id="website" className="scroll-mt-24 space-y-3 rounded-lg border bg-background p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="flex items-center gap-2 font-display text-xl font-semibold">
          <IconWorld className="size-5 text-muted-foreground" /> {WEBSITE_ADDON.name}
        </p>
        <p className="tabular text-[15px]">
          <span className="font-semibold">{amount(WEBSITE_ADDON.setupCents)}</span> once, then{" "}
          {amount(WEBSITE_ADDON.monthlyCents)} a month
        </p>
      </div>
      <p className="text-[15px] text-muted-foreground">An add-on for any plan.</p>
      <ul className="space-y-1.5 text-[15px]">
        {WEBSITE_ADDON.includes.map((item) => (
          <li key={item} className="flex items-start gap-2">
            <IconCheck className="mt-0.5 size-4 shrink-0 text-primary" />
            {item}
          </li>
        ))}
      </ul>
      {live ? (
        <div className="space-y-3">
          <p className="flex flex-wrap items-center gap-2 text-[15px]">
            <IconCircleCheck className="size-5 text-primary" /> Live at{" "}
            <a
              href={site.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-primary underline-offset-2 hover:underline"
            >
              {site.url.replace(/^https?:\/\//, "")}
            </a>
          </p>
          {site.status === "past_due" && (
            <p className="rounded-md bg-destructive-subtle p-3 text-[15px] text-destructive-strong">
              The last hosting payment didn&apos;t go through. Update your card in Manage billing.
            </p>
          )}
          {site.cancelsAt && (
            <p className="text-[15px] text-muted-foreground">
              Hosting stops on {longDate(site.cancelsAt)}; the site goes down then.
            </p>
          )}
          {owner && (
            <Button
              variant={site.cancelsAt ? "default" : "ghost"}
              className={cn(!site.cancelsAt && "text-muted-foreground")}
              disabled={hosting.isPending}
              onClick={() => hosting.mutate(!site.cancelsAt)}
            >
              {hosting.isPending && <Spinner />}{" "}
              {site.cancelsAt ? "Keep my website" : "Stop hosting"}
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {owner && (
            <Button disabled={buy.isPending} onClick={() => buy.mutate()}>
              {buy.isPending && <Spinner />} Add the website
            </Button>
          )}
          <Button
            variant="outline"
            nativeButton={false}
            render={<a href={`${site.url}?preview=1`} target="_blank" rel="noopener noreferrer" />}
          >
            <IconExternalLink /> Preview it
          </Button>
        </div>
      )}
    </div>
  );
}

/** Where the business stands: on the trial, paying, leaving, behind on a payment, or stopped. */
function Standing({ billing }: { billing: BillingResponse }) {
  const left = trialDaysLeft(billing.trialEndsAt);
  const paid = billing.paidTier ?? "starter";
  const [tone, title, body]: ["ok" | "warn" | "bad", string, string] =
    billing.status === "trial"
      ? billing.tier
        ? [
            left <= 3 ? "warn" : "ok",
            `Free trial: ${left} ${left === 1 ? "day" : "days"} left`,
            `You're trying everything, Growth included, until ${longDate(billing.trialEndsAt!)}. Choose the plan that fits before then.`,
          ]
        : [
            "bad",
            "Your free trial has ended",
            "Missed calls are still caught and texted, and your board and payments keep working. Booking, the assistant, campaigns and memberships are paused until you choose a plan.",
          ]
      : billing.status === "active"
        ? billing.cancelsAt
          ? [
              "warn",
              `${TIER_DETAILS[paid].name} ends on ${longDate(billing.cancelsAt)}`,
              "You won't be charged again. Keep your plan before then and nothing changes.",
            ]
          : [
              "ok",
              `You're on ${TIER_DETAILS[paid].name}`,
              beforeFirstBill(billing)
                ? `${monthly(paid)}. Your first bill is on ${longDate(billing.periodEnd!)}, when the trial ends.`
                : billing.periodEnd
                  ? `${monthly(paid)}. Next bill on ${longDate(billing.periodEnd)}.`
                  : `${monthly(paid)}.`,
            ]
        : billing.status === "past_due"
          ? [
              "bad",
              "Your last payment didn't go through",
              "Everything keeps working while it's retried. Update your card in Manage billing so nothing pauses.",
            ]
          : billing.status === "cancelled"
            ? ["bad", "Your plan has ended", "Choose a plan to switch LeadAnchor back on."]
            : ["bad", "Your account is paused", "Contact LeadAnchor support to switch it back on."];

  const Icon = tone === "ok" ? IconCircleCheck : tone === "warn" ? IconClock : IconAlertTriangle;
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg p-4",
        tone === "ok" && "bg-primary-subtle text-primary-subtle-foreground",
        tone === "warn" && "bg-signal-subtle text-signal-strong",
        tone === "bad" && "bg-destructive-subtle text-destructive-strong",
      )}
    >
      <Icon className="mt-0.5 size-5 shrink-0" />
      <div className="space-y-0.5">
        <p className="font-semibold">{title}</p>
        <p className="text-[15px]">{body}</p>
      </div>
    </div>
  );
}

/** Switching tiers changes what's charged, so it takes a second tap that says how. */
function SwitchConfirm({
  billing,
  from,
  to,
  pending,
  onConfirm,
  onCancel,
}: {
  billing: BillingResponse;
  from: Tier;
  to: Tier;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const up = TIERS.indexOf(to) > TIERS.indexOf(from);
  const lost = FEATURES.filter((feature) => tierAllows(from, feature) && !tierAllows(to, feature));
  return (
    <div className="space-y-3 rounded-md border p-3">
      <p className="text-[15px]">
        {monthly(to)} from now on.{" "}
        {beforeFirstBill(billing)
          ? `Nothing is charged before your first bill on ${longDate(billing.periodEnd!)}.`
          : up
            ? "The difference for the rest of this month is charged today."
            : `What's left of this month on ${TIER_DETAILS[from].name} comes off your next bill.`}
      </p>
      {lost.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Turns off: {lost.map((feature) => inSentence(FEATURE_LABELS[feature])).join(", ")}.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={pending} onClick={onConfirm}>
          {pending && <Spinner />} Switch to {TIER_DETAILS[to].name}
        </Button>
        <Button variant="ghost" disabled={pending} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Development only: move the trial's end to see what a business sees when it runs out. */
function TrialClock({ onMoved }: { onMoved: (data: BillingResponse) => void }) {
  const move = useMutation({
    mutationFn: (daysLeft: number) =>
      api<BillingResponse>("/dev/simulator/trial", { method: "POST", body: { daysLeft } }),
    onSuccess: (data, daysLeft) => {
      onMoved(data);
      toast(
        daysLeft === 0
          ? "Trial ended. Pro and Growth features are now locked."
          : `Trial set to ${daysLeft} days left.`,
      );
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't move the trial."),
  });
  const options = [
    { daysLeft: 14, label: "Back to 14 days" },
    { daysLeft: 3, label: "3 days left" },
    { daysLeft: 0, label: "End the trial now" },
  ];
  return (
    <div className="space-y-2 rounded-lg border border-dashed p-3">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <IconFlask className="size-4 shrink-0" /> For testing: move the end of the free trial.
      </p>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option.daysLeft}
            variant="outline"
            size="sm"
            disabled={move.isPending}
            onClick={() => move.mutate(option.daysLeft)}
          >
            {move.isPending && move.variables === option.daysLeft && <Spinner />} {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}
