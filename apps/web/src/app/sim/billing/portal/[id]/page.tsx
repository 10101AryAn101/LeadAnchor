import type { Metadata } from "next";
import { Suspense } from "react";
import { SimulatedTierPortal } from "@/features/billing/simulated-billing";

export const metadata: Metadata = {
  title: "Manage billing (simulated)",
  robots: { index: false, follow: false },
};

/** Development only: stands in for Stripe's billing page for the business's LeadAnchor plan. */
export default function SimulatedTierPortalPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="min-h-dvh bg-muted/40">
      <Suspense>
        <Loader params={params} />
      </Suspense>
    </main>
  );
}

async function Loader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SimulatedTierPortal id={id} />;
}
