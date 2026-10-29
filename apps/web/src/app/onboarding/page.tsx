import type { Metadata } from "next";
import { OnboardingWizard } from "@/features/onboarding/onboarding-wizard";

export const metadata: Metadata = { title: "Set up your business" };

export default function OnboardingPage() {
  return <OnboardingWizard />;
}
