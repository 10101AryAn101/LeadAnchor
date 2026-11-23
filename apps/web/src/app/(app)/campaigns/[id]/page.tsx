import type { Metadata } from "next";
import { Suspense } from "react";
import { CampaignView } from "@/features/campaigns/campaign-view";

export const metadata: Metadata = { title: "Campaign" };

export default function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense>
      <Loader params={params} />
    </Suspense>
  );
}

async function Loader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CampaignView id={id} />;
}
