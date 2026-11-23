import type { PublicOffer } from "@leadanchor/contracts";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { WaitlistOffer } from "@/features/booking/customer-manage";
import { BrokenLink } from "@/features/money/business-header";

export const metadata: Metadata = {
  title: "A time opened up",
  robots: { index: false, follow: false },
};

const API_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

/** C-22: a freed slot offered to someone on the waitlist. */
export default function OfferPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <main className="min-h-dvh bg-background">
      <Suspense fallback={<Loading />}>
        <Loader params={params} />
      </Suspense>
    </main>
  );
}

async function Loader({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let offer: PublicOffer | null = null;
  try {
    const response = await fetch(`${API_URL}/api/public/offers/${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
    if (response.ok) offer = (await response.json()) as PublicOffer;
  } catch {
    offer = null;
  }
  if (!offer)
    return (
      <BrokenLink
        title="This link isn't working"
        body="It may be mistyped or the offer has ended."
      />
    );
  return <WaitlistOffer token={token} initial={offer} />;
}

function Loading() {
  return (
    <div className="mx-auto max-w-xl space-y-4 px-5 py-8">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-40 rounded-lg" />
    </div>
  );
}
