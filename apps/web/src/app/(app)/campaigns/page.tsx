import type { Metadata } from "next";
import { Suspense } from "react";
import { CampaignsView } from "@/features/campaigns/campaigns-view";

export const metadata: Metadata = { title: "Campaigns" };

export default function CampaignsPage() {
  return (
    <Suspense>
      <CampaignsView />
    </Suspense>
  );
}
