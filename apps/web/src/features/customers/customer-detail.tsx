"use client";

import { CALL_OUTCOME_LABELS, type CustomerDetail, type CustomerJob, LEAD_STAGE_LABELS, PAYMENT_METHOD_LABELS } from "@leadanchor/contracts";
import { IconChevronLeft, IconChevronRight, IconFileDollar, IconLock, IconMessage, IconPhone, IconReceipt, IconSend, IconShieldCheck, IconShieldX } from "@tabler/icons-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { QuoteStatusChip } from "@/features/money/quote-status";
import { StageGlyph, UrgencyChip } from "@/features/leads/lead-meta";
import { TagChips } from "@/features/leads/lead-tags";
import { useRecordContact } from "@/features/leads/use-lead-actions";
import { amount, duration, formatPhone, fullDate, money, smsHref, telHref, timeAgo } from "@/lib/format";
import { useConsent, useCustomer } from "@/lib/queries";

/** C-34: one customer's whole story in one place: jobs, quotes, payments, calls, photos and what they've spent. */
export function CustomerDetailView() {
  const { id } = useParams<{ id: string }>();
  const { data: customer, isPending, error } = useCustomer(id);
  const recordContact = useRecordContact();

  if (isPending) return <DetailSkeleton />;
  if (error || !customer) {
    return (
      <Empty className="py-20">
        <EmptyHeader>
          <EmptyTitle>We couldn&apos;t find that customer</EmptyTitle>
          <EmptyDescription>Head back to your customer list.</EmptyDescription>
        </EmptyHeader>
        <Button nativeButton={false} render={<Link href="/customers" />}>
          Back to customers
        </Button>
      </Empty>
    );
  }

  const name = customer.name ?? formatPhone(customer.phone);
  // Calling or texting from here counts against their open job, like on the lead page.
  const openJob = customer.jobs.find((job) => job.stage !== "won" && job.stage !== "lost");
  const contact = (channel: "call" | "text") => openJob && recordContact({ id: openJob.id, customer: { phone: customer.phone } }, channel);

  return (
    <div className="space-y-6">
      <Link href="/customers" className="-ml-1 inline-flex min-h-11 items-center gap-1 text-[15px] font-medium text-muted-foreground hover:text-foreground">
        <IconChevronLeft className="size-5" /> Customers
      </Link>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {customer.stats.jobs >= 2 && <Badge variant="outline">Repeat customer</Badge>}
          {customer.phone && <TextingStatus phone={customer.phone} />}
        </div>
        <h1 className="font-display text-[28px] leading-[34px] font-semibold">{name}</h1>
        <p className="text-[15px] text-muted-foreground">
          {customer.name && <span className="tabular">{formatPhone(customer.phone)}. </span>}
          Customer since {fullDate(customer.firstSeenAt)}
        </p>
        {customer.phone && (
          <div className="flex flex-wrap gap-2 pt-1">
            <Button nativeButton={false} render={<a href={telHref(customer.phone)} />} onClick={() => contact("call")}>
              <IconPhone /> Call
            </Button>
            <Button variant="outline" nativeButton={false} render={<a href={smsHref(customer.phone)} />} onClick={() => contact("text")}>
              <IconMessage /> Text
            </Button>
          </div>
        )}
      </header>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Jobs" value={String(customer.stats.jobs)} />
        <Stat label="Won" value={String(customer.stats.wonJobs)} />
        <Stat label="Won jobs worth" value={money(customer.stats.lifetimeValueCents)} />
        <Stat label="Paid you so far" value={amount(customer.stats.paidCents)} />
      </dl>

      <section className="space-y-3">
        <h2 className="text-[17px] font-bold">
          What they&apos;ve asked for
          {customer.stats.openJobs > 0 && <span className="ml-2 text-[15px] font-medium text-muted-foreground">{customer.stats.openJobs} open now</span>}
        </h2>
        <ul className="divide-y rounded-lg border bg-card">
          {customer.jobs.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </ul>
      </section>

      {(customer.quotes.length > 0 || customer.payments.length > 0) && <MoneyHistory customer={customer} />}

      {customer.photos.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[17px] font-bold">Photos</h2>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {customer.photos.map((photo) => (
              <Link
                key={photo.id}
                href={`/leads/${photo.leadId}`}
                className="aspect-square overflow-hidden rounded-md border bg-muted"
                aria-label={photo.issue ? `Photo: ${photo.issue}` : "Open the job for this photo"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element -- private image served by our API */}
                <img src={`/api/media/${photo.id}?variant=thumb`} alt="" className="size-full object-cover" />
              </Link>
            ))}
          </div>
        </section>
      )}

      {customer.calls.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[17px] font-bold">Calls</h2>
          <ul className="divide-y rounded-lg border bg-card">
            {customer.calls.map((call) => (
              <li key={call.id} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2.5">
                <span>
                  <span className="block font-medium">{CALL_OUTCOME_LABELS[call.outcome]}</span>
                  <span className="block text-sm text-muted-foreground">{fullDate(call.startedAt)}</span>
                </span>
                <span className="tabular text-sm text-muted-foreground">{duration(call.durationSecs)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {(customer.email || customer.address) && (
        <section className="space-y-2 rounded-lg border bg-card p-4 text-[15px]">
          <h2 className="font-bold">Contact details</h2>
          {customer.address && <p>{customer.address}</p>}
          {customer.email && <p>{customer.email}</p>}
        </section>
      )}
    </div>
  );
}

function JobRow({ job }: { job: CustomerJob }) {
  const value = job.valueCents != null ? money(job.valueCents) : job.estimatedValueCents != null && job.stage !== "lost" ? `${money(job.estimatedValueCents)} est.` : null;
  return (
    <li>
      <Link href={`/leads/${job.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60">
        <StageGlyph stage={job.stage} className="size-5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{job.title}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            {LEAD_STAGE_LABELS[job.stage]}, {timeAgo(job.createdAt)}
            <UrgencyChip urgency={job.urgency} />
            <TagChips tags={job.tags} max={3} />
          </span>
        </span>
        {value && <span className="tabular shrink-0 text-[15px] font-semibold">{value}</span>}
        <IconChevronRight className="size-5 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}

/** Quotes and payments across all their jobs, newest first. */
function MoneyHistory({ customer }: { customer: CustomerDetail }) {
  const rows = [
    ...customer.quotes.map((quote) => ({ key: `q-${quote.id}`, at: quote.sentAt ?? quote.updatedAt, href: `/leads/${quote.leadId}/quotes/${quote.id}`, quote, payment: null })),
    ...customer.payments.map((payment) => ({ key: `p-${payment.id}`, at: payment.paidAt ?? payment.heldAt ?? payment.createdAt, href: `/leads/${payment.leadId}`, quote: null, payment })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <section className="space-y-3">
      <h2 className="text-[17px] font-bold">Quotes and payments</h2>
      <ul className="divide-y rounded-lg border bg-card">
        {rows.map((row) => (
          <li key={row.key}>
            <Link href={row.href} className="flex min-h-16 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60">
              {row.quote ? (
                <>
                  <IconFileDollar className="size-5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2 font-semibold">
                      Quote {row.quote.number} <QuoteStatusChip quote={row.quote} />
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {row.quote.title}, {timeAgo(row.at)}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-[15px] font-semibold">{money(row.quote.totalCents)}</span>
                </>
              ) : row.payment ? (
                <>
                  {row.payment.status === "paid" ? (
                    <IconReceipt className="size-5 shrink-0 text-primary" />
                  ) : row.payment.status === "held" ? (
                    <IconLock className="size-5 shrink-0 text-info-strong" />
                  ) : (
                    <IconSend className="size-5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">
                      {row.payment.status === "paid"
                        ? `Paid${row.payment.card ? ` by ${row.payment.card}` : row.payment.method ? ` by ${PAYMENT_METHOD_LABELS[row.payment.method]}` : ""}`
                        : row.payment.status === "held"
                          ? "Deposit on hold"
                          : row.payment.status === "open"
                            ? "Pay link, not paid yet"
                            : row.payment.status === "released"
                              ? "Hold released"
                              : "Pay link closed"}
                    </span>
                    <span className="block truncate text-sm text-muted-foreground">
                      {row.payment.description}, {timeAgo(row.at)}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-[15px] font-semibold">{amount(row.payment.amountCents)}</span>
                </>
              ) : null}
              <IconChevronRight className="size-5 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="tabular mt-1 font-display text-2xl font-semibold">{value}</dd>
    </div>
  );
}

/** Whether we may text them, straight from the consent ledger (C-27); entries come newest first. */
function TextingStatus({ phone }: { phone: string }) {
  const { data } = useConsent(phone);
  if (!data) return null;
  const latest = data.entries.find((entry) => entry.type === "sms_transactional");
  return latest?.action === "GRANTED" ? (
    <Badge variant="outline" className="gap-1">
      <IconShieldCheck className="size-3.5" /> OK to text
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 text-muted-foreground">
      <IconShieldX className="size-3.5" /> No permission to text
    </Badge>
  );
}

function DetailSkeleton() {
  return (
    <div className="space-y-4 pt-12">
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-11 w-48" />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
        <Skeleton className="h-20 rounded-lg" />
      </div>
      <Skeleton className="h-64 rounded-lg" />
    </div>
  );
}
