"use client";

import { INTAKE_CONSENT_TEXT, type IntakeContext, TRACK_BY_TRADE, TRADE_LABELS } from "@leadanchor/contracts";
import { IconCamera, IconCheck, IconChevronLeft, IconCircleCheck, IconPhone, IconPhoto, IconShieldCheck, IconX } from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { formatPhone, telHref } from "@/lib/format";
import { cn } from "@/lib/utils";

const MAX_PHOTOS = 5;
const OTHER = "__other__";

const EXAMPLES_A = ["It's leaking", "It stopped working", "Making a strange noise", "Need a quote for a new one"];
const TIMES = ["As soon as possible", "Today", "This week", "I'm flexible"];

interface Draft {
  serviceId: string;
  details: string;
  preferredTime: string;
  contactName: string;
  address: string;
  smsConsent: boolean;
}

type Step = 0 | 1 | 2;

export function IntakeForm({ token, context }: { token: string; context: IntakeContext }) {
  const storageKey = `leadanchor:intake:${token.slice(0, 12)}`;
  const track = TRACK_BY_TRADE[context.business.trade];
  const [step, setStep] = useState<Step>(0);
  const [draft, setDraft] = useState<Draft>({
    serviceId: "",
    details: "",
    preferredTime: "",
    contactName: context.customerName ?? "",
    address: "",
    smsConsent: false,
  });
  const [photos, setPhotos] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<number | null>(null);
  const [done, setDone] = useState(context.status === "submitted");
  const [failure, setFailure] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  // Keep the draft through a reload (e.g. the camera pushes a low-memory phone to reload the page).
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      // The server can't read sessionStorage, so the saved draft is restored right after the page loads.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setDraft((current) => ({ ...current, ...(JSON.parse(saved) as Partial<Draft>) }));
    } catch {
      // Private mode or blocked storage — the form still works.
    }
  }, [storageKey]);
  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {
      // ignore
    }
  }, [draft, storageKey]);

  const previews = useMemo(() => photos.map((file) => ({ file, url: URL.createObjectURL(file) })), [photos]);
  useEffect(() => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)), [previews]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: "" }));
  };

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    setPhotos((current) => [...current, ...Array.from(files)].slice(0, MAX_PHOTOS));
  };

  const next = () => {
    if (step === 0 && !draft.serviceId) return setErrors({ serviceId: "Pick the closest match" });
    if (step === 1 && draft.details.trim().length < 3) return setErrors({ details: "Tell us a little about the job" });
    setStep((current) => (current < 2 ? ((current + 1) as Step) : current));
    window.scrollTo({ top: 0 });
  };

  const submit = () => {
    if (!draft.contactName.trim()) return setErrors({ contactName: "Enter your name" });
    setFailure(null);
    const body = new FormData();
    if (draft.serviceId && draft.serviceId !== OTHER) body.set("serviceId", draft.serviceId);
    body.set("details", draft.details.trim());
    body.set("contactName", draft.contactName.trim());
    body.set("address", draft.address.trim());
    body.set("preferredTime", draft.preferredTime);
    body.set("smsConsent", String(draft.smsConsent));
    for (const file of photos) body.append("photos", file, file.name);

    // XHR rather than fetch so we can show upload progress for the photos.
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/public/intake/${encodeURIComponent(token)}`);
    xhr.upload.onprogress = (event) => event.lengthComputable && setProgress(Math.round((event.loaded / event.total) * 100));
    xhr.onload = () => {
      setProgress(null);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          // ignore
        }
        setDone(true);
        return;
      }
      try {
        const payload = JSON.parse(xhr.responseText) as { error?: { message?: string; fields?: Record<string, string[]> } };
        if (payload.error?.fields) setErrors(Object.fromEntries(Object.entries(payload.error.fields).map(([k, v]) => [k, v[0] ?? ""])));
        setFailure(payload.error?.message ?? "Something went wrong. Please try again.");
      } catch {
        setFailure("Something went wrong. Please try again.");
      }
    };
    xhr.onerror = () => {
      setProgress(null);
      setFailure("You seem to be offline. Your answers are saved — try again when you have signal.");
    };
    setProgress(0);
    xhr.send(body);
  };

  if (context.status === "expired") {
    return (
      <Shell context={context}>
        <Notice title="This link has expired" body="Please call or text the business and they'll send you a new one." context={context} />
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell context={context}>
        <div className="flex flex-col items-center gap-4 py-10 text-center">
          <span className="flex size-14 items-center justify-center rounded-full bg-primary-subtle text-primary-subtle-foreground">
            <IconCircleCheck className="size-8" />
          </span>
          <h1 className="font-display text-[28px] leading-tight font-semibold">Sent to {context.business.name}</h1>
          <p className="max-w-xs text-muted-foreground">
            They have your details{photos.length ? " and photos" : ""}. Expect a call or text back soon.
          </p>
          {context.business.phone && (
            <Button size="lg" variant="outline" nativeButton={false} render={<a href={telHref(context.business.phone)} />}>
              <IconPhone /> Call {formatPhone(context.business.phone)}
            </Button>
          )}
        </div>
      </Shell>
    );
  }

  return (
    <Shell context={context}>
      <div className="flex items-center justify-between pt-2">
        {step > 0 ? (
          <button type="button" onClick={() => setStep((current) => (current - 1) as Step)} className="-ml-1 inline-flex min-h-11 items-center gap-1 font-medium text-muted-foreground">
            <IconChevronLeft className="size-5" /> Back
          </button>
        ) : (
          <span />
        )}
        <span className="tabular text-[15px] text-muted-foreground">Step {step + 1} of 3</span>
      </div>

      {step === 0 && (
        <section className="space-y-4">
          <h1 className="font-display text-[26px] leading-tight font-semibold">
            {context.customerName ? `Hi ${context.customerName.split(" ")[0]}, w` : "W"}hat do you need help with?
          </h1>
          <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Service">
            {[...context.services, { id: OTHER, name: "Something else", description: null }].map((service) => {
              const selected = draft.serviceId === service.id;
              return (
                <button
                  key={service.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => set("serviceId", service.id)}
                  className={cn(
                    "flex min-h-16 items-center gap-2 rounded-lg border border-input bg-card px-3 py-3 text-left text-[15px] leading-5 font-semibold transition-colors",
                    selected ? "border-primary bg-primary-subtle text-primary-subtle-foreground ring-1 ring-primary" : "hover:bg-muted",
                  )}
                >
                  <span className="flex-1">{service.name}</span>
                  {selected && <IconCheck className="size-5 shrink-0" />}
                </button>
              );
            })}
          </div>
          {errors.serviceId && <p className="text-[15px] text-destructive">{errors.serviceId}</p>}
        </section>
      )}

      {step === 1 && (
        <section className="space-y-5">
          <h1 className="font-display text-[26px] leading-tight font-semibold">What&apos;s going on?</h1>
          <Field data-invalid={!!errors.details}>
            <FieldLabel htmlFor="details" className="sr-only">
              Describe the problem
            </FieldLabel>
            <Textarea
              id="details"
              rows={5}
              autoFocus
              value={draft.details}
              onChange={(event) => set("details", event.target.value)}
              placeholder={track === "A" ? "e.g. Water heater in the garage is leaking from the bottom" : "e.g. Haircut and color for shoulder-length hair"}
            />
            {errors.details && <p className="text-[15px] text-destructive">{errors.details}</p>}
          </Field>
          {track === "A" && (
            <div className="flex flex-wrap gap-2">
              {EXAMPLES_A.map((example) => (
                <button
                  key={example}
                  type="button"
                  onClick={() => set("details", draft.details ? `${draft.details.trim()}. ${example}` : example)}
                  className="min-h-11 rounded-full border border-input bg-card px-4 text-[15px] hover:bg-muted"
                >
                  {example}
                </button>
              ))}
            </div>
          )}
          <div className="space-y-2.5">
            <p className="font-semibold">When works for you?</p>
            <div className="flex flex-wrap gap-2">
              {TIMES.map((time) => (
                <button
                  key={time}
                  type="button"
                  aria-pressed={draft.preferredTime === time}
                  onClick={() => set("preferredTime", draft.preferredTime === time ? "" : time)}
                  className={cn(
                    "min-h-11 rounded-full border border-input px-4 text-[15px]",
                    draft.preferredTime === time ? "border-primary bg-primary-subtle font-semibold text-primary-subtle-foreground" : "bg-card hover:bg-muted",
                  )}
                >
                  {time}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="space-y-5">
          <div className="space-y-1.5">
            <h1 className="font-display text-[26px] leading-tight font-semibold">Add a photo</h1>
            <p className="text-muted-foreground">A quick photo helps {context.business.name} quote without a visit. Optional.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Button type="button" size="lg" variant="outline" onClick={() => cameraRef.current?.click()} disabled={photos.length >= MAX_PHOTOS}>
              <IconCamera /> Take photo
            </Button>
            <Button type="button" size="lg" variant="outline" onClick={() => libraryRef.current?.click()} disabled={photos.length >= MAX_PHOTOS}>
              <IconPhoto /> Choose photos
            </Button>
          </div>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => addPhotos(e.target.files)} />
          <input ref={libraryRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addPhotos(e.target.files)} />
          {previews.length > 0 && (
            <ul className="grid grid-cols-3 gap-2">
              {previews.map((preview, index) => (
                <li key={preview.url} className="relative aspect-square overflow-hidden rounded-md border bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element -- local preview of a file the customer picked */}
                  <img src={preview.url} alt={`Photo ${index + 1}`} className="size-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setPhotos((current) => current.filter((_, i) => i !== index))}
                    className="absolute top-1 right-1 flex size-8 items-center justify-center rounded-full bg-background text-foreground"
                    aria-label={`Remove photo ${index + 1}`}
                  >
                    <IconX className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-4 border-t pt-5">
            <Field data-invalid={!!errors.contactName}>
              <FieldLabel htmlFor="contactName">Your name</FieldLabel>
              <Input id="contactName" autoComplete="name" value={draft.contactName} onChange={(e) => set("contactName", e.target.value)} />
              {errors.contactName && <p className="text-[15px] text-destructive">{errors.contactName}</p>}
            </Field>
            {track === "A" && (
              <Field>
                <FieldLabel htmlFor="address">Address of the job (optional)</FieldLabel>
                <Input id="address" autoComplete="street-address" value={draft.address} onChange={(e) => set("address", e.target.value)} />
              </Field>
            )}
            <label className="flex cursor-pointer gap-3 rounded-lg border border-input bg-card p-3.5">
              <Checkbox checked={draft.smsConsent} onCheckedChange={(checked) => set("smsConsent", checked === true)} className="mt-0.5" />
              <span className="text-[15px] leading-6">{INTAKE_CONSENT_TEXT}</span>
            </label>
          </div>
        </section>
      )}

      <div className="h-28" aria-hidden />
      <div className="pb-safe fixed inset-x-0 bottom-0 border-t bg-background px-5 pt-3">
        <div className="mx-auto max-w-md space-y-2">
          {failure && <p className="text-[15px] text-destructive">{failure}</p>}
          {progress !== null && <Progress value={progress} aria-label="Uploading" />}
          {step < 2 ? (
            <Button size="lg" className="w-full" onClick={next}>
              Continue
            </Button>
          ) : (
            <Button size="lg" className="w-full" onClick={submit} disabled={progress !== null}>
              {progress !== null ? `Sending… ${progress}%` : `Send to ${context.business.name}`}
            </Button>
          )}
        </div>
      </div>
    </Shell>
  );
}

function Shell({ context, children }: { context: IntakeContext; children: React.ReactNode }) {
  const { business } = context;
  const where = [business.city, business.state].filter(Boolean).join(", ");
  return (
    <div className="mx-auto max-w-md px-5 pt-6">
      <header className="flex items-center gap-3 rounded-lg border bg-card p-3.5">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-md bg-primary font-display text-lg font-semibold text-primary-foreground">
          {business.name.charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{business.name}</p>
          <p className="truncate text-sm text-muted-foreground">
            {TRADE_LABELS[business.trade]}
            {where ? ` in ${where}` : ""}
          </p>
        </div>
        {(business.licenseNumber || business.insured) && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-subtle px-2 py-1 text-[13px] font-semibold text-primary-subtle-foreground">
            <IconShieldCheck className="size-4" /> {business.licenseNumber && business.insured ? "Licensed & Insured" : business.licenseNumber ? "Licensed" : "Insured"}
          </span>
        )}
      </header>
      <div className="mt-4 space-y-4">{children}</div>
    </div>
  );
}

function Notice({ title, body, context }: { title: string; body: string; context: IntakeContext }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <h1 className="font-display text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground">{body}</p>
      {context.business.phone && (
        <Button size="lg" variant="outline" nativeButton={false} render={<a href={telHref(context.business.phone)} />}>
          <IconPhone /> Call {formatPhone(context.business.phone)}
        </Button>
      )}
    </div>
  );
}
