import type { Metadata } from "next";
import { Suspense } from "react";
import { CustomerDetailView } from "@/features/customers/customer-detail";

export const metadata: Metadata = { title: "Customer" };

export default function CustomerPage() {
  return (
    <Suspense>
      <CustomerDetailView />
    </Suspense>
  );
}
