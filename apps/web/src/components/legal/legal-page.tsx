import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";

/** Shared frame for the public Privacy and Terms pages. Readable on a phone first. */
export function LegalPage({ title, updated, intro, children }: { title: string; updated: string; intro: ReactNode; children: ReactNode }) {
  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto max-w-2xl px-5 py-8 sm:py-12">
        <Logo />
        <header className="mt-8 space-y-3 border-b pb-6">
          <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="text-[15px] text-muted-foreground">Last updated {updated}</p>
          <p className="rounded-md bg-signal-subtle px-3 py-2 text-sm text-signal-strong">Draft: this page is waiting for legal review before launch.</p>
          <div className="text-[17px] leading-7">{intro}</div>
        </header>
        <div className="mt-8 space-y-8">{children}</div>
        <footer className="mt-12 flex gap-5 border-t pt-6 text-[15px] text-muted-foreground">
          <Link href="/privacy" className="hover:text-foreground">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-foreground">
            Terms
          </Link>
        </footer>
      </div>
    </main>
  );
}

export function LegalSection({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 space-y-3">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="space-y-3 text-[15px] leading-7 [&_li]:ml-5 [&_li]:list-disc [&_li]:pl-1 [&_ul]:space-y-1.5">{children}</div>
    </section>
  );
}

/** Where to reach us. Set CONTACT_EMAIL in apps/web/.env.local before launch. */
export function ContactLine() {
  const email = process.env.CONTACT_EMAIL;
  return email ? (
    <p>
      Email{" "}
      <a href={`mailto:${email}`} className="font-medium underline underline-offset-4">
        {email}
      </a>
      .
    </p>
  ) : (
    <p>A contact address will be published here before launch.</p>
  );
}
