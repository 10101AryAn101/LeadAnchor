import type { Metadata } from "next";
import { Suspense } from "react";
import { MembershipsView } from "@/features/memberships/memberships-view";

export const metadata: Metadata = { title: "Memberships" };

export default function MembershipsPage() {
  return (
    <Suspense>
      <MembershipsView />
    </Suspense>
  );
}
