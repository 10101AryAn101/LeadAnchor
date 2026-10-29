import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { LeadsBoard } from "@/features/leads/leads-board";

export const metadata: Metadata = { title: "Leads" };

export default function LeadsPage() {
  return (
    <div className="space-y-5">
      <PageHeader title="Leads" description="Every caught call becomes a card. Call or text from the card; move it along as the job progresses." />
      <Suspense>
        <LeadsBoard />
      </Suspense>
    </div>
  );
}
