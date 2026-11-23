import {
  type PublicBookingContext,
  REQUEST_SOURCES,
  type RequestSource,
} from "@leadanchor/contracts";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { CustomerBooking } from "@/features/booking/customer-booking";
import { BrokenLink } from "@/features/money/business-header";

export const metadata: Metadata = { title: "Book online" };

const API_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

/** C-18: the business's booking page, behind its website button, Google profile and shared link. */
export default function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ src?: string; service?: string; campaign?: string }>;
}) {
  return (
    <main className="min-h-dvh bg-background">
      <Suspense fallback={<BookingSkeleton />}>
        <BookingLoader params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function BookingLoader({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ src?: string; service?: string; campaign?: string }>;
}) {
  const [{ slug }, { src, service, campaign }] = await Promise.all([params, searchParams]);
  let context: PublicBookingContext | null = null;
  try {
    const response = await fetch(`${API_URL}/api/public/booking/${encodeURIComponent(slug)}`, {
      cache: "no-store",
    });
    if (response.ok) context = (await response.json()) as PublicBookingContext;
  } catch {
    context = null;
  }
  if (!context)
    return (
      <BrokenLink
        title="We couldn't find this business"
        body="The link may be mistyped. Please check it and try again."
      />
    );
  const source: RequestSource = (REQUEST_SOURCES as readonly string[]).includes(src ?? "")
    ? (src as RequestSource)
    : "link";
  return (
    <CustomerBooking
      slug={slug}
      context={context}
      source={source}
      initialServiceId={service ?? null}
      campaign={campaign && /^[\w-]{20,64}$/.test(campaign) ? campaign : null}
    />
  );
}

function BookingSkeleton() {
  return (
    <div className="mx-auto max-w-xl space-y-4 px-5 py-8">
      <Skeleton className="h-5 w-40" />
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-20 rounded-lg" />
      <Skeleton className="h-20 rounded-lg" />
      <Skeleton className="h-20 rounded-lg" />
    </div>
  );
}
