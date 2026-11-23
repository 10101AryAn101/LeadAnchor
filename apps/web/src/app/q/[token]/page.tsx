import type { PublicQuote } from "@leadanchor/contracts";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { BrokenLink } from "@/features/money/business-header";
import { CustomerQuote } from "@/features/money/customer-quote";

export const metadata: Metadata = {
  title: "Your quote",
  robots: { index: false, follow: false },
};

const API_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

/** C-45: the customer's quote. No login: the link is the key. */
export default function QuotePage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <main className="min-h-dvh bg-background">
      <Suspense fallback={<QuoteSkeleton />}>
        <QuoteLoader params={params} />
      </Suspense>
    </main>
  );
}

async function QuoteLoader({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let quote: PublicQuote | null = null;
  try {
    const response = await fetch(`${API_URL}/api/public/quotes/${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
    if (response.ok) quote = (await response.json()) as PublicQuote;
  } catch {
    quote = null;
  }
  if (!quote)
    return (
      <BrokenLink
        title="This link isn't working"
        body="It may be mistyped. Please call or text the business that sent it."
      />
    );
  return <CustomerQuote token={token} initial={quote} />;
}

function QuoteSkeleton() {
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-5 py-8">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-72 rounded-lg" />
      <Skeleton className="h-12 rounded-md" />
    </div>
  );
}
