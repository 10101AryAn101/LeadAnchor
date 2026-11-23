import type { Metadata } from "next";
import { Suspense } from "react";
import { OutboxView } from "@/features/outbox/outbox-view";

export const metadata: Metadata = { title: "Email outbox" };

export default function OutboxPage() {
  return (
    <Suspense>
      <OutboxView />
    </Suspense>
  );
}
