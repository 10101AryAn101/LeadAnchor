import type { Metadata } from "next";
import { SimulatorView } from "@/features/simulator/simulator-view";

export const metadata: Metadata = { title: "Call simulator" };

export default function SimulatorPage() {
  return <SimulatorView />;
}
