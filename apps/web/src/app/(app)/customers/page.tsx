import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { CustomersView } from "@/features/customers/customers-view";

export const metadata: Metadata = { title: "Customers" };

export default function CustomersPage() {
  return (
    <div className="space-y-5">
      <PageHeader title="Customers" description="Everyone who has called or sent you a form, with their jobs and what they've spent." />
      <Suspense>
        <CustomersView />
      </Suspense>
    </div>
  );
}
