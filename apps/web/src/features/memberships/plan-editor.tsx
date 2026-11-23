"use client";

import {
  type PlanInput,
  type PlanInterval,
  type PlanItem,
  type WorkCadenceKind,
  planPrice,
} from "@leadanchor/contracts";
import { IconInfoCircle } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, isApiError } from "@/lib/api";
import { keys, useServices } from "@/lib/queries";
import { cn } from "@/lib/utils";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const selectClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-[15px]";

interface Form {
  name: string;
  price: string;
  interval: PlanInterval;
  description: string;
  includes: string;
  workServiceId: string;
  cadence: WorkCadenceKind;
  every: number;
  months: number[];
  welcomeMessage: string;
}

const formOf = (plan: PlanItem | null): Form => ({
  name: plan?.name ?? "",
  price: plan ? String(plan.priceCents / 100) : "",
  interval: plan?.interval ?? "month",
  description: plan?.description ?? "",
  includes: plan?.includes.join("\n") ?? "",
  workServiceId: plan?.workServiceId ?? "",
  cadence: plan?.workCadence.kind ?? "every",
  every: plan?.workCadence.every ?? 3,
  months: plan?.workCadence.months ?? [],
  welcomeMessage: plan?.welcomeMessage ?? "",
});

/** C-48: the owner builds a plan (or edits one) without help: price, schedule, what's in it, and its job. */
export function PlanEditor({
  open,
  onOpenChange,
  plan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: PlanItem | null;
}) {
  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title={plan ? `Edit ${plan.name}` : "New plan"}
      description="A plan customers pay for every month or year. You can share its sign-up link as soon as it's saved."
      className="sm:max-w-xl"
    >
      {open && <PlanForm key={plan?.id ?? "new"} plan={plan} onDone={() => onOpenChange(false)} />}
    </ResponsiveSheet>
  );
}

