"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  type ConsentSource,
  type ConsentType,
  REGISTRATION_ID_RETENTION_DAYS,
  REGISTRY_TEST_OUTCOMES,
  type RegistrationPath,
  type RegistrationResponse,
  type RegistrationStage,
  type RegistrationStatus,
  type RegistryTestOutcome,
  registrationCodeInput,
  registrationInput,
} from "@leadanchor/contracts";
import {
  type Icon,
  IconAlertTriangle,
  IconArrowBackUp,
  IconBuildingStore,
  IconCheck,
  IconCircleCheck,
  IconClock,
  IconDeviceMobileMessage,
  IconPlayerSkipForward,
  IconRefresh,
  IconShieldCheck,
  IconShieldX,
  IconUser,
  IconX,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, isApiError } from "@/lib/api";
import { formatPhone, fullDate } from "@/lib/format";
import { showFormError } from "@/lib/forms";
import { keys, useConsent, useRegistration } from "@/lib/queries";
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

const PILL: Record<RegistrationStatus, { label: string; tone: string; icon: Icon }> = {
  not_started: { label: "Not started", tone: "bg-signal-subtle text-signal-strong", icon: IconClock },
  submitted: { label: "Sending", tone: "bg-info-subtle text-info-strong", icon: IconClock },
  verify_mobile: { label: "Confirm your mobile", tone: "bg-signal-subtle text-signal-strong", icon: IconDeviceMobileMessage },
  in_review: { label: "In review", tone: "bg-info-subtle text-info-strong", icon: IconClock },
  approved: { label: "Approved", tone: "bg-primary-subtle text-primary-subtle-foreground", icon: IconCircleCheck },
  rejected: { label: "Needs a fix", tone: "bg-signal-subtle text-signal-strong", icon: IconAlertTriangle },
};

const STEPS: Array<{ stage: RegistrationStage; title: string; body: (soleProprietor: boolean) => string }> = [
  {
    stage: "brand",
    title: "Business check",
    body: (soleProprietor) => (soleProprietor ? "Carriers confirm who you are." : "Carriers confirm your business is real and matches its EIN."),
  },
  { stage: "campaign", title: "Texting plan review", body: () => "They review how LeadAnchor will text your customers." },
  { stage: "number", title: "Number connected", body: () => "Your LeadAnchor number is linked to the approved plan." },
];

function RegistrationSection() {
  const { data: registration, isPending } = useRegistration();
  const [path, setPath] = useState<RegistrationPath | null>(null);

  if (isPending || !registration) return <Skeleton className="h-56 rounded-lg" />;

  const { status, stage } = registration;
  const pill = PILL[status];
  const fixDetails = status === "rejected" && stage === "brand";
  const reviewing = status === "submitted" || status === "in_review" || (status === "rejected" && stage !== "brand");
  const chosenPath = path ?? (fixDetails ? registration.path : null);

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
        <span className={cn("inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-semibold", pill.tone)}>
          <pill.icon className="size-4" />
          {pill.label}
        </span>
      </div>

      {status === "rejected" && registration.statusReason ? (
        <p className="mt-4 flex gap-2.5 rounded-md bg-signal-subtle p-3 text-[15px] text-signal-strong">
          <IconAlertTriangle className="mt-0.5 size-[18px] shrink-0" />
          {registration.statusReason}
        </p>
      ) : status !== "verify_mobile" ? (
        <p className="mt-4 rounded-md bg-muted p-3 text-[15px]">{registration.statusCopy}</p>
      ) : null}

      {status === "verify_mobile" && <CodeEntry registration={registration} />}
      {reviewing && <ReviewProgress registration={registration} />}
      {status === "rejected" && stage !== "brand" && <RetryButton />}
      {registration.displayName && status !== "not_started" && !fixDetails && <RegistrationDetails registration={registration} />}

      {(status === "not_started" || fixDetails) && (
        <div className="mt-5 space-y-4">
          <p className="font-semibold">Does your business have an EIN (federal tax ID)?</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <PathOption
              selected={chosenPath === "standard"}
              onClick={() => setPath("standard")}
              icon={<IconBuildingStore className="size-5" />}
              title="Yes, we have an EIN"
              body="Register the business with its legal name and EIN."
            />
            <PathOption
              selected={chosenPath === "sole_proprietor"}
              onClick={() => setPath("sole_proprietor")}
              icon={<IconUser className="size-5" />}
              title="No, I'm a sole proprietor"
              body="Register with your personal details and a code sent to your phone."
            />
          </div>
          {chosenPath && (
            <RegistrationForm
              key={chosenPath}
              path={chosenPath}
              prefill={registration.path === chosenPath ? registration.prefill : null}
              simulated={registration.simulated}
            />
          )}
        </div>
      )}

      {registration.simulated && <SimulatorTools registration={registration} />}
    </section>
  );
}

