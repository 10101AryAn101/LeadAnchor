import type { PublicMembership } from "@leadanchor/contracts";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { MemberManage } from "@/features/memberships/member-manage";
import { BrokenLink } from "@/features/money/business-header";

export const metadata: Metadata = { title: "Your plan", robots: { index: false, follow: false } };

const API_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

/** C-52: the link in every membership receipt. */
export default function ManagePlanPage({ params }: { params: Promise<{ token: string }> }) {
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
  let data: PublicMembership | null = null;
  try {
    const response = await fetch(`${API_URL}/api/public/memberships/${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
    if (response.ok) data = (await response.json()) as PublicMembership;
  } catch {
    data = null;
  }
  if (!data)
    return (
      <BrokenLink
        title="This link isn't working"
        body="Please open the link from your latest receipt, or call the business."
      />
    );
  return <MemberManage token={token} data={data} />;
}

function Loading() {
  return (
    <div className="mx-auto max-w-xl space-y-4 px-5 py-8">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-48 rounded-xl" />
    </div>
  );
}
