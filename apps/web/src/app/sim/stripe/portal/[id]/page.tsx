import type { Metadata } from "next";
import { Suspense } from "react";
import { SimulatedPortal } from "@/features/money/simulated-stripe";

export const metadata: Metadata = {
  title: "Manage your plan (simulated)",
  robots: { index: false, follow: false },
};

/** Development only: stands in for Stripe's hosted customer portal (C-52). */
export default function SimulatedPortalPage({ params }: { params: Promise<{ id: string }> }) {
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
  return <SimulatedPortal id={id} />;
}
