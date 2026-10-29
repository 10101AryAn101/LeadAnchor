import {
  LEAD_SOURCE_LABELS,
  LEAD_STAGES,
  type LeadCard,
  type LeadSource,
  type LeadStage,
  type Urgency,
} from "@leadanchor/contracts";
import {
  IconAlertTriangle,
  IconBrandGoogle,
  IconBrandWhatsapp,
  IconClock,
  type Icon,
  IconHeadset,
  IconPhoneX,
  IconRecordMail,
  IconUser,
  IconWorld,
} from "@tabler/icons-react";
import { waitingFor } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Status always pairs an icon with a word (brief §3.4). */

export const SOURCE_ICON: Record<LeadSource, Icon> = {
  missed_call: IconPhoneX,
  voicemail: IconRecordMail,
  ai_dispatcher: IconHeadset,
  web_form: IconWorld,
  whatsapp: IconBrandWhatsapp,
  google: IconBrandGoogle,
  manual: IconUser,
};

export function SourceLabel({ source, className }: { source: LeadSource; className?: string }) {
  const Icon = SOURCE_ICON[source];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm text-muted-foreground", className)}>
      <Icon className="size-4" stroke={1.75} />
      {LEAD_SOURCE_LABELS[source]}
    </span>
  );
}

const URGENCY: Record<Urgency, { label: string; className: string } | null> = {
  emergency: { label: "Emergency", className: "bg-destructive-subtle text-destructive-strong" },
  high: { label: "Needs today", className: "bg-signal-subtle text-signal-strong" },
  normal: null,
  low: { label: "Quote only", className: "bg-muted text-muted-foreground" },
};

export function UrgencyChip({ urgency }: { urgency: Urgency }) {
  const meta = URGENCY[urgency];
  if (!meta) return null;
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded-full px-2 text-[13px] font-medium", meta.className)}>
      {urgency === "emergency" && <IconAlertTriangle className="size-3.5" />}
      {meta.label}
    </span>
  );
}

/** Amber only when a person is waiting on the owner. */
export function WaitingChip({ since, className }: { since: string; className?: string }) {
  return (
    <span className={cn("tabular inline-flex h-6 items-center gap-1 rounded-full bg-signal px-2 text-[13px] font-semibold text-signal-foreground", className)}>
      <IconClock className="size-3.5" stroke={2.25} />
      {waitingFor(since)}
    </span>
  );
}

export const isWaiting = (lead: Pick<LeadCard, "needsCallback" | "stage">) => lead.needsCallback && lead.stage === "new";

/** Ordinal progress glyph: fills as the job moves New → Won (one green ramp; Lost is neutral). */
export function StageGlyph({ stage, className }: { stage: LeadStage; className?: string }) {
  const index = LEAD_STAGES.indexOf(stage);
  const lost = stage === "lost";
  const progress = lost ? 0 : Math.min(1, index / 4);
  const circumference = 2 * Math.PI * 6;
  return (
    <svg viewBox="0 0 16 16" className={cn("size-4 shrink-0 -rotate-90", className)} aria-hidden>
      <circle cx="8" cy="8" r="6" fill="none" strokeWidth="2" className="stroke-border" />
      {!lost && progress > 0 && (
        <circle
          cx="8"
          cy="8"
          r="6"
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${circumference * progress} ${circumference}`}
          className="stroke-primary"
        />
      )}
      {stage === "won" && <circle cx="8" cy="8" r="3" className="fill-primary" />}
    </svg>
  );
}

/** Board order inside a column: whoever has waited longest first, then newest. No manual reordering. */
export function sortForColumn(a: LeadCard, b: LeadCard) {
  const aw = isWaiting(a);
  const bw = isWaiting(b);
  if (aw !== bw) return aw ? -1 : 1;
  if (aw && bw) return a.createdAt.localeCompare(b.createdAt);
  return b.lastActivityAt.localeCompare(a.lastActivityAt);
}

export const leadDisplayName = (lead: Pick<LeadCard, "customer">, formatPhone: (e164: string | null) => string) =>
  lead.customer.name ?? formatPhone(lead.customer.phone);
