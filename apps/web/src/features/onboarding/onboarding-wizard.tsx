"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { type TenantSummary, TRADE_LABELS, TRADES, type Trade, onboardingInput } from "@leadanchor/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type Icon,
  IconBolt,
  IconBriefcase,
  IconCar,
  IconCheck,
  IconChevronLeft,
  IconDroplet,
  IconFlask,
  IconFlower,
  IconHammer,
  IconHome,
  IconPaw,
  IconScissors,
  IconTemperature,
  IconTrees,
} from "@tabler/icons-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import type { z } from "zod";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { ForwardingGuide } from "@/features/settings/forwarding-guide";
import { api } from "@/lib/api";
import { formatPhone } from "@/lib/format";
import { showFormError } from "@/lib/forms";
import { keys } from "@/lib/queries";
import { cn } from "@/lib/utils";

const TRADE_ICONS: Record<Trade, Icon> = {
  plumbing: IconDroplet,
  electrical: IconBolt,
  hvac: IconTemperature,
  roofing: IconHome,
  handyman: IconHammer,
  landscaping: IconTrees,
  salon: IconScissors,
  grooming: IconPaw,
  spa: IconFlower,
  auto: IconCar,
  other: IconBriefcase,
};

type Values = z.input<typeof onboardingInput>;
type Output = z.output<typeof onboardingInput>;

const STEPS = ["Your business", "Where we ring you", "You're live"] as const;

