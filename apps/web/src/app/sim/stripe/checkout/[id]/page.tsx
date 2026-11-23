import type { Metadata } from "next";
import { Suspense } from "react";
import { SimulatedCheckout } from "@/features/money/simulated-stripe";

export const metadata: Metadata = {
  title: "Checkout (simulated)",
  robots: { index: false, follow: false },
};

/** Development only: stands in for Stripe's hosted checkout page. */
export default function SimulatedCheckoutPage({ params }: { params: Promise<{ id: string }> }) {
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
  return <SimulatedCheckout id={id} />;
}
