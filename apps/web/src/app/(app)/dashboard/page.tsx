import type { Metadata } from "next";
import { Suspense } from "react";
import { DashboardView } from "@/features/dashboard/dashboard-view";

export const metadata: Metadata = { title: "Today" };

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardView />
    </Suspense>
  );
}
