"use client";

import { IconCheck, IconCopy, IconInfoCircle } from "@tabler/icons-react";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { copyText } from "@/lib/clipboard";
import { formatPhone } from "@/lib/format";

/**
 * C-01: conditional call forwarding, so unanswered calls to the owner's existing
 * number reach LeadAnchor. Android can pre-fill the dialer from a tel: link; iPhone
 * blocks these codes in links, so every code can also be copied.
 */
const carriers = (digits: string) => [
  { id: "verizon", name: "Verizon", on: `*71${digits}`, off: "*73", note: "Forwards calls you don't answer or decline." },
  { id: "att", name: "AT&T", on: `**004*1${digits}#`, off: "##004#", note: "Forwards when you're busy, don't answer or have no signal." },
  { id: "tmobile", name: "T-Mobile", on: `**004*1${digits}#`, off: "##004#", note: "Forwards when you're busy, don't answer or have no signal." },
  {
    id: "other",
    name: "Other",
    on: `**61*1${digits}#`,
    off: "##61#",
    note: "The standard code for most carriers. If it doesn't work, your carrier can switch it on for you.",
  },
];

export function ForwardingGuide({ trackingNumber }: { trackingNumber: string }) {
  const digits = trackingNumber.replace(/^\+1/, "").replace(/\D/g, "");
  return (
    <div>
      <Tabs defaultValue="verizon">
        <TabsList className="w-full">
          {carriers(digits).map((carrier) => (
            <TabsTrigger key={carrier.id} value={carrier.id} className="flex-1">
              {carrier.name}
            </TabsTrigger>
          ))}
        </TabsList>
        {carriers(digits).map((carrier) => (
          <TabsContent key={carrier.id} value={carrier.id} className="mt-4 space-y-2.5">
            <CodeRow label="Turn on" code={carrier.on} primary />
            <CodeRow label="Turn off" code={carrier.off} />
            <p className="pt-1 text-sm text-muted-foreground">{carrier.note}</p>
          </TabsContent>
        ))}
      </Tabs>
      <p className="mt-4 flex gap-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
        <IconInfoCircle className="mt-0.5 size-4 shrink-0" />
        On iPhone, copy the code and dial it in the Phone app. Prefer not to forward? Put {formatPhone(trackingNumber)} on Google and your ads instead —
        every call to it is caught.
      </p>
    </div>
  );
}

function CodeRow({ label, code, primary }: { label: string; code: string; primary?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-h-14 items-center gap-3 rounded-lg border bg-card px-3">
      <span className="w-16 shrink-0 text-sm text-muted-foreground">{label}</span>
      <a href={`tel:${encodeURIComponent(code)}`} className={primary ? "tabular flex-1 text-lg font-bold text-primary" : "tabular flex-1 font-semibold"}>
        {code}
      </a>
      <button
        type="button"
        onClick={async () => {
          if (!(await copyText(code))) return;
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label={`Copy ${code}`}
      >
        {copied ? <IconCheck className="size-5 text-primary" /> : <IconCopy className="size-5" />}
      </button>
    </div>
  );
}
