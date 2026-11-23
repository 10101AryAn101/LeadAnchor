"use client";

import type { CampaignPreview } from "@leadanchor/contracts";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";

export const previewKey = (id: string) => ["campaign-preview", id] as const;

/**
 * The email exactly as the API builds it for the first person on the list, footer and all. It sits
 * in a sandboxed frame: the page's styles can't change it, and nothing in it can run.
 */
export function EmailPreview({ id, className }: { id: string; className?: string }) {
  const { data, isPending, isError } = useQuery({
    queryKey: previewKey(id),
    queryFn: () => api<CampaignPreview>(`/campaigns/${id}/preview`),
  });
  if (isError)
    return (
      <p className="rounded-lg border border-dashed p-4 text-[15px] text-muted-foreground">
        The preview couldn&apos;t load.
      </p>
    );
  if (isPending || !data) return <Skeleton className="h-[520px] rounded-lg" />;
  return (
    <figure className={className}>
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="space-y-0.5 border-b px-4 py-3 text-sm">
          <p className="truncate font-semibold text-foreground">{data.subject || "(no subject)"}</p>
          <p className="text-muted-foreground">
            {data.sampleName
              ? `As ${data.sampleName} will see it`
              : "As your customers will see it"}
          </p>
        </div>
        <iframe
          title="Email preview"
          srcDoc={data.html}
          sandbox=""
          className="block h-[560px] w-full bg-[#f4f2ec]"
        />
      </div>
    </figure>
  );
}
