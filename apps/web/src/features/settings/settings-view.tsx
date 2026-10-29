"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { type SettingsResponse, settingsUpdateInput } from "@leadanchor/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/lib/api";
import { formatPhone } from "@/lib/format";
import { showFormError } from "@/lib/forms";
import { keys, useSettings } from "@/lib/queries";
import { ForwardingCheck } from "./forwarding-check";
import { ForwardingGuide } from "./forwarding-guide";
import { ServicesSection } from "./services-section";

/** Form shape: plain strings/numbers in the inputs, validated by the shared schema on submit. */
const formSchema = z.object({
  businessName: z.string().trim().min(2, "Enter your business name").max(80),
  ownerName: z.string().trim().min(2, "Enter your name").max(80),
  ownerCell: z.string().trim().min(7, "Enter your cell number"),
  city: z.string().trim().max(80),
  state: z.string().trim().max(2),
  licenseNumber: z.string().trim().max(40),
  insuranceCarrier: z.string().trim().max(80),
  insurancePolicyNumber: z.string().trim().max(60),
  yearsInBusiness: z.string().trim().regex(/^\d{0,3}$/, "Use a whole number"),
  googleProfileUrl: z.union([z.literal(""), z.url("Paste the full link, starting with https://").max(300)]),
  profileLinkInTexts: z.boolean(),
  avgJobValueDollars: z.coerce.number().int().min(25).max(50_000),
  ringTimeoutSecs: z.coerce.number().int().min(10).max(30),
  dispatcherEnabled: z.boolean(),
  valueProofFrequency: z.enum(["daily", "weekly", "off"]),
});
type FormValues = z.input<typeof formSchema>;

const toForm = (s: SettingsResponse): FormValues => ({
  businessName: s.businessName,
  ownerName: s.ownerName ?? "",
  ownerCell: s.ownerCell ? formatPhone(s.ownerCell) : "",
  city: s.city ?? "",
  state: s.state ?? "",
  licenseNumber: s.licenseNumber ?? "",
  insuranceCarrier: s.insuranceCarrier ?? "",
  insurancePolicyNumber: s.insurancePolicyNumber ?? "",
  yearsInBusiness: s.yearsInBusiness != null ? String(s.yearsInBusiness) : "",
  googleProfileUrl: s.googleProfileUrl ?? "",
  profileLinkInTexts: s.profileLinkInTexts,
  avgJobValueDollars: Math.round(s.avgJobValueCents / 100),
  ringTimeoutSecs: s.ringTimeoutSecs,
  dispatcherEnabled: s.dispatcherEnabled,
  valueProofFrequency: s.valueProofFrequency,
});

export function SettingsView() {
  const { data: settings, isPending } = useSettings();

  if (isPending || !settings) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-64 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }
  return (
    <div className="space-y-6 pb-24 lg:pb-0">
      <SettingsForm settings={settings} />
      <ServicesSection />
    </div>
  );
}

