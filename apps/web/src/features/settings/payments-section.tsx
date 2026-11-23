"use client";

import { type PaymentSettings, formatPhone, paymentSettingsInput } from "@leadanchor/contracts";
import {
  IconBuildingBank,
  IconCircleCheck,
  IconCreditCard,
  IconExternalLink,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { parseAsString, useQueryState } from "nuqs";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { api, isApiError } from "@/lib/api";
import { keys, usePaymentSettings } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * Module 7: how customers pay this business. Cards go through the business's own Stripe
 * account (money lands in their bank; card numbers never touch LeadAnchor). Zelle and Venmo
 * are shown on pay links as other ways to pay.
 */
export function PaymentsSection() {
  const { data: settings, isPending } = usePaymentSettings();
  return (
    <section id="payments" className="scroll-mt-24 rounded-lg border bg-card p-5">
      <div className="mb-4 space-y-1">
        <h2 className="text-[17px] font-bold">Getting paid</h2>
        <p className="text-[15px] text-muted-foreground">
          How customers pay your deposits and bills from a quote or a pay link.
        </p>
      </div>
      {isPending || !settings ? (
        <div className="space-y-3">
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-40 rounded-lg" />
        </div>
      ) : (
        <div className="space-y-4">
          <CardPayments settings={settings} />
          <OtherWays settings={settings} />
        </div>
      )}
    </section>
  );
}

function CardPayments({ settings }: { settings: PaymentSettings }) {
  const queryClient = useQueryClient();
  const [back, setBack] = useQueryState("payments", parseAsString);
  const connect = useMutation({
    mutationFn: () => api<{ url: string }>("/payments/connect", { method: "POST" }),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "Couldn't open the payments setup."),
  });
  const refresh = useMutation({
    mutationFn: () => api<PaymentSettings>("/payments/settings/refresh", { method: "POST" }),
    onSuccess: (data) => {
      queryClient.setQueryData(keys.paymentSettings, data);
      if (data.cardPayments) toast.success("Card payments are on.");
      else if (data.status === "onboarding")
        toast("Setup isn't finished yet. You can carry on any time.");
    },
  });

  // Back from the provider's setup page: ask it where things stand, once.
  const checked = useRef(false);
  useEffect(() => {
    if (back !== "back" || checked.current) return;
    checked.current = true;
    refresh.mutate();
    void setBack(null);
  }, [back, refresh, setBack]);

  const on = settings.cardPayments;
  return (
    <div className="space-y-3 rounded-lg border bg-background p-4">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full",
            on
              ? "bg-primary-subtle text-primary-subtle-foreground"
              : "bg-muted text-muted-foreground",
          )}
        >
          <IconCreditCard className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            Card payments
            {on && (
              <span className="inline-flex h-6 items-center gap-1 rounded-full bg-primary-subtle px-2 text-[13px] font-semibold text-primary-subtle-foreground">
                <IconCircleCheck className="size-3.5" /> On
              </span>
            )}
            {settings.simulated && (
              <span className="inline-flex h-6 items-center rounded-full bg-muted px-2 text-[13px] font-medium text-muted-foreground">
                Simulator
              </span>
            )}
          </p>
          <p className="text-[15px] text-muted-foreground">
            {on
              ? "Customers can pay bills by card, and deposits can be held on their card until the work goes ahead. Payouts go to your own bank account."
              : settings.status === "onboarding"
                ? "Setup isn't finished yet. Customers can't pay by card until it is."
                : "Let customers pay deposits and bills by card. You set up your own Stripe account (your bank details go to Stripe, not to us). Takes about five minutes."}
          </p>
          {settings.simulated && (
            <p className="mt-1 text-sm text-muted-foreground">
              Stripe isn&apos;t connected yet, so a simulator plays its part: no real money moves.
            </p>
          )}
        </div>
      </div>
      {!on && settings.requirements.length > 0 && (
        <ul className="list-disc space-y-1 pl-6 text-[15px] text-muted-foreground">
          {settings.requirements.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      )}
      {!on && (
        <Button onClick={() => connect.mutate()} disabled={connect.isPending}>
          {connect.isPending ? <Spinner /> : <IconExternalLink />}{" "}
          {settings.status === "onboarding" ? "Finish setup" : "Turn on card payments"}
        </Button>
      )}
    </div>
  );
}

function OtherWays({ settings }: { settings: PaymentSettings }) {
  const queryClient = useQueryClient();
  const [zelle, setZelle] = useState(
    settings.zelle
      ? settings.zelle.startsWith("+")
        ? formatPhone(settings.zelle)
        : settings.zelle
      : "",
  );
  const [venmo, setVenmo] = useState(settings.venmo ? `@${settings.venmo}` : "");
  const [errors, setErrors] = useState<Record<string, string[]>>({});

  const save = useMutation({
    mutationFn: () => {
      const body = { zelle: zelle.trim() || null, venmo: venmo.trim() || null };
      const parsed = paymentSettingsInput.safeParse(body);
      if (!parsed.success) {
        const fields: Record<string, string[]> = {};
        for (const issue of parsed.error.issues)
          (fields[String(issue.path[0])] ??= []).push(issue.message);
        setErrors(fields);
        throw new Error("invalid");
      }
      setErrors({});
      return api<PaymentSettings>("/payments/settings", { method: "PATCH", body });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(keys.paymentSettings, data);
      toast.success("Saved. Pay links show these as other ways to pay.");
    },
    onError: (error) => {
      if (error.message === "invalid") return;
      if (isApiError(error) && error.fields) setErrors(error.fields);
      toast.error(isApiError(error) ? error.message : "Couldn't save.");
    },
  });

  const changed =
    (zelle.trim() || null) !==
      (settings.zelle
        ? settings.zelle.startsWith("+")
          ? formatPhone(settings.zelle)
          : settings.zelle
        : null) || (venmo.trim() || null) !== (settings.venmo ? `@${settings.venmo}` : null);

  return (
    <form
      className="space-y-3 rounded-lg border bg-background p-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <IconBuildingBank className="size-5" />
        </span>
        <div>
          <p className="font-semibold">Zelle and Venmo</p>
          <p className="text-[15px] text-muted-foreground">
            Shown on pay links as other ways to pay. You mark these payments received yourself,
            since they don&apos;t report back.
          </p>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={Boolean(errors.zelle)}>
          <FieldLabel htmlFor="zelle">Zelle (email or mobile)</FieldLabel>
          <Input
            id="zelle"
            autoComplete="off"
            placeholder="you@example.com"
            value={zelle}
            onChange={(event) => setZelle(event.target.value)}
          />
          <FieldError errors={(errors.zelle ?? []).map((message) => ({ message }))} />
        </Field>
        <Field data-invalid={Boolean(errors.venmo)}>
          <FieldLabel htmlFor="venmo">Venmo username</FieldLabel>
          <Input
            id="venmo"
            autoComplete="off"
            placeholder="@your-business"
            value={venmo}
            onChange={(event) => setVenmo(event.target.value)}
          />
          <FieldError errors={(errors.venmo ?? []).map((message) => ({ message }))} />
          <FieldDescription>Leave a field empty to stop showing it.</FieldDescription>
        </Field>
      </div>
      <Button type="submit" variant="outline" disabled={!changed || save.isPending}>
        {save.isPending && <Spinner />} Save
      </Button>
    </form>
  );
}
