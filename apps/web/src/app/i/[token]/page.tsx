import type { IntakeContext } from "@leadanchor/contracts";
import { IconLinkOff } from "@tabler/icons-react";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { IntakeForm } from "@/features/intake/intake-form";

export const metadata: Metadata = {
  title: "Tell us about your job",
  robots: { index: false, follow: false },
};

const API_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

/** Public, no-login request form (C-07, C-08, C-09). The link token is the only credential. */
export default function IntakePage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <main className="min-h-dvh bg-background">
      <Suspense fallback={<IntakeSkeleton />}>
        <IntakeLoader params={params} />
      </Suspense>
    </main>
  );
}

async function IntakeLoader({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let context: IntakeContext | null = null;
  try {
    const response = await fetch(`${API_URL}/api/public/intake/${encodeURIComponent(token)}`, { cache: "no-store" });
    if (response.ok) context = (await response.json()) as IntakeContext;
  } catch {
    context = null;
  }

  if (!context) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <IconLinkOff className="size-6" />
        </span>
        <h1 className="font-display text-2xl font-semibold">This link isn&apos;t working</h1>
        <p className="text-muted-foreground">It may be mistyped or expired. Please call or text the business that sent it.</p>
      </div>
    );
  }

  return <IntakeForm token={token} context={context} />;
}

function IntakeSkeleton() {
  return (
    <div className="mx-auto max-w-md space-y-5 px-5 py-8">
      <Skeleton className="h-16 w-full rounded-lg" />
      <Skeleton className="h-8 w-56" />
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
