import type { PublicFeedbackContext } from "@leadanchor/contracts";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { BrokenLink } from "@/features/money/business-header";
import { PrivateFeedback } from "@/features/reviews/customer-pages";

export const metadata: Metadata = {
  title: "Message the business",
  robots: { index: false, follow: false },
};

const API_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

/** C-46: the private line in a review request. No login: the link is the key. */
export default function FeedbackPage({ params }: { params: Promise<{ token: string }> }) {
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
  let context: PublicFeedbackContext | null = null;
  try {
    const response = await fetch(`${API_URL}/api/public/feedback/${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
    if (response.ok) context = (await response.json()) as PublicFeedbackContext;
  } catch {
    context = null;
  }
  if (!context)
    return (
      <BrokenLink
        title="This link isn't working"
        body="It may be mistyped. Please call or text the business instead."
      />
    );
  return <PrivateFeedback token={token} initial={context} />;
}

function Loading() {
  return (
    <div className="mx-auto max-w-xl space-y-4 px-5 py-8">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-48 rounded-lg" />
    </div>
  );
}
