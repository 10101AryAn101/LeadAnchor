import type { Metadata } from "next";
import { Suspense } from "react";
import { LeadDetailView } from "@/features/leads/lead-detail";

export const metadata: Metadata = { title: "Lead" };

export default function LeadPage() {
  return (
    <Suspense>
      <LeadDetailView />
    </Suspense>
  );
}
