import type { Metadata } from "next";
import { CallsView } from "@/features/calls/calls-view";

export const metadata: Metadata = { title: "Calls" };

export default function CallsPage() {
  return <CallsView />;
}
