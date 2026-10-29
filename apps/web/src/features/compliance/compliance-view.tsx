"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {

  type RegistrationResponse,
  type ConsentSource,
  type ConsentType,
  registrationInput,
} from "@leadanchor/contracts";
import { IconBuildingStore, IconCircleCheck, IconClock, IconShieldCheck, IconShieldX, IconUser } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { api } from "@/lib/api";
import { formatPhone, fullDate } from "@/lib/format";
import { showFormError } from "@/lib/forms";
import { keys, useConsent, useIntegrations, useRegistration } from "@/lib/queries";
import { cn } from "@/lib/utils";

const TYPE_LABEL: Record<ConsentType, string> = {
  sms_transactional: "Texts about their job",
  sms_marketing: "Marketing texts",
  voice_marketing: "Marketing calls",
  email_marketing: "Marketing email",
};

const SOURCE_LABEL: Record<ConsentSource, string> = {
  voice_ack: "Said yes on the call",
  ivr_dtmf: "Pressed 1 on the call",
  web_form: "Ticked the box on the form",
  inbound_message: "Texted START",
  stop_keyword: "Texted STOP",
  owner_action: "Changed by you",
};


export function ComplianceView() {
  return (
    <div className="space-y-6">
      <PageHeader title="Texting and consent" description="What lets LeadAnchor text your customers — and the record that proves they agreed." />
      <RegistrationSection />
      <ConsentLedgerSection />
    </div>
  );
}

/* ── C-43: carrier registration (A2P 10DLC) ─────────────────────────────── */

function RegistrationSection() {
  const { data: registration, isPending } = useRegistration();
  const { data: integrations } = useIntegrations();
  const simulated = integrations?.find((item) => item.key === "telnyx")?.state === "simulated";
  const queryClient = useQueryClient();
  const [path, setPath] = useState<"standard" | "sole_proprietor" | null>(null);

  const approve = useMutation({
    mutationFn: () => api<RegistrationResponse>("/dev/simulator/registration/approve", { method: "POST", body: {} }),
    onSuccess: (data) => {
      queryClient.setQueryData(keys.registration, data);
      toast.success("Carrier approval simulated.");
    },
  });

  if (isPending || !registration) return <Skeleton className="h-56 rounded-lg" />;

  const approved = registration.status === "approved";
  const inProgress = registration.status === "submitted" || registration.status === "in_review";

  return (
    <section className="rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-[17px] font-bold">Carrier registration</h2>
          <p className="max-w-2xl text-[15px] text-muted-foreground">
            US carriers require every business that sends automatic texts to register (A2P 10DLC). We collect what&apos;s needed once and handle the
            registration for you.
          </p>
        </div>
        <span
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-semibold",
            approved ? "bg-primary-subtle text-primary-subtle-foreground" : inProgress ? "bg-info-subtle text-info-strong" : "bg-signal-subtle text-signal-strong",
          )}
        >
          {approved ? <IconCircleCheck className="size-4" /> : <IconClock className="size-4" />}
          {approved ? "Approved" : inProgress ? "In review" : registration.status === "rejected" ? "Needs a fix" : "Not started"}
        </span>
      </div>

      <p className="mt-4 rounded-md bg-muted p-3 text-[15px]">{registration.statusCopy}</p>

      {registration.displayName && (
        <dl className="mt-4 grid gap-3 text-[15px] sm:grid-cols-3">
          <div>
            <dt className="text-sm text-muted-foreground">Registered as</dt>
            <dd className="font-semibold">{registration.displayName}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Tax ID</dt>
            <dd className="tabular font-semibold">{registration.maskedTaxId ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">Submitted</dt>
            <dd>{registration.submittedAt ? fullDate(registration.submittedAt) : "—"}</dd>
          </div>
        </dl>
      )}

      {!approved && !inProgress && (
        <div className="mt-5 space-y-4">
          <p className="font-semibold">Does your business have an EIN (federal tax ID)?</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <PathOption
              selected={path === "standard"}
              onClick={() => setPath("standard")}
              icon={<IconBuildingStore className="size-5" />}
              title="Yes, we have an EIN"
              body="Register the business with its legal name and EIN."
            />
            <PathOption
              selected={path === "sole_proprietor"}
              onClick={() => setPath("sole_proprietor")}
              icon={<IconUser className="size-5" />}
              title="No, I'm a sole proprietor"
              body="Register with your personal details and a code sent to your phone."
            />
          </div>
          {path && <RegistrationForm path={path} />}
        </div>
      )}

      {simulated && !approved && (
        <div className="mt-5 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center">
          <p className="flex-1 text-sm text-muted-foreground">Development: Telnyx isn&apos;t connected, so approval can be simulated.</p>
          <Button variant="outline" onClick={() => approve.mutate()} disabled={approve.isPending}>
            {approve.isPending && <Spinner />} Simulate approval
          </Button>
        </div>
      )}
    </section>
  );
}