export function OnboardingWizard() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [step, setStep] = useState(0);
  const [tenant, setTenant] = useState<TenantSummary | null>(null);

  const form = useForm<Values, unknown, Output>({
    resolver: zodResolver(onboardingInput),
    defaultValues: {
      businessName: "",
      trade: "plumbing",
      ownerName: "",
      ownerCell: "",
      city: "",
      state: "",
      timezone: typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "America/Chicago",
      avgJobValueDollars: 250,
    },
  });
  const trade = useWatch({ control: form.control, name: "trade" });
  const errors = form.formState.errors;

  const create = useMutation({
    mutationFn: (values: Output) => api<{ tenant: TenantSummary }>("/onboarding", { method: "POST", body: values }),
    onSuccess: ({ tenant }) => {
      setTenant(tenant);
      setStep(2);
      void queryClient.invalidateQueries({ queryKey: keys.me });
    },
    onError: (error) => showFormError(form, error),
  });

  const next = async () => {
    if (await form.trigger(["businessName", "trade", "city", "state"])) setStep(1);
  };

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-5 py-8 sm:py-12">
      <div className="flex items-center justify-between">
        <Logo />
        <span className="tabular text-sm text-muted-foreground">
          Step {step + 1} of {STEPS.length}
        </span>
      </div>

      <ol className="mt-8 grid grid-cols-3 gap-2" aria-label="Progress">
        {STEPS.map((label, index) => (
          <li key={label} className="space-y-2">
            <div className={cn("h-1 rounded-full transition-colors", index <= step ? "bg-primary" : "bg-muted")} />
            <p className={cn("text-sm", index === step ? "font-semibold text-foreground" : "text-muted-foreground")}>{label}</p>
          </li>
        ))}
      </ol>

      {step < 2 && (
        <form className="mt-10 flex flex-1 flex-col" onSubmit={form.handleSubmit((values) => create.mutate(values))} noValidate>
          {step === 0 && (
            <div className="space-y-8">
              <div className="space-y-2">
                <h1 className="font-display text-3xl font-semibold">Tell us about your business</h1>
                <p className="text-sm text-muted-foreground">We use this to greet your callers and set up your request form.</p>
              </div>
              <FieldGroup>
                <Field data-invalid={!!errors.businessName}>
                  <FieldLabel htmlFor="businessName">Business name</FieldLabel>
                  <Input id="businessName" placeholder="Rivera Plumbing & Drain"  {...form.register("businessName")} />
                  <FieldDescription>Callers hear this name when the AI Dispatcher answers.</FieldDescription>
                  <FieldError errors={[errors.businessName]} />
                </Field>
                <Field>
                  <FieldLabel>What do you do?</FieldLabel>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="radiogroup">
                    {TRADES.map((value) => {
                      const Icon = TRADE_ICONS[value];
                      const selected = trade === value;
                      return (
                        <button
                          key={value}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => form.setValue("trade", value, { shouldDirty: true })}
                          className={cn(
                            "flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-lg border border-input bg-card px-2 py-3 text-center text-sm font-medium transition-colors",
                            selected ? "border-primary bg-primary-subtle text-primary-subtle-foreground ring-1 ring-primary" : "hover:bg-muted",
                          )}
                        >
                          <Icon className={cn("size-6", selected ? "text-primary" : "text-muted-foreground")} stroke={1.75} />
                          {TRADE_LABELS[value]}
                        </button>
                      );
                    })}
                  </div>
                </Field>
                <div className="grid grid-cols-[1fr_96px] gap-3">
                  <Field>
                    <FieldLabel htmlFor="city">City</FieldLabel>
                    <Input id="city" placeholder="Austin"  {...form.register("city")} />
                  </Field>
                  <Field data-invalid={!!errors.state}>
                    <FieldLabel htmlFor="state">State</FieldLabel>
                    <Input id="state" placeholder="TX" maxLength={2} className="uppercase" {...form.register("state")} />
                  </Field>
                </div>
              </FieldGroup>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-8">
              <div className="space-y-2">
                <h1 className="font-display text-3xl font-semibold">Where should we ring you?</h1>
                <p className="text-sm text-muted-foreground">
                  Calls ring your cell first. If you can&apos;t pick up, LeadAnchor catches the caller for you.
                </p>
              </div>
              <FieldGroup>
                <Field data-invalid={!!errors.ownerName}>
                  <FieldLabel htmlFor="ownerName">Your name</FieldLabel>
                  <Input id="ownerName" autoComplete="name"  {...form.register("ownerName")} />
                  <FieldError errors={[errors.ownerName]} />
                </Field>
                <Field data-invalid={!!errors.ownerCell}>
                  <FieldLabel htmlFor="ownerCell">Your cell phone</FieldLabel>
                  <Input id="ownerCell" type="tel" inputMode="tel" autoComplete="tel" placeholder="(512) 867-5309"  {...form.register("ownerCell")} />
                  <FieldDescription>We&apos;ll also pick your new number from this area code.</FieldDescription>
                  <FieldError errors={[errors.ownerCell]} />
                </Field>
                <Field data-invalid={!!errors.avgJobValueDollars}>
                  <FieldLabel htmlFor="avgJobValueDollars">Typical job value</FieldLabel>
                  <InputGroup >
                    <InputGroupAddon>
                      <InputGroupText>$</InputGroupText>
                    </InputGroupAddon>
                    <InputGroupInput id="avgJobValueDollars" type="number" inputMode="numeric" min={25} {...form.register("avgJobValueDollars")} />
                  </InputGroup>
                  <FieldDescription>Only used to estimate open leads. &ldquo;Recovered&rdquo; always uses the real amounts you enter.</FieldDescription>
                  <FieldError errors={[errors.avgJobValueDollars]} />
                </Field>
              </FieldGroup>
            </div>
          )}

          <div className="mt-auto flex items-center gap-3 pt-10">
            {step === 1 && (
              <Button type="button" variant="ghost" size="lg" onClick={() => setStep(0)}>
                <IconChevronLeft /> Back
              </Button>
            )}
            {step === 0 ? (
              <Button type="button" size="lg" className="ml-auto" onClick={next}>
                Continue
              </Button>
            ) : (
              <Button type="submit" size="lg" className="ml-auto" disabled={create.isPending}>
                {create.isPending ? <Spinner /> : <IconCheck />} Get my LeadAnchor number
              </Button>
            )}
          </div>
        </form>
      )}

      {step === 2 && tenant && (
        <div className="mt-10 space-y-8">
          <div className="space-y-2">
            <h1 className="font-display text-3xl font-semibold">You&apos;re live, {tenant.name}.</h1>
            <p className="text-sm text-muted-foreground">This is your LeadAnchor number. Every call to it is caught — even when you can&apos;t answer.</p>
          </div>
          <div className="rounded-lg border bg-card p-6 text-center">
            <p className="text-sm text-muted-foreground">Your LeadAnchor line</p>
            <p className="tabular mt-1 font-display text-4xl font-semibold">{formatPhone(tenant.trackingNumber)}</p>
            <p className="mt-2 text-sm text-muted-foreground">Rings your cell at {formatPhone(tenant.ownerCell)} first</p>
          </div>
          <div className="space-y-3">
            <h2 className="text-[17px] font-bold">Catch calls to your current number too</h2>
            <ForwardingGuide trackingNumber={tenant.trackingNumber ?? ""} />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Button size="lg" className="flex-1" onClick={() => router.replace("/dashboard")}>
              Go to my dashboard
            </Button>
            <Button size="lg" variant="outline" className="flex-1" nativeButton={false} render={<Link href="/simulator" />}>
              <IconFlask /> Try a test call
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
