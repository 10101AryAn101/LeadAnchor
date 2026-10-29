import { cn } from "@/lib/utils";

/** The anchor mark: a ring, shank and flukes, with an amber "signal" dot for the call we caught. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={cn("size-8 shrink-0", className)}>
      <rect width="64" height="64" rx="16" className="fill-primary" />
      <g fill="none" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" className="stroke-primary-foreground">
        <circle cx="32" cy="16" r="5" />
        <path d="M32 21v29" />
        <path d="M23 30h18" />
        <path d="M14 36c0 9 8 14 18 14s18-5 18-14" />
      </g>
      <circle cx="49" cy="15" r="6" className="fill-signal" />
    </svg>
  );
}

export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      {!compact && <span className="font-display text-[1.15rem] font-semibold tracking-tight">LeadAnchor</span>}
    </span>
  );
}