/** Where the carriers' review stands, step by step (C-43 AC 4: plain words, never raw states). */
function ReviewProgress({ registration }: { registration: RegistrationResponse }) {
  const current = registration.status === "submitted" ? 0 : STEPS.findIndex((step) => step.stage === (registration.stage ?? "brand"));
  const failed = registration.status === "rejected";
  const soleProprietor = registration.path === "sole_proprietor";

  return (
    <div className="mt-4 space-y-4">
      <ol>
        {STEPS.map((step, index) => {
          const state = index < current ? "done" : index > current ? "todo" : failed ? "failed" : "active";
          return (
            <li key={step.stage} className="relative flex gap-3 pb-5 last:pb-0">
              {index < STEPS.length - 1 && (
                <span aria-hidden className={cn("absolute top-9 bottom-1 left-4 w-px", state === "done" ? "bg-primary" : "bg-border")} />
              )}
              <span
                className={cn(
                  "relative flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
                  state === "done" && "border-primary bg-primary text-primary-foreground",
                  state === "active" && "border-transparent bg-info-subtle text-info-strong",
                  state === "failed" && "border-transparent bg-destructive-subtle text-destructive-strong",
                  state === "todo" && "bg-background text-muted-foreground",
                )}
              >
                {state === "done" ? <IconCheck className="size-4" /> : state === "failed" ? <IconX className="size-4" /> : state === "active" ? <IconClock className="size-4" /> : index + 1}
              </span>
              <div className="min-w-0 pt-1">
                <p className={cn("font-semibold", state === "todo" && "text-muted-foreground")}>
                  {step.title}
                  {state === "active" && <span className="font-normal text-muted-foreground"> · in progress</span>}
                  {state === "failed" && <span className="font-normal text-destructive-strong"> · turned down</span>}
                </p>
                <p className="text-[15px] text-muted-foreground">{step.body(soleProprietor)}</p>
              </div>
            </li>
          );
        })}
      </ol>
      {!failed && (
        <p className="text-sm text-muted-foreground">
          {registration.simulated
            ? "Simulator: each step takes a few seconds here. Real carriers take 1–3 weeks."
            : "We check with the carriers every 15 minutes and alert you as soon as there's news."}
        </p>
      )}
    </div>
  );
}

