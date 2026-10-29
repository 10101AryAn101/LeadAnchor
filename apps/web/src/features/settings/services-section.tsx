"use client";

import { type ServiceInput, type ServiceItem, serviceInput } from "@leadanchor/contracts";
import { IconArrowDown, IconArrowUp, IconPencil, IconPlus } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { api, isApiError } from "@/lib/api";
import { jobLength, money } from "@/lib/format";
import { keys, useServices } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** C-17: what the business offers. Customers pick from the shown ones on the request form. */
export function ServicesSection() {
  const queryClient = useQueryClient();
  const { data: services, isPending } = useServices();
  const [editing, setEditing] = useState<ServiceItem | "new" | null>(null);

  const reorder = useMutation({
    mutationFn: (ids: string[]) => api<{ services: ServiceItem[] }>("/services/order", { method: "POST", body: { ids } }),
    onMutate: (ids) => {
      const previous = queryClient.getQueryData<ServiceItem[]>(keys.services);
      if (previous) queryClient.setQueryData(keys.services, ids.map((id) => previous.find((service) => service.id === id)!));
      return { previous };
    },
    onSuccess: (data) => queryClient.setQueryData(keys.services, data.services),
    onError: (error, _ids, context) => {
      if (context?.previous) queryClient.setQueryData(keys.services, context.previous);
      toast.error(isApiError(error) ? error.message : "Couldn't save the new order.");
    },
  });

  const move = (index: number, step: -1 | 1) => {
    if (!services) return;
    const next = [...services];
    const [item] = next.splice(index, 1);
    next.splice(index + step, 0, item!);
    reorder.mutate(next.map((service) => service.id));
  };

  return (
    <section className="rounded-lg border bg-card p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-[17px] font-bold">Services and prices</h2>
          <p className="text-[15px] text-muted-foreground">
            Customers pick from these on the request form. Times and prices are used for quotes and booking.
          </p>
        </div>
        <Button variant="outline" onClick={() => setEditing("new")}>
          <IconPlus /> Add
        </Button>
      </div>

      {isPending || !services ? (
        <div className="space-y-2">
          <Skeleton className="h-14 rounded-lg" />
          <Skeleton className="h-14 rounded-lg" />
        </div>
      ) : services.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-[15px] text-muted-foreground">No services yet. Add what you offer.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {services.map((service, index) => {
            const facts = [jobLength(service.durationMins), service.priceCents != null ? money(service.priceCents) : null].filter(Boolean);
            return (
              <li key={service.id} className="flex items-center gap-2 py-1.5 pr-1.5 pl-3">
                <button type="button" onClick={() => setEditing(service)} className="min-w-0 flex-1 py-1 text-left">
                  <span className={cn("block truncate font-semibold", !service.active && "text-muted-foreground")}>{service.name}</span>
                  <span className="block truncate text-sm text-muted-foreground">{facts.length > 0 ? facts.join(", ") : "No time or price yet"}</span>
                </button>
                {!service.active && <Badge variant="outline">Hidden</Badge>}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${service.name} up`}
                  disabled={index === 0 || reorder.isPending}
                  onClick={() => move(index, -1)}
                >
                  <IconArrowUp />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${service.name} down`}
                  disabled={index === services.length - 1 || reorder.isPending}
                  onClick={() => move(index, 1)}
                >
                  <IconArrowDown />
                </Button>
                <Button variant="ghost" size="icon" aria-label={`Edit ${service.name}`} onClick={() => setEditing(service)}>
                  <IconPencil />
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {editing && <ServiceSheet key={editing === "new" ? "new" : editing.id} service={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function ServiceSheet({ service, onClose }: { service: ServiceItem | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(service?.name ?? "");
  const [description, setDescription] = useState(service?.description ?? "");
  const [minutes, setMinutes] = useState(service?.durationMins != null ? String(service.durationMins) : "");
  const [price, setPrice] = useState(service?.priceCents != null ? String(service.priceCents / 100) : "");
  const [active, setActive] = useState(service?.active ?? true);
  const [errors, setErrors] = useState<Partial<Record<keyof ServiceInput, string>>>({});

  const save = useMutation({
    mutationFn: (body: ServiceInput) =>
      service ? api<ServiceItem>(`/services/${service.id}`, { method: "PATCH", body }) : api<ServiceItem>("/services", { method: "POST", body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.services });
      toast.success(service ? "Service saved." : "Service added.");
      onClose();
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't save the service."),
  });

  const submit = () => {
    const parsed = serviceInput.safeParse({
      name,
      description: description.trim() || null,
      durationMins: minutes.trim() === "" ? null : Number(minutes),
      priceDollars: price.trim() === "" ? null : Number(price),
      active,
    });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((issue) => [issue.path[0], issue.message])));
      return;
    }
    save.mutate(parsed.data);
  };

  return (
    <ResponsiveSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={service ? "Edit service" : "Add a service"}
      footer={
        <Button size="lg" className="w-full" onClick={submit} disabled={save.isPending}>
          {save.isPending && <Spinner />} {service ? "Save service" : "Add service"}
        </Button>
      }
    >
      <div className="space-y-4 pb-2">
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="service-name">Name</FieldLabel>
          <Input id="service-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Water heater repair" />
          <FieldError errors={errors.name ? [{ message: errors.name }] : []} />
        </Field>
        <Field>
          <FieldLabel htmlFor="service-description">Short description (optional)</FieldLabel>
          <Input id="service-description" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field data-invalid={!!errors.durationMins}>
            <FieldLabel htmlFor="service-minutes">Usual time</FieldLabel>
            <InputGroup>
              <InputGroupInput id="service-minutes" type="number" inputMode="numeric" min={5} value={minutes} onChange={(e) => setMinutes(e.target.value)} />
              <InputGroupAddon align="inline-end">
                <InputGroupText>minutes</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            <FieldError errors={errors.durationMins ? [{ message: errors.durationMins }] : []} />
          </Field>
          <Field data-invalid={!!errors.priceDollars}>
            <FieldLabel htmlFor="service-price">Usual price</FieldLabel>
            <InputGroup>
              <InputGroupAddon>
                <InputGroupText>$</InputGroupText>
              </InputGroupAddon>
              <InputGroupInput id="service-price" type="number" inputMode="decimal" min={0} value={price} onChange={(e) => setPrice(e.target.value)} />
            </InputGroup>
            <FieldError errors={errors.priceDollars ? [{ message: errors.priceDollars }] : []} />
          </Field>
        </div>
        <Field orientation="horizontal" className="items-start justify-between gap-4 rounded-lg border bg-background p-4">
          <div className="space-y-1">
            <FieldLabel htmlFor="service-active">Show on the request form</FieldLabel>
            <FieldDescription>Hidden services stay in your history but customers can&apos;t pick them.</FieldDescription>
          </div>
          <Switch id="service-active" checked={active} onCheckedChange={setActive} />
        </Field>
      </div>
    </ResponsiveSheet>
  );
}
