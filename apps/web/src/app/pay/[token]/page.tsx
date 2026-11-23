import type { PublicPayment } from "@leadanchor/contracts";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { BrokenLink } from "@/features/money/business-header";
import { CustomerPayment } from "@/features/money/customer-payment";

export const metadata: Metadata = {
  title: "Payment",
  robots: { index: false, follow: false },
};

const API_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

/** C-15 / C-26: pay a deposit or a bill by card, Zelle or Venmo, and see the receipt. No login. */
export default function PayPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <main className="min-h-dvh bg-background">
      <Suspense fallback={<PaySkeleton />}>
        <PayLoader params={params} />
      </Suspense>
    </main>
  );
}

async function PayLoader({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let payment: PublicPayment | null = null;
  try {
    const response = await fetch(`${API_URL}/api/public/pay/${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
    if (response.ok) payment = (await response.json()) as PublicPayment;
  } catch {
    payment = null;
  }
  if (!payment)
    return (
      <BrokenLink
        title="This link isn't working"
        body="It may be mistyped. Please call or text the business that sent it."
      />
    );
  return <CustomerPayment token={token} initial={payment} />;
}

function PaySkeleton() {
  return (
    <div className="mx-auto max-w-md space-y-4 px-5 py-8">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-48 rounded-lg" />
      <Skeleton className="h-12 rounded-md" />
    </div>
  );
}
