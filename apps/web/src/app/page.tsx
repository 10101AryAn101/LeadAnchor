import { TIER_DETAILS, TIERS, TRIAL_DAYS, WEBSITE_ADDON } from "@leadanchor/contracts";
import {
  IconCalendarEvent,
  IconCamera,
  IconCheck,
  IconCreditCard,
  IconHeadset,
  IconLayoutKanban,
  IconMessage,
  IconPhoneIncoming,
  IconSparkles,
  IconStar,
  IconUsersGroup,
  IconWorld,
} from "@tabler/icons-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { amount } from "@/lib/format";

export const metadata: Metadata = {
  title: { absolute: "LeadAnchor: never lose a job to a missed call" },
  description:
    "For plumbers, electricians, HVAC and other local pros. LeadAnchor catches the calls you can't pick up, texts the customer back, and puts the job on your board. Free for 14 days.",
};

const STEPS = [
  {
    title: "Forward your number",
    body: "You get a local LeadAnchor line. Forward your business number to it: calls still ring your cell first.",
  },
  {
    title: "We answer when you can't",
    body: "Busy on a job? The AI Dispatcher picks up in your business's name, finds out what they need, and texts them a request form.",
  },
  {
    title: "The job lands on your board",
    body: "With their photos and notes. Call back, quote, book and get paid from your phone.",
  },
];

const FEATURES = [
  {
    icon: IconPhoneIncoming,
    title: "Every missed call caught",
    body: "Hang-ups, voicemails and after-hours calls become leads, with a text back in seconds.",
  },
  {
    icon: IconHeadset,
    title: "AI Dispatcher",
    body: "Greets new callers in your business's name and gets the details while you work.",
  },
  {
    icon: IconCamera,
    title: "Photos before you go",
    body: "Customers send photos of the problem; you see what you're walking into.",
  },
  {
    icon: IconLayoutKanban,
    title: "A simple job board",
    body: "New, contacted, quoted, scheduled, won: every job and every customer's history in one place.",
  },
  {
    icon: IconCreditCard,
    title: "Deposits and pay links",
    body: "Take a deposit up front and send the bill when you finish. Card, Zelle or Venmo.",
  },
  {
    icon: IconCalendarEvent,
    title: "Online booking",
    body: "Customers pick a free time; reminders cut no-shows, and the waitlist fills cancellations.",
  },
  {
    icon: IconStar,
    title: "More Google reviews",
    body: "Every finished job gets a review request, and every review gets a reply drafted for you.",
  },
  {
    icon: IconMessage,
    title: "Win back old customers",
    body: "Seasonal offers to past customers by email, only to people who can get them.",
  },
  {
    icon: IconUsersGroup,
    title: "Trusted pros nearby",
    body: "Too busy? Pass the job to a vetted local pro instead of letting it go.",
  },
  {
    icon: IconSparkles,
    title: "Found when people ask AI",
    body: "A page AI assistants can read, built from your real jobs and reviews.",
  },
];

const FAQ = [
  {
    question: "Do I have to change my phone number?",
    answer:
      "No. You get a local LeadAnchor line and forward your existing number to it. Your cell rings first; LeadAnchor only steps in when you don't pick up.",
  },
  {
    question: "What happens after the free trial?",
    answer:
      "Pick the plan that fits. If you don't, missed calls are still caught and texted back, and your board and payments keep working; the Pro and Growth features pause until you choose a plan.",
  },
  {
    question: "Will you text my customers ads?",
    answer:
      "No. Texts only go to people who contacted you, about their request. Offers go by email, to customers who can get them, with a one-tap opt-out.",
  },
  {
    question: "Can I cancel any time?",
    answer:
      "Yes, from Settings. You keep your plan until the end of the month you paid for, and you won't be charged again.",
  },
  {
    question: "Is my customers' information safe?",
    answer:
      "Card numbers never touch LeadAnchor: payments go through Stripe. Your customers' details are yours and are never sold or shared.",
  },
];

