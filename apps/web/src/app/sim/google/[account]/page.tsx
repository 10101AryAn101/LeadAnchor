import type { Metadata } from "next";
import { Suspense } from "react";
import { SimulatedGoogle } from "@/features/reviews/simulated-google";

export const metadata: Metadata = {
  title: "Google listing (simulated)",
  robots: { index: false, follow: false },
};

/** Development only: stands in for the business's Google listing (module 9). */
export default function SimulatedGooglePage({ params }: { params: Promise<{ account: string }> }) {
  return (
    <main className="min-h-dvh bg-muted/40">
      <Suspense>
        <Loader params={params} />
      </Suspense>
    </main>
  );
}

async function Loader({ params }: { params: Promise<{ account: string }> }) {
  const { account } = await params;
  return <SimulatedGoogle account={account} />;
}
