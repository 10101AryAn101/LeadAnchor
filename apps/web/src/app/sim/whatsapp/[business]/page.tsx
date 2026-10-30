import type { Metadata } from "next";
import { Suspense } from "react";
import { SimulatedWhatsApp } from "@/features/chat/simulated-whatsapp";

export const metadata: Metadata = {
  title: "WhatsApp (simulated)",
  robots: { index: false, follow: false },
};

/** Development only: stands in for the customer's WhatsApp, opened from the business's chat link (C-11). */
export default function SimulatedWhatsAppPage({
  params,
  searchParams,
}: {
  params: Promise<{ business: string }>;
  searchParams: Promise<{ text?: string }>;
}) {
  return (
    <main className="min-h-dvh bg-muted/40">
      <Suspense>
        <Loader params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Loader({
  params,
  searchParams,
}: {
  params: Promise<{ business: string }>;
  searchParams: Promise<{ text?: string }>;
}) {
  const [{ business }, { text }] = await Promise.all([params, searchParams]);
  return <SimulatedWhatsApp business={business} prefill={text ?? ""} />;
}
