"use client";

import {
  HANDOFF_SHARED_FIELDS,
  type HandoffItem,
  NETWORK_TERMS,
  NETWORK_TERMS_VERSION,
  type NetworkOffer,
  type NetworkResponse,
  TRADES,
  TRADE_LABELS,
  type Trade,
} from "@leadanchor/contracts";
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconGift,
  IconMapPin,
  IconShare,
  IconUsersGroup,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { UpgradeNotice } from "@/features/billing/upgrade-notice";
import { useHydrated } from "@/hooks/use-hydrated";
import { api, isApiError } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { clockTime, timeAgo } from "@/lib/format";
import { keys, useMe, useNetwork, useNetworkOffers } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * C-24 and C-25: jobs other pros offer this business, joining the network on the partner terms,
 * the jobs it passed on, and its "refer a business" link toward free months.
 */
export function NetworkView() {
  const { data, isPending } = useNetwork();
  const { data: me } = useMe();
  const owner = useHydrated() && me?.role === "owner";
  return (
    <div className="space-y-6 pb-24 lg:pb-0">
      <PageHeader
        title="Trusted pros"
        description="Pass on jobs you can't take to pros near you, and take theirs when you have room. Customers are always told, and can stay."
      />
      {isPending || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-40 rounded-lg" />
          <Skeleton className="h-56 rounded-lg" />
        </div>
      ) : (
        <>
          {data.member && !data.member.termsOutdated && <Offers />}
          <Membership data={data} owner={owner} />
          <Passed handoffs={data.handoffs} stats={data.stats} />
          <Referrals data={data} />
        </>
      )}
    </div>
  );
}

