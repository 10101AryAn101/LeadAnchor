"use client";

import { IconCheck, IconCopy, IconPhoneCall } from "@tabler/icons-react";
import { useState } from "react";
import { copyText } from "@/lib/clipboard";
import { formatPhone } from "@/lib/format";
import { cn } from "@/lib/utils";

/** The business's LeadAnchor number (C-02), one tap to copy. */
export function TrackingNumber({ e164, className }: { e164: string | null; className?: string }) {
  const [copied, setCopied] = useState(false);
  if (!e164) return null;

  return (
    <button
      type="button"
      onClick={async () => {
        if (!(await copyText(e164))) return;
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      className={cn(
        "group flex min-h-14 w-full items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
        className,
      )}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-subtle text-primary-subtle-foreground">
        <IconPhoneCall className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-muted-foreground">Your LeadAnchor line</span>
        <span className="tabular block truncate font-semibold">{formatPhone(e164)}</span>
      </span>
      {copied ? (
        <IconCheck className="size-[18px] text-primary" aria-label="Copied" />
      ) : (
        <IconCopy className="size-[18px] text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100" aria-hidden />
      )}
    </button>
  );
}
