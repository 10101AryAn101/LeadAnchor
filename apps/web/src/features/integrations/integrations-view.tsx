"use client";

import type { IntegrationState } from "@leadanchor/contracts";
import { IconCircleCheck, IconClock, IconFlask, IconPlug } from "@tabler/icons-react";
import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { useIntegrations } from "@/lib/queries";
import { cn } from "@/lib/utils";

const STATE: Record<IntegrationState, { label: string; className: string; icon: typeof IconPlug }> = {
  live: { label: "Connected", className: "bg-primary-subtle text-primary-subtle-foreground", icon: IconCircleCheck },
  simulated: { label: "Simulated locally", className: "bg-info-subtle text-info-strong", icon: IconFlask },
  not_configured: { label: "Needs setup", className: "bg-signal-subtle text-signal-strong", icon: IconPlug },
  planned: { label: "Later phase", className: "bg-muted text-muted-foreground", icon: IconClock },
};

/** Every third-party service named in the spec, and honestly where each one stands. */
export function IntegrationsView() {
  const { data, isPending } = useIntegrations();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Integrations"
        description="The services LeadAnchor is built on. Anything not connected yet runs on a local stand-in, so the whole product can be tried today."
      />
      {isPending || !data ? (
        <div className="grid gap-4 md:grid-cols-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {data.map((item) => {
            const state = STATE[item.state];
            return (
              <article key={item.key} className="flex flex-col rounded-lg border bg-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-[17px] font-bold">{item.name}</h2>
                  <span className={cn("inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold", state.className)}>
                    <state.icon className="size-4" /> {state.label}
                  </span>
                </div>
                <p className="mt-1 text-[15px] text-muted-foreground">{item.purpose}</p>
                <p className="mt-3 text-[15px]">{item.detail}</p>
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-4 text-sm text-muted-foreground">
                  {item.mandatedBySpec && <span className="rounded-full border px-2 py-0.5">Named in the spec</span>}
                  <span className="tabular">{item.capabilities.join(", ")}</span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
