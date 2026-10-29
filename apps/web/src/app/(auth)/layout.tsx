import { IconFileText, IconHeadset, IconPhoneX } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Logo } from "@/components/brand/logo";

/** Form on the left; on wide screens, a quiet picture of the product doing its job on the right. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-sm">{children}</div>
        </div>
        <p className="text-sm text-muted-foreground">LeadAnchor — every missed call, caught.</p>
      </div>
      <ProductPanel />
    </div>
  );
}

function ProductPanel() {
  return (
    <div className="hidden bg-sidebar lg:flex lg:flex-col lg:justify-center lg:border-l lg:p-14">
      <div className="mx-auto w-full max-w-md">
        <p className="font-display text-[34px] leading-[1.15] font-semibold">The call you missed at 2:14 is already a job on your board.</p>
        <p className="mt-4 text-muted-foreground">
          LeadAnchor answers when you can&apos;t, texts the customer a form, reads their photos and tells you what the job is about.
        </p>

        <ol className="mt-10 space-y-3">
          <TimelineRow
            icon={<IconPhoneX className="size-[18px]" />}
            tone="bg-signal-subtle text-signal-strong"
            time="2:14 PM"
            title="Missed call from (512) 555-2368"
            body="Answered by your AI Dispatcher. Link texted."
          />
          <TimelineRow
            icon={<IconHeadset className="size-[18px]" />}
            tone="bg-primary-subtle text-primary-subtle-foreground"
            time="2:15 PM"
            title="Water heater leaking in garage"
            body="Emergency. Wants someone today."
          />
          <TimelineRow
            icon={<IconFileText className="size-[18px]" />}
            tone="bg-primary-subtle text-primary-subtle-foreground"
            time="2:19 PM"
            title="Dana sent 2 photos"
            body="Gas water heater, corroded drain valve"
          />
        </ol>

        <div className="mt-10 border-t pt-6">
          <p className="text-sm text-muted-foreground">Recovered this month</p>
          <p className="mt-1 font-display text-5xl font-semibold">$6,840</p>
          <p className="mt-1 text-sm text-muted-foreground">Real job values from leads that started as missed calls.</p>
        </div>
      </div>
    </div>
  );
}

function TimelineRow({ icon, tone, time, title, body }: { icon: ReactNode; tone: string; time: string; title: string; body: string }) {
  return (
    <li className="flex gap-3 rounded-lg border bg-card p-3.5">
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-md ${tone}`}>{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate font-semibold">{title}</p>
          <span className="tabular shrink-0 text-sm text-muted-foreground">{time}</span>
        </div>
        <p className="truncate text-sm text-muted-foreground">{body}</p>
      </div>
    </li>
  );
}
