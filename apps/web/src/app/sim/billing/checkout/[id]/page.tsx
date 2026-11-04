import type { Metadata } from "next";
import { Suspense } from "react";
import { SimulatedTierCheckout } from "@/features/billing/simulated-billing";

export const metadata: Metadata = {
  title: "Choose your plan (simulated)",
  robots: { index: false, follow: false },
};

/** Development only: stands in for Stripe's checkout when a business picks its LeadAnchor plan. */
export default function SimulatedTierCheckoutPage({ params }: { params: Promise<{ id: string }> }) {
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
  return <SimulatedTierCheckout id={id} />;
}