function PlanForm({ plan, onDone }: { plan: PlanItem | null; onDone: () => void }) {
  const queryClient = useQueryClient();
  const { data: services } = useServices();
  const [form, setForm] = useState<Form>(() => formOf(plan));
  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const priceCents = Math.round(Number(form.price) * 100);
  const priceOk = Number.isFinite(priceCents) && priceCents >= 100;
  const members = plan ? plan.members.active + plan.members.pastDue + plan.members.paused : 0;
  const repriced = plan && (priceCents !== plan.priceCents || form.interval !== plan.interval);

  const save = useMutation({
    mutationFn: () => {
      const body: PlanInput = {
        name: form.name.trim(),
        description: form.description.trim(),
        priceCents,
        interval: form.interval,
        includes: form.includes
          .split("\n")
          .map((line) => line.replace(/^[•\-*]\s*/, "").trim())
          .filter(Boolean)
          .slice(0, 10),
        workServiceId: form.workServiceId || null,
        workCadence: { kind: form.cadence, every: form.every, months: form.months },
        welcomeMessage: form.welcomeMessage.trim(),
      };
      return plan
        ? api<PlanItem>(`/membership-plans/${plan.id}`, { method: "PATCH", body })
        : api<PlanItem>("/membership-plans", { method: "POST", body });
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: keys.plans });
      void queryClient.invalidateQueries({ queryKey: keys.memberships });
      toast.success(
        plan ? "Plan saved." : `${saved.name} is ready. Share its sign-up link to take members.`,
      );
      onDone();
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't save the plan."),
  });

  return (
    <form
      className="space-y-5 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <Field>
        <FieldLabel htmlFor="plan-name">Name</FieldLabel>
        <Input
          id="plan-name"
          value={form.name}
          maxLength={60}
          placeholder="Gold AC Care"
          onChange={(event) => set("name", event.target.value)}
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
        <Field>
          <FieldLabel htmlFor="plan-price">Price</FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText>$</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput
              id="plan-price"
              type="number"
              inputMode="decimal"
              min={1}
              step="0.01"
              value={form.price}
              placeholder="99"
              onChange={(event) => set("price", event.target.value)}
            />
          </InputGroup>
        </Field>
        <Field>
          <FieldLabel>Billed</FieldLabel>
          <ToggleGroup
            value={[form.interval]}
            onValueChange={(value) => value[0] && set("interval", value[0] as PlanInterval)}
            variant="outline"
            aria-label="Billed"
          >
            <ToggleGroupItem value="month" className="min-h-11 px-4">
              Monthly
            </ToggleGroupItem>
            <ToggleGroupItem value="year" className="min-h-11 px-4">
              Yearly
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>
      </div>
      {repriced && members > 0 && priceOk && (
        <p className="flex items-start gap-2 rounded-lg bg-info-subtle p-3 text-[15px] text-info-strong">
          <IconInfoCircle className="mt-0.5 size-4 shrink-0" />
          New members pay {planPrice(priceCents, form.interval)}. Your {members} current{" "}
          {members === 1 ? "member keeps" : "members keep"} the price they joined at.
        </p>
      )}

      <Field>
        <FieldLabel htmlFor="plan-description">Description</FieldLabel>
        <Textarea
          id="plan-description"
          rows={2}
          maxLength={500}
          value={form.description}
          placeholder="Keep your AC running all summer with two tune-ups a year."
          onChange={(event) => set("description", event.target.value)}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="plan-includes">What&apos;s included</FieldLabel>
        <Textarea
          id="plan-includes"
          rows={4}
          value={form.includes}
          placeholder={"Two tune-ups a year\nPriority booking\n10% off repairs"}
          onChange={(event) => set("includes", event.target.value)}
        />
        <FieldDescription>
          One per line. Shown on the sign-up page and in the welcome email.
        </FieldDescription>
      </Field>

      <fieldset className="space-y-3 rounded-lg border p-4">
        <legend className="px-1 font-semibold">The job on your board</legend>
        <p className="text-sm text-muted-foreground">
          When a bill is paid, a job card for the work lands in your New column.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="plan-service">Service</FieldLabel>
            <select
              id="plan-service"
              className={selectClass}
              value={form.workServiceId}
              onChange={(event) => set("workServiceId", event.target.value)}
            >
              <option value="">The plan itself</option>
              {services
                ?.filter((service) => service.active)
                .map((service) => (
                  <option key={service.id} value={service.id}>
                    {service.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field>
            <FieldLabel htmlFor="plan-cadence">How often</FieldLabel>
            <select
              id="plan-cadence"
              className={selectClass}
              value={form.cadence}
              onChange={(event) => set("cadence", event.target.value as WorkCadenceKind)}
            >
              <option value="every">Every bill</option>
              <option value="nth">Every few bills</option>
              <option value="months">In chosen months</option>
              <option value="none">Never</option>
            </select>
          </Field>
        </div>
        {form.cadence === "nth" && (
          <Field>
            <FieldLabel htmlFor="plan-every">Every</FieldLabel>
            <select
              id="plan-every"
              className={selectClass}
              value={form.every}
              onChange={(event) => set("every", Number(event.target.value))}
            >
              {[2, 3, 4, 6, 12].map((n) => (
                <option key={n} value={n}>
                  {n} bills
                  {form.interval === "month" && n === 3
                    ? " (quarterly)"
                    : form.interval === "month" && n === 6
                      ? " (twice a year)"
                      : ""}
                </option>
              ))}
            </select>
          </Field>
        )}
        {form.cadence === "months" && (
          <div className="space-y-2">
            <p className="text-sm font-medium">Bills paid in</p>
            <div className="grid grid-cols-6 gap-1.5" role="group" aria-label="Months">
              {MONTHS.map((label, index) => {
                const month = index + 1;
                const on = form.months.includes(month);
                return (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      set(
                        "months",
                        on ? form.months.filter((m) => m !== month) : [...form.months, month],
                      )
                    }
                    className={cn(
                      "h-10 rounded-md border text-sm font-medium transition-colors",
                      on
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-background hover:bg-muted",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </fieldset>

      <Field>
        <FieldLabel htmlFor="plan-welcome">Welcome message</FieldLabel>
        <Textarea
          id="plan-welcome"
          rows={3}
          maxLength={600}
          value={form.welcomeMessage}
          placeholder="Thanks for joining! We'll call within a week to book your first visit."
          onChange={(event) => set("welcomeMessage", event.target.value)}
        />
        <FieldDescription>
          Emailed when someone joins, with what&apos;s included and the link to manage the plan.
        </FieldDescription>
      </Field>

      <Button
        type="submit"
        size="lg"
        className="w-full"
        disabled={save.isPending || form.name.trim().length < 2 || !priceOk}
      >
        {save.isPending && <Spinner />} {plan ? "Save plan" : "Create plan"}
      </Button>
    </form>
  );
}