/** Mounted only once settings are loaded, so every control starts controlled. */
function SettingsForm({ settings }: { settings: SettingsResponse }) {
  const queryClient = useQueryClient();
  const form = useForm<FormValues, unknown, z.output<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: toForm(settings),
  });
  const errors = form.formState.errors;

  // Pick up changes made elsewhere (another device) unless the owner is mid-edit.
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(toForm(settings));
  }, [settings, form]);

  const save = useMutation({
    mutationFn: (values: z.output<typeof formSchema>) => {
      const body = settingsUpdateInput.parse({
        ...values,
        licenseNumber: values.licenseNumber || null,
        insuranceCarrier: values.insuranceCarrier || null,
        insurancePolicyNumber: values.insurancePolicyNumber || null,
        yearsInBusiness: values.yearsInBusiness ? Number(values.yearsInBusiness) : null,
        googleProfileUrl: values.googleProfileUrl || null,
      });
      return api<SettingsResponse>("/settings", { method: "PATCH", body });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(keys.settings, data);
      void queryClient.invalidateQueries({ queryKey: keys.me });
      form.reset(toForm(data));
      toast.success("Settings saved.");
    },
    onError: (error) => showFormError(form, error),
  });

  return (
    <form className="space-y-6" onSubmit={form.handleSubmit((values) => save.mutate(values))} noValidate>
      <PageHeader
        title="Settings"
        description="How LeadAnchor answers for you, and what customers see."
        actions={
          <Button type="submit" className="hidden lg:inline-flex" disabled={save.isPending || !form.formState.isDirty}>
            {save.isPending && <Spinner />} Save changes
          </Button>
        }
      />

      <Section id="forwarding" title="Your phone line" description="Put this number on Google and your ads, or forward your current number to it.">
        <div className="rounded-lg border bg-background p-4">
          <p className="text-sm text-muted-foreground">Your LeadAnchor line</p>
          <p className="tabular font-display text-3xl font-semibold">{formatPhone(settings.trackingNumber)}</p>
        </div>
        <ForwardingGuide trackingNumber={settings.trackingNumber ?? ""} />
        <ForwardingCheck settings={settings} />
      </Section>

      <Section title="When you can't pick up" description="Calls ring your cell first. If you don't answer in time, LeadAnchor takes over.">
        <FieldGroup>
          <Field orientation="horizontal" className="items-start justify-between gap-4 rounded-lg border bg-background p-4">
            <div className="space-y-1">
              <FieldLabel htmlFor="dispatcherEnabled">AI Dispatcher for new callers</FieldLabel>
              <FieldDescription>Answers in your business name, asks what they need, and texts them a request form if they agree.</FieldDescription>
            </div>
            <Controller
              control={form.control}
              name="dispatcherEnabled"
              render={({ field }) => <Switch id="dispatcherEnabled" checked={field.value} onCheckedChange={field.onChange} />}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field data-invalid={!!errors.ringTimeoutSecs}>
              <FieldLabel htmlFor="ringTimeoutSecs">Ring my cell for</FieldLabel>
              <InputGroup>
                <InputGroupInput id="ringTimeoutSecs" type="number" inputMode="numeric" min={10} max={30} {...form.register("ringTimeoutSecs")} />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>seconds</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              <FieldDescription>Keep it under your carrier voicemail (usually 20–25 seconds).</FieldDescription>
              <FieldError errors={[errors.ringTimeoutSecs]} />
            </Field>
            <Field data-invalid={!!errors.avgJobValueDollars}>
              <FieldLabel htmlFor="avgJobValueDollars">Typical job value</FieldLabel>
              <InputGroup>
                <InputGroupAddon>
                  <InputGroupText>$</InputGroupText>
                </InputGroupAddon>
                <InputGroupInput id="avgJobValueDollars" type="number" inputMode="numeric" {...form.register("avgJobValueDollars")} />
              </InputGroup>
              <FieldDescription>Only used for &ldquo;est.&rdquo; values on open jobs.</FieldDescription>
              <FieldError errors={[errors.avgJobValueDollars]} />
            </Field>
          </div>
        </FieldGroup>
      </Section>

      <Section title="Business profile" description="Shown on the request form customers open. Licence and insurance are your own statements — we show them as “Licensed & Insured”, never “Verified”.">
        <FieldGroup>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField form={form} name="businessName" label="Business name" />
            <TextField form={form} name="ownerName" label="Your name" />
            <TextField form={form} name="ownerCell" label="Your cell (we ring this)" type="tel" />
            <div className="grid grid-cols-[1fr_96px] gap-3">
              <TextField form={form} name="city" label="City" />
              <TextField form={form} name="state" label="State" />
            </div>
            <TextField form={form} name="licenseNumber" label="Licence number (optional)" />
            <TextField form={form} name="insuranceCarrier" label="Insurance carrier (optional)" />
            <TextField form={form} name="insurancePolicyNumber" label="Insurance policy number (optional)" />
            <TextField form={form} name="yearsInBusiness" label="Years in business (optional)" type="number" />
            <div className="sm:col-span-2">
              <TextField form={form} name="googleProfileUrl" label="Your Google listing link (optional)" type="url" />
            </div>
          </div>
          <Field orientation="horizontal" className="items-start justify-between gap-4 rounded-lg border bg-background p-4">
            <div className="space-y-1">
              <FieldLabel htmlFor="profileLinkInTexts">Add my profile link to a new customer&apos;s first text</FieldLabel>
              <FieldDescription>
                Your public page shows your licence, insurance, services and the job photos you choose.{" "}
                <a href={settings.profileUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-primary underline-offset-2 hover:underline">
                  View my profile
                </a>
              </FieldDescription>
            </div>
            <Controller
              control={form.control}
              name="profileLinkInTexts"
              render={({ field }) => <Switch id="profileLinkInTexts" checked={field.value} onCheckedChange={field.onChange} />}
            />
          </Field>
        </FieldGroup>
      </Section>

      <Section
        title="Your summary"
        description="A short note of what LeadAnchor caught for you and what it was worth. It arrives at 8 AM your time, as an alert in the app and by email."
      >
        <Controller
          control={form.control}
          name="valueProofFrequency"
          render={({ field }) => (
            <ToggleGroup value={[field.value]} onValueChange={(value) => value[0] && field.onChange(value[0])} variant="outline" aria-label="Summary frequency">
              <ToggleGroupItem value="daily" className="px-4">
                Daily
              </ToggleGroupItem>
              <ToggleGroupItem value="weekly" className="px-4">
                Weekly
              </ToggleGroupItem>
              <ToggleGroupItem value="off" className="px-4">
                Off
              </ToggleGroupItem>
            </ToggleGroup>
          )}
        />
      </Section>

      <div className="pb-safe fixed inset-x-0 bottom-14 z-30 border-t bg-background px-4 pt-3 lg:hidden">
        <Button type="submit" size="lg" className="w-full" disabled={save.isPending || !form.formState.isDirty}>
          {save.isPending && <Spinner />} Save changes
        </Button>
      </div>
    </form>
  );
}

function Section({ id, title, description, children }: { id?: string; title: string; description?: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-lg border bg-card p-5">
      <div className="mb-4 space-y-1">
        <h2 className="text-[17px] font-bold">{title}</h2>
        {description && <p className="text-[15px] text-muted-foreground">{description}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function TextField({
  form,
  name,
  label,
  type = "text",
}: {
  form: ReturnType<typeof useForm<FormValues, unknown, z.output<typeof formSchema>>>;
  name:
    | "businessName"
    | "ownerName"
    | "ownerCell"
    | "city"
    | "state"
    | "licenseNumber"
    | "insuranceCarrier"
    | "insurancePolicyNumber"
    | "yearsInBusiness"
    | "googleProfileUrl";
  label: string;
  type?: string;
}) {
  const error = form.formState.errors[name];
  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <Input id={name} type={type} {...form.register(name)} />
      <FieldError errors={[error]} />
    </Field>
  );
}
