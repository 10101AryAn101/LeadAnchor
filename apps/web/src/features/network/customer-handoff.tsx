"use client";

import type { PublicHandoff } from "@leadanchor/contracts";
import { IconCircleCheck, IconPhone } from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { api, isApiError } from "@/lib/api";
import { formatPhone, telHref } from "@/lib/format";

/**
 * Guardrails 1 and 4 (C-24): the customer sees which pro has their request, and can keep it with
 * the business they first asked, in one tap and without giving a reason.
 */
export function CustomerHandoff({ token, initial }: { token: string; initial: PublicHandoff }) {
  const [handoff, setHandoff] = useState(initial);
  const [confirming, setConfirming] = useState(false);
  const stay = useMutation({
    mutationFn: () =>
      api<PublicHandoff>(`/public/handoffs/${encodeURIComponent(token)}/stay`, { method: "POST" }),
    onSuccess: (data) => {
      setHandoff(data);
      setConfirming(false);
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "That didn't go through. Please try again."),
  });

  return (
    <div className="mx-auto max-w-xl space-y-6 px-5 py-8 sm:py-12">
      <p className="font-display text-[26px] leading-tight font-semibold">{handoff.businessName}</p>
      {handoff.status === "stayed" ? (
        <section className="space-y-3 rounded-lg border bg-card p-5">
          <p className="flex items-center gap-2 text-[19px] font-bold">
            <IconCircleCheck className="size-6 text-primary" /> Your request is with{" "}
            {handoff.businessName}
          </p>
          <p className="text-[15px] text-muted-foreground">
            They know you&apos;d like them to do it and will be in touch. {handoff.partnerName} has
            been told and won&apos;t contact you about it.
          </p>
        </section>
      ) : (
        <section className="space-y-4 rounded-lg border bg-card p-5">
          <p className="text-sm font-semibold tracking-wide text-primary uppercase">Your request</p>
          <p className="text-[19px] font-bold">{handoff.job}</p>
          <p className="text-[15px]">
            {handoff.businessName} is fully booked, so they asked {handoff.partnerName}, a local pro
            they trust, to take care of it. {handoff.partnerName} has your name, number, address and
            what you need, and nothing else.
          </p>
          {handoff.partnerPhone && (
            <Button
              variant="outline"
              size="lg"
              className="w-full"
              nativeButton={false}
              render={<a href={telHref(handoff.partnerPhone)} />}
            >
              <IconPhone /> Call {handoff.partnerName}: {formatPhone(handoff.partnerPhone)}
            </Button>
          )}
          {handoff.canStay ? (
            confirming ? (
              <div className="space-y-3 rounded-md border p-3">
                <p className="text-[15px]">
                  Keep your request with {handoff.businessName}? They&apos;re busy, so it may take
                  them longer.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={stay.isPending} onClick={() => stay.mutate()}>
                    {stay.isPending && <Spinner />} Yes, stay with {handoff.businessName}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirming(false)}>
                    No, that&apos;s fine
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="ghost" className="w-full" onClick={() => setConfirming(true)}>
                I&apos;d rather stay with {handoff.businessName}
              </Button>
            )
          ) : (
            <p className="text-sm text-muted-foreground">
              To change anything now, call {handoff.businessName} or {handoff.partnerName}.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
