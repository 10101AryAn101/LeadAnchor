import type { ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";

/**
 * The shell renders every page immediately; only the parts that need the signed-in
 * session or the current URL load in place (see AppShell), so navigations are instant.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
