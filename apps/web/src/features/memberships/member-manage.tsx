"use client";

import { MEMBERSHIP_STATUS_LABELS, type PublicMembership, planPrice } from "@leadanchor/contracts";
import {
  IconAlertTriangle,
  IconClockX,
  IconCreditCard,
  IconMailForward,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { BusinessHeader, ContactButtons } from "@/features/money/business-header";
import { api, isApiError } from "@/lib/api";

const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const stillRunning = (iso: string | null) => Boolean(iso && Date.parse(iso) > Date.now());

/**
 * C-52: the member's own page, from the link in every receipt. One tap to Stripe's portal to swap
 * the card, see bills or cancel. No login, no phone call, nothing in the way.
 */
export function MemberManage({ token, data }: { token: string; data: PublicMembership }) {
  const portal = useMutation({
    mutationFn: () =>
      api<{ url: string }>(`/public/memberships/${encodeURIComponent(token)}/portal`, {
        method: "POST",
      }),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "That didn't open. Please try again."),
  });
  const resend = useMutation({
    mutationFn: () =>
      api<{ sent: true }>(`/public/memberships/${encodeURIComponent(token)}/resend`, {
        method: "POST",
      }),
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "That didn't send. Please try again."),
  });
  const member = data.member;
  return (
    <div className="mx-auto max-w-xl space-y-6 px-5 py-8">
      <BusinessHeader business={data.business} />
      {data.expired || !member ? (
        <section className="space-y-3 rounded-xl border bg-card p-6 shadow-sm">
          <IconClockX className="size-10 text-muted-foreground" />
          <h1 className="font-display text-[24px] leading-tight font-semibold">
            This link has expired
          </h1>
          <p className="text-[15px] leading-6 text-muted-foreground">
            For your security, links to manage a plan only work for a few weeks. We can email you a
            fresh one.
          </p>
          {resend.isSuccess ? (
            <p className="rounded-lg bg-primary-subtle p-3 text-[15px] text-primary-subtle-foreground">
              Sent! Check the email you signed up with.
            </p>
          ) : (
            <Button disabled={resend.isPending} onClick={() => resend.mutate()}>
              {resend.isPending ? <Spinner /> : <IconMailForward />} Email me a new link
            </Button>
          )}
        </section>
      ) : (
        <section className="space-y-4 rounded-xl border bg-card p-6 shadow-sm">
          <div>
            <p className="text-[15px] text-muted-foreground">
              {member.firstName ? `Hi ${member.firstName}, your plan` : "Your plan"}
            </p>
            <h1 className="font-display text-[26px] leading-tight font-semibold">{member.plan}</h1>
            <p className="tabular text-[15px]">
              {planPrice(member.priceCents, member.interval)} ·{" "}
              {MEMBERSHIP_STATUS_LABELS[member.status]}
            </p>
          </div>
          <p className="text-[15px] leading-6 text-muted-foreground">
            {member.status === "canceled"
              ? stillRunning(member.endsAt)
                ? `Cancelled. You keep your plan until ${longDate(member.endsAt!)}, and you won't be charged again.`
                : "Cancelled. You won't be charged again."
              : member.status === "paused"
                ? "Paused. Nothing is charged while it's paused."
                : member.nextBillAt
                  ? `Next bill: ${longDate(member.nextBillAt)}.`
                  : null}
          </p>
          {member.status === "past_due" && (
            <p className="flex items-start gap-2 rounded-lg bg-signal-subtle p-3 text-[15px] text-signal-strong">
              <IconAlertTriangle className="mt-0.5 size-4 shrink-0" /> Your last payment didn&apos;t
              go through. Update your card to pay it.
            </p>
          )}
          <Button
            size="lg"
            className="w-full"
            disabled={portal.isPending}
            onClick={() => portal.mutate()}
          >
            {portal.isPending ? <Spinner /> : <IconCreditCard />}{" "}
            {member.status === "canceled" ? "See your bills" : "Update card, see bills or cancel"}
          </Button>
          <p className="text-center text-sm text-muted-foreground">
            Opens Stripe&apos;s secure page. Cancelling takes two taps.
          </p>
        </section>
      )}
      <div className="border-t pt-5">
        <p className="mb-3 text-[15px] text-muted-foreground">Questions?</p>
        <ContactButtons business={data.business} />
      </div>
    </div>
  );
}