/** Sole proprietors: the carriers text a one-time code to confirm the mobile number (C-43 AC 3). */
function CodeEntry({ registration }: { registration: RegistrationResponse }) {
  const queryClient = useQueryClient();
  const form = useForm<{ code: string }>({ resolver: zodResolver(registrationCodeInput), defaultValues: { code: "" } });
  const simulatedCode = useQuery({
    queryKey: ["sim-registration-code"],
    queryFn: () => api<{ code: string | null }>("/dev/simulator/registration/code"),
    enabled: registration.simulated,
  });

  const confirm = useMutation({
    mutationFn: (values: { code: string }) => api<RegistrationResponse>("/compliance/registration/code", { method: "POST", body: values }),
    onSuccess: (data) => {
      queryClient.setQueryData(keys.registration, data);
      toast.success("Mobile confirmed. The carriers have your details.");
    },
    onError: (error) => showFormError(form, error),
  });
  const resend = useMutation({
    mutationFn: () => api<RegistrationResponse>("/compliance/registration/code/resend", { method: "POST", body: {} }),
    onSuccess: () => toast.success("New code on its way."),
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't send a new code."),
  });

  return (
    <form className="mt-4 space-y-4 rounded-lg border bg-background p-4" onSubmit={form.handleSubmit((values) => confirm.mutate(values))} noValidate>
      <div className="flex gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-signal-subtle text-signal-strong">
          <IconDeviceMobileMessage className="size-[18px]" />
        </span>
        <div>
          <p className="font-semibold">Enter the code from your text</p>
          <p className="text-[15px] text-muted-foreground">
            The carriers texted a code to your mobile{registration.mobileLast4 ? ` ending in ${registration.mobileLast4}` : ""}. It confirms the number is yours.
          </p>
        </div>
      </div>
      <Field data-invalid={!!form.formState.errors.code} className="max-w-xs">
        <FieldLabel htmlFor="code">Code</FieldLabel>
        <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={10} className="tabular text-lg tracking-[0.3em]" {...form.register("code")} />
        <FieldError errors={[form.formState.errors.code]} />
      </Field>
      {registration.simulated && simulatedCode.data?.code && (
        <p className="text-sm text-muted-foreground">
          Simulator: the code is <span className="tabular font-semibold text-foreground">{simulatedCode.data.code}</span>
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="lg" disabled={confirm.isPending}>
          {confirm.isPending && <Spinner />} Confirm
        </Button>
        <Button type="button" variant="ghost" size="lg" onClick={() => resend.mutate()} disabled={resend.isPending}>
          Text me a new code
        </Button>
      </div>
    </form>
  );
}

/** The texting plan or the number hookup was turned down: the owner's details are fine, so just file it again. */
function RetryButton() {
  const queryClient = useQueryClient();
  const retry = useMutation({
    mutationFn: () => api<RegistrationResponse>("/compliance/registration/retry", { method: "POST", body: {} }),
    onSuccess: (data) => {
      queryClient.setQueryData(keys.registration, data);
      toast.success("Sent to the carriers again.");
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't send it again."),
  });
  return (
    <Button className="mt-4" size="lg" onClick={() => retry.mutate()} disabled={retry.isPending}>
      {retry.isPending ? <Spinner /> : <IconRefresh />} Send again
    </Button>
  );
}

function RegistrationDetails({ registration }: { registration: RegistrationResponse }) {
  const what = registration.path === "sole_proprietor" ? "date of birth" : "tax ID";
  return (
    <div className="mt-4 space-y-3">
      <dl className="grid gap-3 text-[15px] sm:grid-cols-3">
        <div>
          <dt className="text-sm text-muted-foreground">Registered as</dt>
          <dd className="font-semibold">{registration.displayName}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Tax ID</dt>
          <dd className="tabular font-semibold">{registration.maskedTaxId ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">{registration.approvedAt ? "Approved" : "Submitted"}</dt>
          <dd>{registration.approvedAt ? fullDate(registration.approvedAt) : registration.submittedAt ? fullDate(registration.submittedAt) : "—"}</dd>
        </div>
      </dl>
      {(registration.idDeletedAt || registration.idDeleteAfter) && (
        <p className="flex gap-2 text-sm text-muted-foreground">
          <IconShieldCheck className="mt-0.5 size-4 shrink-0" />
          {registration.idDeletedAt
            ? `The full ${what} was deleted on ${fullDate(registration.idDeletedAt)}. We keep only what's shown above.`
            : `The full ${what} stays encrypted until ${fullDate(registration.idDeleteAfter!)}, then it's deleted. We keep only what's shown above.`}
        </p>
      )}
    </div>
  );
}

/** Development: the carriers are played by a local simulator. */
function SimulatorTools({ registration }: { registration: RegistrationResponse }) {
  const queryClient = useQueryClient();
  const onDone = (message: string) => (data: RegistrationResponse) => {
    queryClient.setQueryData(keys.registration, data);
    void queryClient.invalidateQueries({ queryKey: keys.integrations });
    toast.success(message);
  };
  const approve = useMutation({
    mutationFn: () => api<RegistrationResponse>("/dev/simulator/registration/approve", { method: "POST", body: {} }),
    onSuccess: onDone("Carrier approval simulated."),
  });
  const reset = useMutation({
    mutationFn: () => api<RegistrationResponse>("/dev/simulator/registration/reset", { method: "POST", body: {} }),
    onSuccess: onDone("Registration cleared. Texting is off until it's approved again."),
  });

  return (
    <div className="mt-5 flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center">
      <p className="flex-1 text-sm text-muted-foreground">
        Development: the carriers are simulated, so a review takes about a minute.
        {registration.status !== "not_started" && " Start over to try registration again; texting turns off until it's approved."}
      </p>
      <div className="flex flex-wrap gap-2">
        {registration.status !== "not_started" && (
          <Button variant="ghost" onClick={() => reset.mutate()} disabled={reset.isPending}>
            {reset.isPending ? <Spinner /> : <IconArrowBackUp />} Start over
          </Button>
        )}
        {registration.status !== "approved" && (
          <Button variant="outline" onClick={() => approve.mutate()} disabled={approve.isPending}>
            {approve.isPending ? <Spinner /> : <IconPlayerSkipForward />} Skip the wait
          </Button>
        )}
      </div>
    </div>
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

const OUTCOME_LABEL: Record<RegistryTestOutcome, string> = {
  approve: "Approve",
  reject_brand: "Reject the business",
  reject_campaign: "Reject the texting plan",
};

function RegistrationForm({ path, prefill, simulated }: { path: RegistrationPath; prefill: Record<string, string> | null; simulated: boolean }) {
  const queryClient = useQueryClient();
  const [outcome, setOutcome] = useState<RegistryTestOutcome>("approve");
  const form = useForm<RegValues, unknown, z.output<typeof registrationInput>>({
    resolver: zodResolver(registrationInput),
    defaultValues: { path, state: "", street: "", city: "", postalCode: "", ...prefill } as RegValues,
  });
  const errors = form.formState.errors as Record<string, { message?: string } | undefined>;

  const submit = useMutation({
    mutationFn: (values: z.output<typeof registrationInput>) =>
      api<RegistrationResponse>("/compliance/registration", { method: "POST", body: simulated ? { ...values, simulate: outcome } : values }),
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
          {field(
            "ein",
            "EIN",
            { inputMode: "numeric", placeholder: "12-3456789", autoComplete: "off" },
            `Encrypted, shown only as the last 4 digits, and deleted ${REGISTRATION_ID_RETENTION_DAYS} days after approval.`,
          )}
          <Field>
            <FieldLabel htmlFor="entityType">Business type</FieldLabel>
            <select id="entityType" className="h-11 rounded-md border border-input bg-background px-3 text-base" {...form.register("entityType" as never)}>
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
          {field("dateOfBirth", "Date of birth", { type: "date" }, `Needed for sole-proprietor registration. Encrypted, and deleted ${REGISTRATION_ID_RETENTION_DAYS} days after approval.`)}
          {field("mobile", "Mobile number", { type: "tel", autoComplete: "tel" }, "The carriers text a one-time code here to confirm it's yours.")}
          {field("email", "Email", { type: "email", autoComplete: "email" })}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-[2fr_1fr_80px_120px]">
        {field("street", "Street address", { autoComplete: "street-address" })}
        {field("city", "City", { autoComplete: "address-level2" })}
        {field("state", "State", { maxLength: 2, className: "uppercase", autoComplete: "address-level1" })}
        {field("postalCode", "ZIP", { inputMode: "numeric", autoComplete: "postal-code" })}
      </div>
      {simulated && (
        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">Simulator: the carriers will</p>
          <ToggleGroup
            value={[outcome]}
            onValueChange={(value) => value[0] && setOutcome(value[0] as RegistryTestOutcome)}
            variant="outline"
            aria-label="Simulated carrier decision"
            className="flex-wrap"
          >
            {REGISTRY_TEST_OUTCOMES.map((value) => (
              <ToggleGroupItem key={value} value={value} className="px-3">
                {OUTCOME_LABEL[value]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}
      <p className="text-sm text-muted-foreground">
        We use these details only to register you with US carriers, as our{" "}
        <a href="/privacy" target="_blank" className="font-medium text-foreground underline underline-offset-4">
          privacy policy
        </a>{" "}
        explains. Approval usually takes 1–3 weeks.
      </p>
      <Button type="submit" size="lg" disabled={submit.isPending}>
        {submit.isPending && <Spinner />} {prefill ? "Send again" : "Send for review"}
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