/** The public front door (spec: "a marketing site, light; not a CMS build"). Signed-in owners go straight to their dashboard. */
export default function HomePage() {
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-5">
          <Link href="/" aria-label="LeadAnchor home">
            <Logo />
          </Link>
          <nav className="ml-auto flex items-center gap-1 sm:gap-2" aria-label="Main">
            <a
              href="#pricing"
              className="hidden min-h-11 items-center px-3 text-[15px] font-medium text-muted-foreground hover:text-foreground sm:inline-flex"
            >
              Pricing
            </a>
            <Button variant="ghost" nativeButton={false} render={<Link href="/sign-in" />}>
              Sign in
            </Button>
            <Button nativeButton={false} render={<Link href="/sign-up" />}>
              Start free
            </Button>
          </nav>
        </div>
      </header>

      <main>
        <section className="border-b bg-muted/40">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:py-24">
            <p className="text-[15px] font-semibold text-primary">
              For plumbers, electricians, HVAC, roofers and other local pros
            </p>
            <h1 className="mt-3 max-w-3xl font-display text-[40px] leading-[1.1] font-semibold sm:text-[56px]">
              Never lose a job to a missed call again.
            </h1>
            <p className="mt-5 max-w-2xl text-[17px] leading-7 text-muted-foreground sm:text-[19px] sm:leading-8">
              LeadAnchor catches the calls you can&apos;t pick up, texts the customer back in
              seconds, and puts the job on your board, with photos, ready to quote, book and get
              paid.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button size="lg" nativeButton={false} render={<Link href="/sign-up" />}>
                Try it free for {TRIAL_DAYS} days
              </Button>
              <Button size="lg" variant="outline" nativeButton={false} render={<a href="#how" />}>
                See how it works
              </Button>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              No card needed. Set up in about two minutes.
            </p>
          </div>
        </section>

        <section id="how" className="scroll-mt-16">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <h2 className="font-display text-[30px] font-semibold">How it works</h2>
            <ol className="mt-8 grid gap-4 md:grid-cols-3">
              {STEPS.map((step, index) => (
                <li key={step.title} className="rounded-lg border bg-card p-5">
                  <span className="tabular flex size-9 items-center justify-center rounded-full bg-primary text-[15px] font-bold text-primary-foreground">
                    {index + 1}
                  </span>
                  <h3 className="mt-4 text-[17px] font-bold">{step.title}</h3>
                  <p className="mt-1 text-[15px] leading-6 text-muted-foreground">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="border-y bg-muted/40">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <h2 className="font-display text-[30px] font-semibold">
              Everything after the phone rings
            </h2>
            <ul className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <li key={feature.title} className="flex gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary-subtle-foreground">
                    <feature.icon className="size-5" />
                  </span>
                  <div>
                    <h3 className="font-semibold">{feature.title}</h3>
                    <p className="text-[15px] leading-6 text-muted-foreground">{feature.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section id="pricing" className="scroll-mt-16">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <h2 className="font-display text-[30px] font-semibold">Simple monthly plans</h2>
            <p className="mt-2 text-[17px] text-muted-foreground">
              Every plan starts with {TRIAL_DAYS} days of everything, free. Cancel any time.
            </p>
            <ul className="mt-8 grid gap-4 md:grid-cols-3">
              {TIERS.map((tier) => {
                const details = TIER_DETAILS[tier];
                return (
                  <li key={tier} className="flex flex-col rounded-lg border bg-card p-5">
                    <h3 className="font-display text-xl font-semibold">{details.name}</h3>
                    <p className="tabular mt-1">
                      <span className="text-3xl font-semibold">{amount(details.priceCents)}</span>
                      <span className="text-muted-foreground"> / month</span>
                    </p>
                    <p className="mt-1 text-[15px] text-muted-foreground">{details.pitch}</p>
                    <ul className="mt-4 flex-1 space-y-1.5 text-[15px]">
                      {details.includes.map((item) => (
                        <li key={item} className="flex items-start gap-2">
                          <IconCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                          {item}
                        </li>
                      ))}
                    </ul>
                    <Button
                      className="mt-5 w-full"
                      variant={tier === "pro" ? "default" : "outline"}
                      nativeButton={false}
                      render={<Link href="/sign-up" />}
                    >
                      Start free
                    </Button>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 flex flex-col gap-3 rounded-lg border bg-card p-5 sm:flex-row sm:items-center">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-subtle text-primary-subtle-foreground">
                <IconWorld className="size-5" />
              </span>
              <div className="flex-1">
                <h3 className="font-semibold">{WEBSITE_ADDON.name}, on any plan</h3>
                <p className="text-[15px] text-muted-foreground">
                  A one-page website built from your LeadAnchor details, with your Google listing
                  pointed at it.{" "}
                  <span className="tabular font-semibold text-foreground">
                    {amount(WEBSITE_ADDON.setupCents)} once, then{" "}
                    {amount(WEBSITE_ADDON.monthlyCents)} a month.
                  </span>
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="border-t bg-muted/40">
          <div className="mx-auto max-w-3xl px-5 py-16">
            <h2 className="font-display text-[30px] font-semibold">Questions</h2>
            <div className="mt-6 divide-y rounded-lg border bg-card">
              {FAQ.map((item) => (
                <details key={item.question} className="group px-5 py-4">
                  <summary className="cursor-pointer text-[17px] font-semibold marker:text-muted-foreground">
                    {item.question}
                  </summary>
                  <p className="mt-2 text-[15px] leading-6 text-muted-foreground">{item.answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section>
          <div className="mx-auto max-w-6xl px-5 py-16 text-center">
            <h2 className="font-display text-[30px] font-semibold">
              Your next customer is calling right now.
            </h2>
            <p className="mt-2 text-[17px] text-muted-foreground">Make sure someone answers.</p>
            <Button
              size="lg"
              className="mt-6"
              nativeButton={false}
              render={<Link href="/sign-up" />}
            >
              Try it free for {TRIAL_DAYS} days
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-8 text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} LeadAnchor</p>
          <nav className="flex gap-4" aria-label="Legal">
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link href="/sign-in" className="hover:text-foreground">
              Sign in
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
