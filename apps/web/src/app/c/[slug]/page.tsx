import { type PublicChatContext, REQUEST_SOURCES, type RequestSource } from "@leadanchor/contracts";
import type { Metadata } from "next";
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { CustomerChat } from "@/features/chat/customer-chat";
import { BrokenLink } from "@/features/money/business-header";

export const metadata: Metadata = { title: "Chat", robots: { index: false, follow: false } };

const API_URL = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

/** C-10, C-16: the website chat, behind the website's Chat button and a shareable link. */
export default function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ src?: string }>;
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
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ src?: string }>;
}) {
  const [{ slug }, { src }] = await Promise.all([params, searchParams]);
  let context: PublicChatContext | null = null;
  try {
    const response = await fetch(`${API_URL}/api/public/chat/${encodeURIComponent(slug)}`, {
      cache: "no-store",
    });
    if (response.ok) context = (await response.json()) as PublicChatContext;
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
  return <CustomerChat slug={slug} context={context} source={source} />;
}

function Loading() {
  return (
    <div className="mx-auto max-w-xl space-y-4 px-5 py-6">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-16 w-3/4 rounded-lg" />
    </div>
  );
}