function PathOption({ selected, onClick, icon, title, body }: { selected: boolean; onClick: () => void; icon: React.ReactNode; title: string; body: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "flex gap-3 rounded-lg border border-input p-4 text-left transition-colors",
        selected ? "border-primary bg-primary-subtle text-primary-subtle-foreground ring-1 ring-primary" : "bg-background hover:bg-muted",
      )}
    >
      <span className="mt-0.5">{icon}</span>
      <span>
        <span className="block font-semibold">{title}</span>
        <span className={cn("block text-[15px]", selected ? "" : "text-muted-foreground")}>{body}</span>
      </span>
    </button>
  );
}

type RegValues = z.input<typeof registrationInput>;

function RegistrationForm({ path }: { path: "standard" | "sole_proprietor" }) {
  const queryClient = useQueryClient();
  const form = useForm<RegValues, unknown, z.output<typeof registrationInput>>({
    resolver: zodResolver(registrationInput),
    defaultValues: { path, state: "", street: "", city: "", postalCode: "" } as RegValues,
  });
  const errors = form.formState.errors as Record<string, { message?: string } | undefined>;

  const submit = useMutation({
    mutationFn: (values: z.output<typeof registrationInput>) => api<RegistrationResponse>("/compliance/registration", { method: "POST", body: values }),
    onSuccess: (data) => {
      queryClient.setQueryData(keys.registration, data);
      void queryClient.invalidateQueries({ queryKey: keys.integrations });
      toast.success("Sent for carrier review.");
    },
    onError: (error) => showFormError(form, error),
  });

  const field = (name: string, label: string, props: React.ComponentProps<typeof Input> = {}, description?: string) => (
    <Field data-invalid={!!errors[name]}>
      <FieldLabel htmlFor={name}>{label}</FieldLabel>
      <Input id={name} {...props} {...form.register(name as never)} />
      {description && <FieldDescription>{description}</FieldDescription>}
      <FieldError errors={[errors[name]]} />
    </Field>
  );

  return (
    <form key={path} className="space-y-4 rounded-lg border bg-background p-4" onSubmit={form.handleSubmit((values) => submit.mutate(values))} noValidate>
      <input type="hidden" value={path} {...form.register("path")} />
      {path === "standard" ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {field("legalName", "Legal business name", {}, "Exactly as on your IRS records — the most common reason carriers reject.")}
          {field("ein", "EIN", { inputMode: "numeric", placeholder: "12-3456789", autoComplete: "off" }, "Encrypted and only ever shown as the last 4 digits.")}
          <Field>
            <FieldLabel htmlFor="entityType">Business type</FieldLabel>
            <select id="entityType" className="h-11 rounded-md border border-input bg-background px-3 text-base" {...form.register("entityType" as never)} defaultValue="PRIVATE_PROFIT">
              <option value="PRIVATE_PROFIT">Private company</option>
              <option value="PUBLIC_PROFIT">Public company</option>
              <option value="NON_PROFIT">Non-profit</option>
            </select>
          </Field>
          {field("website", "Website (optional)", { inputMode: "url" })}
          {field("contactName", "Contact name", { autoComplete: "name" })}
          {field("contactEmail", "Contact email", { type: "email", autoComplete: "email" })}
          {field("contactPhone", "Contact phone", { type: "tel", autoComplete: "tel" })}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {field("firstName", "First name", { autoComplete: "given-name" })}
          {field("lastName", "Last name", { autoComplete: "family-name" })}
          {field("dateOfBirth", "Date of birth", { type: "date" }, "Encrypted. Carriers use it to confirm who you are.")}
          {field("mobile", "Mobile number", { type: "tel", autoComplete: "tel" }, "We'll text a one-time code to confirm it.")}
          {field("email", "Email", { type: "email", autoComplete: "email" })}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_80px_120px]">
        {field("street", "Street address", { autoComplete: "street-address" })}
        {field("city", "City", { autoComplete: "address-level2" })}
        {field("state", "State", { maxLength: 2, className: "uppercase", autoComplete: "address-level1" })}
        {field("postalCode", "ZIP", { inputMode: "numeric", autoComplete: "postal-code" })}
      </div>
      <p className="text-sm text-muted-foreground">
        We use these details only to register you with US carriers, as our privacy policy explains. Approval usually takes 1–3 weeks.
      </p>
      <Button type="submit" size="lg" disabled={submit.isPending}>
        {submit.isPending && <Spinner />} Send for review
      </Button>
    </form>
  );
}

