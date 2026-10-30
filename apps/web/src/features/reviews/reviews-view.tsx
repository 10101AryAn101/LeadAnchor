"use client";

import {
  type ReviewRequestItem,
  type ReviewRequestOutcome,
  type ReviewsResponse,
  reviewRequestMessage,
} from "@leadanchor/contracts";
import {
  IconAlertTriangle,
  IconBrandGoogle,
  IconCircleCheck,
  IconExternalLink,
  IconMailForward,
  IconMessageCircle,
  IconRefresh,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { api, isApiError } from "@/lib/api";
import { fullDate, timeAgo } from "@/lib/format";
import { keys, useMe, useReviews } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { ReviewCard } from "./review-card";
import { Stars } from "./stars";

/** C-21, C-23, C-46, C-47: the Google rating, replies waiting, and the request every finished job gets. */
export function ReviewsView() {
  const { data, isPending } = useReviews();
  return (
    <div className="space-y-6 pb-24 lg:pb-0">
      <PageHeader
        title="Reviews"
        description="Your Google reviews with a reply drafted for each, and the review request every finished job gets."
        actions={
          data?.listing.listingUrl && (
            <Button
              variant="outline"
              nativeButton={false}
              render={<a href={data.listing.listingUrl} target="_blank" rel="noreferrer" />}
            >
              <IconExternalLink /> Open on Google
            </Button>
          )
        }
      />
      {isPending || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-56 rounded-lg" />
        </div>
      ) : (
        <Content data={data} />
      )}
    </div>
  );
}

