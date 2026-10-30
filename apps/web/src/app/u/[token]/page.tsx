import type { PublicUnsubscribe } from "@leadanchor/contracts";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { BrokenLink } from "@/features/money/business-header";
import { Unsubscribe } from "@/features/reviews/customer-pages";

export const metadata: Metadata = { title: "Unsubscribe", robots: { index: false, follow: false } };

const API_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

/** The unsubscribe link in review requests and other marketing-type email (CAN-SPAM). */
export default function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
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
  let state: PublicUnsubscribe | null = null;
  try {
    const response = await fetch(`${API_URL}/api/public/unsubscribe/${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
    if (response.ok) state = (await response.json()) as PublicUnsubscribe;
  } catch {
    state = null;
  }
  if (!state)
    return (
      <BrokenLink
        title="This link isn't working"
        body="It may be cut short. Reply to the email and ask to be taken off instead."
      />
    );
  return <Unsubscribe token={token} initial={state} />;
}

function Loading() {
  return (
    <div className="mx-auto max-w-md space-y-4 px-6 py-16">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-24 rounded-lg" />
    </div>
  );
}
