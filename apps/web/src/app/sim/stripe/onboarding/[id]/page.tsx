import type { Metadata } from "next";
import { Suspense } from "react";
import { SimulatedOnboarding } from "@/features/money/simulated-stripe";

export const metadata: Metadata = {
  title: "Payments setup (simulated)",
  robots: { index: false, follow: false },
};

/** Development only: stands in for Stripe's hosted account setup (Connect onboarding). */
export default function SimulatedOnboardingPage({ params }: { params: Promise<{ id: string }> }) {
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
  return <SimulatedOnboarding id={id} />;
}
