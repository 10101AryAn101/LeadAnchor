import { type IntakeContext, REQUEST_SOURCES, type RequestSource } from "@leadanchor/contracts";
import { IconBuildingStore } from "@tabler/icons-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { IntakeForm, IntakeSkeleton } from "@/features/intake/intake-form";

export const metadata: Metadata = {
  title: "Request service",
  robots: { index: false, follow: false },
};

const API_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

/**
 * C-10: a business's public request form. Its website button (widget.js), its Google
 * profile link (?src=google) and shared links all land here, and every request becomes a lead.
 */
export default function RequestPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ src?: string; campaign?: string }>;
}) {
  return (
    <main className="min-h-dvh bg-background">
      <Suspense fallback={<IntakeSkeleton />}>
        <RequestLoader params={params} searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function RequestLoader({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ src?: string; campaign?: string }>;
}) {
  const { slug } = await params;
  const { src, campaign } = await searchParams;
  const source: RequestSource = REQUEST_SOURCES.find((value) => value === src) ?? "link";

  let context: IntakeContext | null = null;
  try {
    const response = await fetch(`${API_URL}/api/public/request/${encodeURIComponent(slug)}`, { cache: "no-store" });
    if (response.ok) context = (await response.json()) as IntakeContext;
  } catch {
    context = null;
  }

  if (!context) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <IconBuildingStore className="size-6" />
        </span>
        <h1 className="font-display text-2xl font-semibold">We couldn&apos;t find this business</h1>
        <p className="text-muted-foreground">The link may be mistyped. Please call the business instead.</p>
      </div>
    );
  }

  return (
    <IntakeForm
      context={context}
      submitUrl={`/api/public/request/${encodeURIComponent(slug)}`}
      draftKey={`r-${slug}`}
      newRequest={{ source, campaign: campaign && /^[\w-]{20,64}$/.test(campaign) ? campaign : null }}
    />
  );
}