/* ── C-27: consent ledger ───────────────────────────────────────────────── */

function ConsentLedgerSection() {
  const [phone, setPhone] = useState("");
  const [query, setQuery] = useState<string | undefined>(undefined);
  const { data, isPending } = useConsent(query);

  return (
    <section className="rounded-lg border bg-card p-5">
      <div className="space-y-1">
        <h2 className="text-[17px] font-bold">Consent record</h2>
        <p className="max-w-2xl text-[15px] text-muted-foreground">
          Every yes and every STOP, with the exact words and time. Entries can&apos;t be edited or deleted — a change of mind is a new entry.
          {data && <> Stored in the {data.backend === "firestore" ? "Firebase ledger" : "local ledger (Firebase not connected yet)"}.</>}
        </p>
      </div>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(phone.trim() || undefined);
        }}
      >
        <Input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Find a phone number" inputMode="tel" className="max-w-xs" />
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>
      {isPending ? (
        <Skeleton className="mt-4 h-40 rounded-lg" />
      ) : data && data.entries.length > 0 ? (
        <ul className="mt-4 divide-y rounded-lg border">
          {data.entries.map((entry) => (
            <li key={entry.id} className="flex gap-3 p-4">
              <span
                className={cn(
                  "flex size-9 shrink-0 items-center justify-center rounded-full",
                  entry.action === "GRANTED" ? "bg-muted text-muted-foreground" : "bg-destructive-subtle text-destructive-strong",
                )}
              >
                {entry.action === "GRANTED" ? <IconShieldCheck className="size-[18px]" /> : <IconShieldX className="size-[18px]" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <p className="font-semibold">
                    <span className="tabular">{formatPhone(entry.phone)}</span> {entry.action === "GRANTED" ? "agreed to" : "opted out of"}{" "}
                    {TYPE_LABEL[entry.type].toLowerCase()}
                  </p>
                  <span className="tabular text-sm text-muted-foreground">{fullDate(entry.recordedAt)}</span>
                </div>
                <p className="text-[15px] text-muted-foreground">
                  {SOURCE_LABEL[entry.source]}. Wording version {entry.textVersion}.
                </p>
                {entry.evidence && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{entry.evidence}</p>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 rounded-lg border border-dashed p-6 text-center text-[15px] text-muted-foreground">
          No consent recorded yet. It&apos;s captured automatically when a caller says yes to a text, or ticks the box on your request form.
        </p>
      )}
    </section>
  );
}