function Content({ data }: { data: ReviewsResponse }) {
  const waiting = data.reviews.filter((review) => review.replyStatus !== "posted");
  const answered = data.reviews.filter((review) => review.replyStatus === "posted");
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-6">
        {data.listing.connected ? <RatingCard data={data} /> : <ConnectCard />}
        {waiting.length > 0 && (
          <section aria-labelledby="needs-reply" className="space-y-3">
            <h2 id="needs-reply" className="text-[17px] font-bold">
              Waiting for your reply{" "}
              <span className="font-normal text-muted-foreground">· {waiting.length}</span>
            </h2>
            {waiting.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </section>
        )}
        {answered.length > 0 && (
          <section aria-labelledby="answered" className="space-y-3">
            <h2 id="answered" className="text-[17px] font-bold">
              Replied
            </h2>
            <p className="text-[15px] text-muted-foreground">
              Switch on the good ones to show them on your profile page.
            </p>
            {answered.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </section>
        )}
        {data.listing.connected && data.reviews.length === 0 && (
          <p className="rounded-lg border border-dashed p-4 text-[15px] text-muted-foreground">
            No reviews yet. Every finished job now gets a request, so they&apos;ll start coming in.
          </p>
        )}
      </div>
      <aside className="space-y-4">
        <RequestsCard data={data} />
      </aside>
    </div>
  );
}

function RatingCard({ data }: { data: ReviewsResponse }) {
  const queryClient = useQueryClient();
  const sync = useMutation({
    mutationFn: () => api("/listing/sync", { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.reviews });
      void queryClient.invalidateQueries({ queryKey: keys.reviewsSummary });
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't check Google."),
  });
  const { listing, stats } = data;
  return (
    <section className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-center gap-3">
        <span className="tabular font-display text-[40px] leading-none font-semibold">
          {stats.average?.toFixed(1) ?? "–"}
        </span>
        <div>
          <Stars rating={stats.average ?? 0} className="text-[19px]" />
          <p className="text-sm text-muted-foreground">
            {stats.count} {stats.count === 1 ? "review" : "reviews"} on Google
          </p>
        </div>
      </div>
      <dl className="flex gap-6 text-[15px]">
        <div>
          <dt className="text-sm text-muted-foreground">New this week</dt>
          <dd className="tabular font-semibold">{stats.newThisWeek}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Need a reply</dt>
          <dd className={cn("tabular font-semibold", stats.needReply > 0 && "text-signal-strong")}>
            {stats.needReply}
          </dd>
        </div>
      </dl>
      <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
        {listing.simulated && (
          <span className="inline-flex h-6 items-center rounded-full bg-muted px-2 text-[13px] font-medium">
            Simulator
          </span>
        )}
        {listing.lastSyncedAt && <span>Checked {timeAgo(listing.lastSyncedAt)}</span>}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Check Google now"
          disabled={sync.isPending}
          onClick={() => sync.mutate()}
        >
          {sync.isPending ? <Spinner /> : <IconRefresh />}
        </Button>
      </div>
      {listing.error && (
        <p className="flex w-full items-start gap-1.5 rounded-md bg-signal-subtle p-2.5 text-sm text-signal-strong">
          <IconAlertTriangle className="mt-0.5 size-4 shrink-0" /> {listing.error}
        </p>
      )}
    </section>
  );
}

function ConnectCard() {
  const queryClient = useQueryClient();
  const connect = useMutation({
    mutationFn: () =>
      api<{ url: string | null }>("/listing/connect", {
        method: "POST",
        body: { provider: "simulator" },
      }),
    onSuccess: ({ url }) => {
      if (url) return window.location.assign(url);
      void queryClient.invalidateQueries({ queryKey: keys.reviews });
      void queryClient.invalidateQueries({ queryKey: keys.listing });
      toast.success("Google listing connected.");
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't connect Google."),
  });
  return (
    <section className="space-y-3 rounded-lg border bg-card p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <IconBrandGoogle className="size-5" />
        </span>
        <div>
          <h2 className="font-semibold">Connect your Google listing</h2>
          <p className="text-[15px] text-muted-foreground">
            New reviews come in here with a reply drafted for you to approve, your rating shows on
            your profile page, and your hours, phone and Book link stay up to date on Google.
          </p>
        </div>
      </div>
      <Button disabled={connect.isPending} onClick={() => connect.mutate()}>
        {connect.isPending ? <Spinner /> : <IconBrandGoogle />} Connect Google
      </Button>
      <p className="text-sm text-muted-foreground">
        Google isn&apos;t set up yet, so a simulated listing stands in.
      </p>
    </section>
  );
}

const OUTCOME: Record<ReviewRequestOutcome, { label: string; tone: string }> = {
  scheduled: { label: "Waiting", tone: "bg-muted text-muted-foreground" },
  sent: { label: "Sent", tone: "bg-primary-subtle text-primary-subtle-foreground" },
  no_email: { label: "No email", tone: "bg-signal-subtle text-signal-strong" },
  no_google_link: { label: "No Google link", tone: "bg-signal-subtle text-signal-strong" },
  no_address: { label: "No address", tone: "bg-signal-subtle text-signal-strong" },
  unsubscribed: { label: "Unsubscribed", tone: "bg-muted text-muted-foreground" },
  canceled: { label: "Not finished", tone: "bg-muted text-muted-foreground" },
};

function requestLine(request: ReviewRequestItem) {
  if (request.outcome === "scheduled") {
    return (
      request.detail ??
      (Date.parse(request.sendAt) > Date.now()
        ? `Goes out ${fullDate(request.sendAt)}`
        : "Going out now")
    );
  }
  return request.detail;
}

/** C-46: the same request for every finished job, and proof that every one was asked (AC 7). */
function RequestsCard({ data }: { data: ReviewsResponse }) {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const { requests } = data;
  const waiting = requests.recent.some((request) => request.outcome === "scheduled");
  const sendNow = useMutation({
    mutationFn: () =>
      api<{ count: number }>("/dev/simulator/review-requests/send-now", { method: "POST" }),
    onSuccess: ({ count }) => {
      void queryClient.invalidateQueries({ queryKey: keys.reviews });
      toast.success(count === 1 ? "Sent the waiting request." : `Sent ${count} waiting requests.`);
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't send them."),
  });
  const preview = reviewRequestMessage({
    firstName: "{first name}",
    business: me?.tenant?.name ?? "Your business",
    googleLink: "[your Google review link]",
    privateLink: "[a private line to you]",
  });

  return (
    <section className="space-y-4 rounded-lg border bg-card p-4">
      <div className="space-y-1">
        <h2 className="flex items-center gap-2 font-bold">
          <IconMailForward className="size-5 text-muted-foreground" /> Review requests
        </h2>
        <p className="text-[15px] text-muted-foreground">
          Shortly after you mark a job Won, the customer gets one email: your Google review link,
          and a private line to you if anything went wrong. Every finished job, the same way:
          that&apos;s what keeps it within Google&apos;s rules.
        </p>
      </div>

      {requests.completedJobs > 0 && (
        <p className="flex items-center gap-2 rounded-md bg-primary-subtle p-3 text-[15px] text-primary-subtle-foreground">
          <IconCircleCheck className="size-5 shrink-0" />
          {requests.requested} of {requests.completedJobs} finished{" "}
          {requests.completedJobs === 1 ? "job" : "jobs"} asked · {requests.sent} sent
        </p>
      )}
      {!data.reviewLink && (
        <Warning>
          Connect Google (or paste your Google listing link in{" "}
          <Link href="/settings" className="font-semibold underline">
            Settings
          </Link>
          ): requests wait until there&apos;s a link to send.
        </Warning>
      )}
      {!data.postalAddress && (
        <Warning>
          Add your business address (street and ZIP) in{" "}
          <Link href="/settings" className="font-semibold underline">
            Settings
          </Link>
          . US anti-spam law requires it in these emails, so requests wait until it&apos;s there.
        </Warning>
      )}

      {requests.recent.length > 0 && (
        <ul className="divide-y">
          {requests.recent.map((request) => (
            <li key={request.id} className="flex items-start gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/leads/${request.leadId}`}
                  className="block truncate text-[15px] font-semibold hover:underline"
                >
                  {request.customerName ?? "Customer"} · {request.jobTitle}
                </Link>
                {requestLine(request) && (
                  <p className="text-sm text-muted-foreground">{requestLine(request)}</p>
                )}
                {request.feedbackAt && (
                  <p className="mt-0.5 flex items-center gap-1 text-sm font-semibold text-signal-strong">
                    <IconMessageCircle className="size-4" /> Sent you a private message
                  </p>
                )}
              </div>
              <span
                className={cn(
                  "inline-flex h-6 shrink-0 items-center rounded-full px-2 text-[13px] font-semibold",
                  OUTCOME[request.outcome].tone,
                )}
              >
                {OUTCOME[request.outcome].label}
              </span>
            </li>
          ))}
        </ul>
      )}
      {requests.recent.length === 0 && (
        <p className="text-[15px] text-muted-foreground">
          The first one goes out when you next mark a job Won.
        </p>
      )}

      <details className="group rounded-md border bg-background">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 text-[15px] font-semibold">
          See the email
        </summary>
        <div className="space-y-2 border-t p-3 text-[15px]">
          <p className="font-semibold">{preview.subject}</p>
          <p className="leading-6 whitespace-pre-wrap">{preview.body}</p>
          <p className="text-sm text-muted-foreground">
            The wording is fixed: no offers, no &ldquo;only if you&apos;re happy&rdquo;, and the
            private line never replaces the review. Each email also carries your address and an
            unsubscribe link.
          </p>
        </div>
      </details>

      {waiting && process.env.NODE_ENV !== "production" && (
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          disabled={sendNow.isPending}
          onClick={() => sendNow.mutate()}
        >
          Simulator: send waiting requests now
        </Button>
      )}
    </section>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 rounded-md bg-signal-subtle p-2.5 text-sm text-signal-strong">
      <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
