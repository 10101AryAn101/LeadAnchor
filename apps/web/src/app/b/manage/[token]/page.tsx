import type { PublicBooking } from "@leadanchor/contracts";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { CustomerManage } from "@/features/booking/customer-manage";
import { BrokenLink } from "@/features/money/business-header";

export const metadata: Metadata = {
  title: "Your booking",
  robots: { index: false, follow: false },
};

const API_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

/** The customer's own booking: change, cancel or add to calendar. No login: the link is the key. */
export default function ManageBookingPage({ params }: { params: Promise<{ token: string }> }) {
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
  let booking: PublicBooking | null = null;
  try {
    const response = await fetch(`${API_URL}/api/public/bookings/${encodeURIComponent(token)}`, {
      cache: "no-store",
    });
    if (response.ok) booking = (await response.json()) as PublicBooking;
  } catch {
    booking = null;
  }
  if (!booking)
    return (
      <BrokenLink
        title="This link isn't working"
        body="It may be mistyped. Please call or text the business you booked with."
      />
    );
  return <CustomerManage token={token} initial={booking} />;
}

function Loading() {
  return (
    <div className="mx-auto max-w-xl space-y-4 px-5 py-8">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-40 rounded-lg" />
    </div>
  );
}
