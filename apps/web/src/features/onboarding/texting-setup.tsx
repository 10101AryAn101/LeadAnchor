"use client";

import { IconMessageCheck } from "@tabler/icons-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * C-43: carrier registration (10DLC), offered while onboarding. US carriers must approve a
 * business before it can text customers, and the review takes a while, so it's best started now.
 */
export function TextingSetup() {
  return (
    <section className="space-y-3 rounded-lg border bg-card p-5">
      <h2 className="flex items-center gap-2 text-[17px] font-bold">
        <IconMessageCheck className="size-5 text-primary" /> Switch on texting
      </h2>
      <p className="text-[15px] text-muted-foreground">
        US phone carriers have to approve a business before it can text customers. Registering takes
        a few minutes, and the carriers&apos; review usually takes 1 to 3 weeks, so it&apos;s best
        to start now. Until then, LeadAnchor still catches every call.
      </p>
      <Button variant="outline" nativeButton={false} render={<Link href="/compliance" />}>
        Register for texting
      </Button>
    </section>
  );
}