function Section({
  id,
  title,
  description,
  children,
}: {
  id?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-lg border bg-card p-5">
      <div className="mb-4 space-y-1">
        <h2 className="text-[17px] font-bold">{title}</h2>
        {description && <p className="text-[15px] text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

/* ── Jobs offered to this business ─────────────────────────────────────── */

function Offers() {
  const { data } = useNetworkOffers();
  const offers = data?.offers ?? [];
  const open = offers.filter((offer) => offer.status === "pending");
  const recent = offers.filter((offer) => offer.status !== "pending").slice(0, 5);
  return (
    <Section
      title="Jobs offered to you"
      description={`Take one and you get the customer's ${HANDOFF_SHARED_FIELDS.join(", ").toLowerCase()}, for that job only.`}
    >
      {open.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-[15px] text-muted-foreground">
          No jobs waiting. When a pro near you passes one on, you&apos;ll get an alert.
        </p>
      ) : (
        <ul className="space-y-3">
          {open.map((offer) => (
            <OpenOffer key={offer.id} offer={offer} />
          ))}
        </ul>
      )}
      {recent.length > 0 && (
        <ul className="mt-4 divide-y rounded-lg border text-[15px]">
          {recent.map((offer) => (
            <li key={offer.id} className="flex items-center gap-3 px-4 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{offer.title}</span>
                <span className="block truncate text-sm text-muted-foreground">
                  From {offer.fromBusiness} · {timeAgo(offer.offeredAt)}
                </span>
              </span>
              {offer.status === "accepted" && offer.leadId ? (
                <Link
                  href={`/leads/${offer.leadId}`}
                  className="inline-flex min-h-11 items-center gap-1 font-semibold text-primary"
                >
                  On your board <IconChevronRight className="size-4" />
                </Link>
              ) : (
                <span className="shrink-0 text-sm text-muted-foreground">
                  {offer.status === "passed" ? "You passed" : "Taken or ended"}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function OpenOffer({ offer }: { offer: NetworkOffer }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.networkOffers });
    void queryClient.invalidateQueries({ queryKey: keys.network });
  };
  const accept = useMutation({
    mutationFn: () =>
      api<{ leadId: string }>(`/network/offers/${offer.id}/accept`, { method: "POST" }),
    onSuccess: ({ leadId }) => {
      refresh();
      toast.success("It's yours. The customer's details are on the job.");
      router.push(`/leads/${leadId}`);
    },
    onError: (error) => {
      refresh();
      toast.error(isApiError(error) ? error.message : "Couldn't take the job.");
    },
  });
  const pass = useMutation({
    mutationFn: () => api(`/network/offers/${offer.id}/pass`, { method: "POST" }),
    onSuccess: refresh,
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't pass on it."),
  });
  const busy = accept.isPending || pass.isPending;
  return (
    <li className="rounded-lg border border-signal/40 bg-background p-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="rounded-full bg-signal-subtle px-2 py-0.5 font-semibold text-signal-strong">
          {TRADE_LABELS[offer.trade]}
        </span>
        {(offer.urgency === "high" || offer.urgency === "emergency") && (
          <span className="inline-flex items-center gap-1 rounded-full bg-destructive-subtle px-2 py-0.5 font-semibold text-destructive-strong">
            <IconAlertTriangle className="size-3.5" />{" "}
            {offer.urgency === "emergency" ? "Emergency" : "Urgent"}
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <IconClock className="size-4" /> Open until {clockTime(offer.expiresAt)}
        </span>
      </div>
      <p className="mt-2 font-semibold">{offer.title}</p>
      <p className="flex items-center gap-1.5 text-[15px] text-muted-foreground">
        <IconMapPin className="size-4 shrink-0" /> {offer.area || "Near you"}
      </p>
      <p className="text-[15px] text-muted-foreground">Passed on by {offer.fromBusiness}</p>
      {offer.note && <p className="mt-2 rounded-md bg-muted p-3 text-[15px]">{offer.note}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button disabled={busy} onClick={() => accept.mutate()}>
          {accept.isPending ? <Spinner /> : <IconCheck />} Take the job
        </Button>
        <Button variant="ghost" disabled={busy} onClick={() => pass.mutate()}>
          {pass.isPending && <Spinner />} Not this one
        </Button>
      </div>
    </li>
  );
}

/* ── Joining, and the business's membership ───────────────────────────── */

function TradePicker({ value, onChange }: { value: Trade[]; onChange: (trades: Trade[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Kinds of work you take">
      {TRADES.filter((trade) => trade !== "other").map((trade) => {
        const on = value.includes(trade);
        return (
          <button
            key={trade}
            type="button"
            aria-pressed={on}
            onClick={() =>
              onChange(on ? value.filter((item) => item !== trade) : [...value, trade])
            }
            className={cn(
              "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-[15px] font-medium transition-colors",
              on
                ? "border-primary bg-primary-subtle text-primary-subtle-foreground"
                : "bg-background hover:bg-muted",
            )}
          >
            {on && <IconCheck className="size-4" />} {TRADE_LABELS[trade]}
          </button>
        );
      })}
    </div>
  );
}

function Membership({ data, owner }: { data: NetworkResponse; owner: boolean }) {
  const member = data.member;
  if (!member || member.termsOutdated) return <Join data={data} owner={owner} />;
  return <MemberSettings data={data} owner={owner} />;
}

function Join({ data, owner }: { data: NetworkResponse; owner: boolean }) {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const own = me?.tenant?.trade;
  const [trades, setTrades] = useState<Trade[]>(
    data.member?.trades ?? (own && own !== "other" ? [own] : []),
  );
  const [accepted, setAccepted] = useState(false);
  const join = useMutation({
    mutationFn: () =>
      api<NetworkResponse>("/network/join", {
        method: "POST",
        body: {
          trades,
          available: true,
          acceptTerms: accepted,
          termsVersion: NETWORK_TERMS_VERSION,
        },
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(keys.network, next);
      void queryClient.invalidateQueries({ queryKey: keys.networkOffers });
      toast.success("You're in. Jobs near you that fit will come to you.");
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't join."),
  });
  const outdated = data.member?.termsOutdated;
  return (
    <Section
      id="join"
      title={outdated ? "The partner terms changed" : "Take jobs from pros near you"}
      description={
        outdated
          ? "Read them again and accept to keep getting jobs."
          : "When a pro near you is too busy, they can pass a job to you. It's free: no fee either way, ever."
      }
    >
      <div className="space-y-5">
        {data.missing.length > 0 && (
          <div className="rounded-lg bg-signal-subtle p-4 text-[15px] text-signal-strong">
            <p className="font-semibold">Before you join, add in Settings:</p>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              {data.missing.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <Link
              href="/settings#profile"
              className="mt-2 inline-flex min-h-11 items-center font-semibold underline underline-offset-2"
            >
              Open Business profile
            </Link>
          </div>
        )}
        <div className="space-y-2">
          <p className="font-semibold">The kinds of work you take</p>
          <TradePicker value={trades} onChange={setTrades} />
        </div>
        <div className="space-y-2 rounded-lg border bg-background p-4">
          <p className="font-semibold">Partner terms</p>
          <ul className="space-y-1.5 text-[15px]">
            {NETWORK_TERMS.map((term) => (
              <li key={term} className="flex items-start gap-2">
                <IconCheck className="mt-0.5 size-4 shrink-0 text-primary" /> {term}
              </li>
            ))}
          </ul>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 pt-2 text-[15px] font-medium">
            <Checkbox
              checked={accepted}
              onCheckedChange={(checked) => setAccepted(checked === true)}
              disabled={!owner}
            />
            I accept these partner terms for my business
          </label>
        </div>
        {owner ? (
          <Button
            size="lg"
            disabled={!accepted || trades.length === 0 || data.missing.length > 0 || join.isPending}
            onClick={() => join.mutate()}
          >
            {join.isPending ? <Spinner /> : <IconUsersGroup />}{" "}
            {outdated ? "Accept and keep going" : "Join the network"}
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Only the owner can accept the partner terms.
          </p>
        )}
      </div>
    </Section>
  );
}

function MemberSettings({ data, owner }: { data: NetworkResponse; owner: boolean }) {
  const member = data.member!;
  const queryClient = useQueryClient();
  const [leaving, setLeaving] = useState(false);
  const update = useMutation({
    mutationFn: (body: { available?: boolean; trades?: Trade[] }) =>
      api<NetworkResponse>("/network", { method: "PATCH", body }),
    onSuccess: (next) => queryClient.setQueryData(keys.network, next),
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't save that."),
  });
  const leave = useMutation({
    mutationFn: () => api<NetworkResponse>("/network", { method: "DELETE" }),
    onSuccess: (next) => {
      queryClient.setQueryData(keys.network, next);
      setLeaving(false);
      toast.success("You've left the network. Jobs you already took stay on your board.");
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't leave."),
  });
  return (
    <Section
      title="Your place in the network"
      description={`You accepted the partner terms ${timeAgo(member.termsAcceptedAt)}.`}
    >
      <div className="space-y-5">
        <label className="flex items-start justify-between gap-4 rounded-lg border bg-background p-4">
          <span className="space-y-1">
            <span className="block font-semibold">Taking extra jobs</span>
            <span className="block text-[15px] text-muted-foreground">
              Switch off when you&apos;re fully booked yourself: no offers come while it&apos;s off.
            </span>
          </span>
          <Switch
            checked={member.available}
            disabled={!owner || update.isPending}
            onCheckedChange={(available) => update.mutate({ available })}
          />
        </label>
        <div className="space-y-2">
          <p className="font-semibold">The kinds of work you take</p>
          {owner ? (
            <TradePicker
              value={member.trades}
              onChange={(trades) => {
                if (trades.length === 0)
                  return toast("Keep at least one kind of work, or leave the network.");
                update.mutate({ trades });
              }}
            />
          ) : (
            <p className="text-[15px]">
              {member.trades.map((trade) => TRADE_LABELS[trade]).join(", ")}
            </p>
          )}
        </div>
        {owner &&
          (leaving ? (
            <div className="space-y-3 rounded-md border border-destructive/40 p-3">
              <p className="text-[15px]">
                Leave the network? You stop getting offers straight away.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="destructive"
                  disabled={leave.isPending}
                  onClick={() => leave.mutate()}
                >
                  {leave.isPending && <Spinner />} Leave
                </Button>
                <Button variant="ghost" onClick={() => setLeaving(false)}>
                  Stay
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => setLeaving(true)}
            >
              Leave the network
            </Button>
          ))}
      </div>
    </Section>
  );
}

/* ── Jobs this business passed on ─────────────────────────────────────── */

const HANDOFF_STATUS: Record<HandoffItem["status"], (handoff: HandoffItem) => string> = {
  offered: (handoff) => `Offered to ${handoff.offeredTo} until ${clockTime(handoff.expiresAt)}`,
  accepted: (handoff) =>
    `Taken by ${handoff.partner?.name ?? "a pro"}${handoff.convertedAt ? " · won" : ""}`,
  declined: () => "The customer stayed with you",
  expired: () => "Nobody took it",
  withdrawn: () => "You took it back",
};

function Passed({ handoffs, stats }: { handoffs: HandoffItem[]; stats: NetworkResponse["stats"] }) {
  return (
    <Section
      title="Jobs you passed on"
      description="Too busy for a job? Open it and tap “Pass to a trusted pro”. Nobody sees the customer's details until a pro accepts."
    >
      {handoffs.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-[15px] text-muted-foreground">
          Nothing passed on yet.
        </p>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            {stats.passed} passed · {stats.taken} taken · {stats.won} won by the pros who took them
            {stats.received > 0 && ` · you took ${stats.received}`}
          </p>
          <ul className="divide-y rounded-lg border">
            {handoffs.map((handoff) => (
              <li key={handoff.id}>
                <Link
                  href={`/leads/${handoff.leadId}`}
                  className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{handoff.title}</span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {HANDOFF_STATUS[handoff.status](handoff)} · {timeAgo(handoff.createdAt)}
                    </span>
                  </span>
                  <IconChevronRight className="size-5 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

/* ── C-25: referrals toward free months ───────────────────────────────── */

function Referrals({ data }: { data: NetworkResponse }) {
  const { referral } = data;
  const [copied, setCopied] = useState(false);
  const progress = referral.counted % referral.perFreeMonth;
  const share = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: "LeadAnchor",
          text: "I use LeadAnchor to catch missed calls. Try it:",
          url: referral.url,
        });
        return;
      } catch {
        // Closed the share sheet: nothing to do.
        return;
      }
    }
    if (await copyText(referral.url)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };
  return (
    <Section
      id="refer"
      title="Earn free months"
      description={`Every ${referral.perFreeMonth} referrals that turn into business take a month off your LeadAnchor bill: a pro who wins a job you passed, or a business that joins with your link and picks a plan.`}
    >
      <div className="space-y-4">
        <UpgradeNotice feature="referral_credits">
          Referrals still go through, but they don&apos;t count toward free months until then.
        </UpgradeNotice>
        <div className="space-y-2 rounded-lg bg-primary-subtle p-4 text-primary-subtle-foreground">
          <p className="flex items-center gap-2 font-semibold">
            <IconGift className="size-5" /> {progress} of {referral.perFreeMonth} toward your next
            free month
          </p>
          <div className="flex gap-1.5" aria-hidden>
            {Array.from({ length: referral.perFreeMonth }, (_, index) => (
              <span
                key={index}
                className={cn(
                  "h-2 flex-1 rounded-full",
                  index < progress ? "bg-primary" : "bg-background/70",
                )}
              />
            ))}
          </div>
          <p className="text-sm">
            {referral.monthsEarned === 0
              ? "No free months yet."
              : `${referral.monthsEarned} free ${referral.monthsEarned === 1 ? "month" : "months"} earned${
                  referral.monthsWaiting > 0
                    ? `; ${referral.monthsWaiting} comes off your first bill once you pick a plan`
                    : ", taken off your bills"
                }.`}{" "}
            {referral.joined > 0 &&
              `${referral.joined} ${referral.joined === 1 ? "business has" : "businesses have"} joined with your link.`}
          </p>
        </div>
        <div className="space-y-2">
          <p className="font-semibold">Your link for other businesses</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md border bg-background px-3 py-2.5 text-sm">
              {referral.url}
            </code>
            <Button variant="outline" onClick={() => void share()}>
              {copied ? <IconCheck /> : <IconShare />} {copied ? "Copied" : "Share"}
            </Button>
          </div>
        </div>
      </div>
    </Section>
  );
}
