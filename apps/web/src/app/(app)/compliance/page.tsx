import type { Metadata } from "next";
import { ComplianceView } from "@/features/compliance/compliance-view";

export const metadata: Metadata = { title: "Texting and consent" };

export default function CompliancePage() {
  return <ComplianceView />;
}
