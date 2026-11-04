import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";

export const metadata: Metadata = {
  title: { template: "%s · Operator console", default: "Operator console" },
  robots: { index: false },
};

/** Module 14: LeadAnchor's own staff area, outside the business owners' app frame. */
export default function OpsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-5">
          <Link href="/ops" aria-label="Operator console home">
            <Logo />
          </Link>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[13px] font-semibold text-muted-foreground">
            Staff
          </span>
          <Link
            href="/dashboard"
            className="ml-auto text-[15px] font-medium text-muted-foreground hover:text-foreground"
          >
            Back to the app
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-5 py-6">{children}</main>
    </div>
  );
}
