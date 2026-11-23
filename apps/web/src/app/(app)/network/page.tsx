import type { Metadata } from "next";
import { Suspense } from "react";
import { NetworkView } from "@/features/network/network-view";

export const metadata: Metadata = { title: "Trusted pros" };

export default function NetworkPage() {
  return (
    <Suspense>
      <NetworkView />
    </Suspense>
  );
}
