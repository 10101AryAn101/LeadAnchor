import { Suspense } from "react";
import { OpsTenant } from "@/features/ops/ops-views";

export default function OpsTenantPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense>
      <Loader params={params} />
    </Suspense>
  );
}

async function Loader({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <OpsTenant id={id} />;
}
