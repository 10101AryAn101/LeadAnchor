import type { PublicHandoff } from "@leadanchor/contracts";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { BrokenLink } from "@/features/money/business-header";
import { CustomerHandoff } from "@/features/network/customer-handoff";

export const metadata: Metadata = {
  title: "Your request",
  robots: { index: false, follow: false },
};

const API_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

/** C-24: a customer whose request was passed to another pro sees who has it, and can stay instead. */
export default function HandoffPage({ params }: { params: Promise<{ token: string }> }) {
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
  let handoff: PublicHandoff | null = null;
  try {
    const response = await fetch(`${API_URL}/api/public/handoffs/${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
    if (response.ok) handoff = (await response.json()) as PublicHandoff;
  } catch {
    handoff = null;
  }
  if (!handoff)
    return (
      <BrokenLink
        title="This link isn't working"
        body="It may be mistyped. Call the business instead."
      />
    );
  return <CustomerHandoff token={token} initial={handoff} />;
}

function Loading() {
  return (
    <div className="mx-auto max-w-xl space-y-4 px-5 py-8">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-40 rounded-lg" />
    </div>
  );
}
