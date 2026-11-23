"use client";

import { type SettingsResponse, settingsUpdateInput } from "@leadanchor/contracts";
import { IconCircleCheck, IconShieldCheck } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { api, isApiError } from "@/lib/api";
import { keys } from "@/lib/queries";

const FIELDS = [
  { name: "licenseNumber", label: "Licence number", placeholder: "M-40211" },
  { name: "licenseTrade", label: "What it's for", placeholder: "Master Plumber" },
  { name: "licenseState", label: "State", placeholder: "TX" },
  { name: "insuranceCarrier", label: "Insured with", placeholder: "State Farm" },
  { name: "insurancePolicyNumber", label: "Policy number", placeholder: "Optional" },
  { name: "yearsInBusiness", label: "Years in business", placeholder: "12" },
] as const;

type Values = Record<(typeof FIELDS)[number]["name"], string>;

/**
 * C-41: the pro profile, set up once while onboarding. A new customer's first text then says
 * "Licensed & insured" with a link to the profile page. Optional; these are the owner's own
 * statements, never shown as "verified". Everything here can be changed later in Settings.
 */
export function ProfileSetup({ state }: { state: string | null }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Values>({
    licenseNumber: "",
    licenseTrade: "",
    licenseState: state ?? "",
    insuranceCarrier: "",
    insurancePolicyNumber: "",
    yearsInBusiness: "",
  });
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: async () => {
      const parsed = settingsUpdateInput.safeParse({
        licenseNumber: values.licenseNumber || null,
        licenseTrade: values.licenseTrade || null,
        licenseState: values.licenseState || null,
        insuranceCarrier: values.insuranceCarrier || null,
        insurancePolicyNumber: values.insurancePolicyNumber || null,
        yearsInBusiness: values.yearsInBusiness ? Number(values.yearsInBusiness) : null,
      });
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Check the details.");
      return api<SettingsResponse>("/settings", { method: "PATCH", body: parsed.data });
    },
    onSuccess: (data) => {
      queryClient.setQueryData(keys.settings, data);
      setSaved(true);
    },
    onError: (error) =>
      toast.error(
        isApiError(error) || error instanceof Error ? error.message : "Couldn't save your profile.",
      ),
  });

  if (saved) {
    return (
      <p className="flex items-start gap-2 rounded-lg border bg-card p-4 text-[15px]">
        <IconCircleCheck className="mt-0.5 size-5 shrink-0 text-primary" />
        Saved. New customers see it in your first text, with a link to your profile page.
      </p>
    );
  }

  const filled = Object.values(values).some((value) => value.trim() && value !== state);
  return (
    <section className="space-y-4 rounded-lg border bg-card p-5">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 text-[17px] font-bold">
          <IconShieldCheck className="size-5 text-primary" /> Show you&apos;re licensed and insured
        </h2>
        <p className="text-[15px] text-muted-foreground">
          Optional, and takes a minute. Your first text to each new customer then says
          &ldquo;Licensed &amp; insured&rdquo; with a link to your profile page. These are your own
          details: we never call them verified. You can change them in Settings.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map((field) => (
          <Field key={field.name}>
            <FieldLabel htmlFor={`profile-${field.name}`}>{field.label}</FieldLabel>
            <Input
              id={`profile-${field.name}`}
              placeholder={field.placeholder}
              inputMode={field.name === "yearsInBusiness" ? "numeric" : undefined}
              maxLength={field.name === "licenseState" ? 2 : 80}
              className={field.name === "licenseState" ? "uppercase" : undefined}
              value={values[field.name]}
              onChange={(event) =>
                setValues((current) => ({ ...current, [field.name]: event.target.value }))
              }
            />
          </Field>
        ))}
      </div>
      <FieldDescription>
        &ldquo;Licensed &amp; insured&rdquo; shows once you add both a licence number and an
        insurer.
      </FieldDescription>
      <Button
        variant="outline"
        className="w-full sm:w-auto"
        disabled={!filled || save.isPending}
        onClick={() => save.mutate()}
      >
        {save.isPending && <Spinner />} Save my profile
      </Button>
    </section>
  );
}
