import type { PublicPlan } from "@leadanchor/contracts";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { PlanSignup } from "@/features/memberships/plan-signup";
import { BrokenLink } from "@/features/money/business-header";

export const metadata: Metadata = { title: "Join", robots: { index: false, follow: false } };

const API_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

/** C-48: a plan's sign-up link, shared by the business. */
export default function PlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ joined?: string }>;
}) {
  return (
    <main className="min-h-dvh bg-background">
      <Suspense fallback={<Loading />}>
        <Loader params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Loader({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ joined?: string }>;
}) {
  const [{ token }, { joined }] = await Promise.all([params, searchParams]);
  let data: PublicPlan | null = null;
  try {
    const response = await fetch(
      `${API_URL}/api/public/membership-plans/${encodeURIComponent(token)}`,
      { cache: "no-store" },
    );
    if (response.ok) data = (await response.json()) as PublicPlan;
  } catch {
    data = null;
  }
  if (!data)
    return (
      <BrokenLink
        title="This link isn't working"
        body="The plan may have been removed. Please ask the business for a new link."
      />
    );
  return (
    <PlanSignup
      token={token}
      data={data}
      joinedId={joined && /^[0-9a-f-]{36}$/i.test(joined) ? joined : null}
    />
  );
}

function Loading() {
  return (
    <div className="mx-auto max-w-xl space-y-4 px-5 py-8">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-56 rounded-xl" />
      <Skeleton className="h-32 rounded-lg" />
    </div>
  );
}
