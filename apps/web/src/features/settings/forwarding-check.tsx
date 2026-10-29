"use client";

import type { ForwardingStatus, SettingsResponse } from "@leadanchor/contracts";
import { IconCircleCheck, IconHelpCircle, IconPhoneCall, IconPhoneX } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, isApiError } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { keys } from "@/lib/queries";
import { cn } from "@/lib/utils";

const COPY: Record<ForwardingStatus, { title: string; detail: string }> = {
  unknown: {
    title: "Not tested yet",
    detail: "We'll call your cell from your LeadAnchor number. Don't answer: if forwarding is on, the call comes straight back to LeadAnchor.",
  },
  checking: { title: "Calling your cell now", detail: "Don't answer. Let it ring until it stops; this takes about a minute." },
  verified: { title: "Forwarding works", detail: "Calls you miss on your cell reach LeadAnchor." },
  not_detected: {
    title: "The call didn't come back",
    detail: "Dial the \"Turn on\" code for your carrier above, then test again. Or put your LeadAnchor number on Google and your ads instead.",
  },
};

/** C-01: proves call forwarding is on with a real test call instead of trusting that the code was dialled. */
export function ForwardingCheck({ settings }: { settings: SettingsResponse }) {
  const queryClient = useQueryClient();
  const [simulate, setSimulate] = useState<"forwards" | "no_forward">("forwards");
  const status = settings.forwardingStatus;

  const start = useMutation({
    mutationFn: () => api<SettingsResponse>("/settings/forwarding-check", { method: "POST", body: settings.simulated ? { simulate } : {} }),
    onSuccess: (data) => queryClient.setQueryData(keys.settings, data),
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't start the test."),
  });

  const Icon = status === "verified" ? IconCircleCheck : status === "not_detected" ? IconPhoneX : status === "checking" ? IconPhoneCall : IconHelpCircle;
  return (
    <div className="space-y-3 rounded-lg border bg-background p-4">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-full",
            status === "verified" ? "bg-primary-subtle text-primary-subtle-foreground" : status === "not_detected" ? "bg-signal-subtle text-signal-strong" : "bg-muted text-muted-foreground",
          )}
        >
          {status === "checking" ? <Spinner className="size-[18px]" /> : <Icon className="size-[18px]" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{COPY[status].title}</p>
          <p className="text-[15px] text-muted-foreground">
            {COPY[status].detail}
            {status === "verified" && settings.forwardingCheckedAt && ` Checked ${timeAgo(settings.forwardingCheckedAt)}.`}
          </p>
        </div>
      </div>

      {settings.simulated && status !== "checking" && (
        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">Simulator: the pretend cell phone</p>
          <ToggleGroup value={[simulate]} onValueChange={(value) => value[0] && setSimulate(value[0] as typeof simulate)} variant="outline" aria-label="Simulated phone">
            <ToggleGroupItem value="forwards" className="px-3">
              Forwards missed calls
            </ToggleGroupItem>
            <ToggleGroupItem value="no_forward" className="px-3">
              Doesn&apos;t forward
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      )}

      <Button type="button" variant="outline" onClick={() => start.mutate()} disabled={status === "checking" || start.isPending}>
        <IconPhoneCall /> {status === "verified" || status === "not_detected" ? "Test again" : "Test my forwarding"}
      </Button>
    </div>
  );
}
