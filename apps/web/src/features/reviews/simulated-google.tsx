"use client";

import type { SimGoogleListing } from "@leadanchor/contracts";
import {
  IconCalendarEvent,
  IconFlask,
  IconPhone,
  IconStar,
  IconStarFilled,
  IconWorld,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { BrokenLink } from "@/features/money/business-header";
import { api, isApiError } from "@/lib/api";
import { formatPhone, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Stars } from "./stars";

/**
 * Development only: stands in for the business's Google listing. Customers land here from the
 * review request's Google link; what they post reaches the business's Reviews page straight away.
 */
export function SimulatedGoogle({ account }: { account: string }) {
  const queryKey = ["sim-google", account];
  const { data, isPending, error } = useQuery({
    queryKey,
    queryFn: () => api<SimGoogleListing>(`/dev/simulator/google/${account}`),
    retry: false,
    refetchInterval: 5000,
  });
  if (isPending) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-5 py-8">
        <Skeleton className="h-32 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
    );
  }
  if (error || !data)
    return (
      <BrokenLink
        title="No listing here"
        body="This simulated listing isn't connected to a business."
      />
    );

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-5 py-8 sm:py-12">
      <p className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/60 p-3 text-sm text-muted-foreground">
        <IconFlask className="mt-0.5 size-4 shrink-0" />
        <span>
          Simulated Google listing. It stands in for Google until the API is set up; reviews posted
          here reach the business&apos;s LeadAnchor in seconds.
        </span>
      </p>

      <section className="space-y-3 rounded-lg border bg-card p-5">
        <h1 className="font-display text-[28px] leading-tight font-semibold">{data.name}</h1>
        <p className="flex flex-wrap items-center gap-2 text-[15px]">
          {data.rating !== null ? (
            <>
              <span className="tabular font-semibold">{data.rating.toFixed(1)}</span>
              <Stars rating={data.rating} className="text-[17px]" />
              <span className="text-muted-foreground">
                ({data.reviewCount} {data.reviewCount === 1 ? "review" : "reviews"})
              </span>
            </>
          ) : (
            <span className="text-muted-foreground">No reviews yet</span>
          )}
        </p>
        <div className="flex flex-wrap gap-2">
          {data.bookingLink && (
            <Button nativeButton={false} render={<a href={data.bookingLink} />}>
              <IconCalendarEvent /> Book
            </Button>
          )}
          {data.phone && (
            <Button
              variant="outline"
              nativeButton={false}
              render={<a href={`tel:${data.phone}`} />}
            >
              <IconPhone /> {formatPhone(data.phone)}
            </Button>
          )}
          {data.website && (
            <Button variant="outline" nativeButton={false} render={<a href={data.website} />}>
              <IconWorld /> Website
            </Button>
          )}
        </div>
        {data.hours.length > 0 && (
          <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 border-t pt-3 text-[15px]">
            {data.hours.map((row) => (
              <div key={row.day} className="contents">
                <dt className="text-muted-foreground">{row.day}</dt>
                <dd className={cn(row.hours === "Closed" && "text-muted-foreground")}>
                  {row.hours}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {data.posts.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-[17px] font-bold">Updates from the business</h2>
          {data.posts.slice(0, 3).map((post) => (
            <article key={post.id} className="rounded-lg border bg-card p-4">
              <p className="text-sm text-muted-foreground">{timeAgo(post.createdAt)}</p>
              <p className="mt-1 text-[15px] leading-6 whitespace-pre-wrap">{post.text}</p>
            </article>
          ))}
        </section>
      )}

      <WriteReview account={account} />

      <section className="space-y-3">
        <h2 className="text-[17px] font-bold">Reviews</h2>
        {data.reviews.length === 0 && (
          <p className="text-[15px] text-muted-foreground">Be the first to write one.</p>
        )}
        {data.reviews.map((review) => (
          <article key={review.id} className="space-y-2 rounded-lg border bg-card p-4">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{review.reviewer}</span>
              <Stars rating={review.rating} className="text-[15px]" />
              <span className="text-sm text-muted-foreground">{timeAgo(review.publishedAt)}</span>
            </p>
            {review.text && (
              <p className="text-[15px] leading-6 whitespace-pre-wrap">{review.text}</p>
            )}
            {review.reply && (
              <div className="rounded-md bg-muted p-3">
                <p className="text-sm font-semibold">
                  Response from the owner · {timeAgo(review.reply.updatedAt)}
                </p>
                <p className="mt-1 text-[15px] leading-6 whitespace-pre-wrap">
                  {review.reply.text}
                </p>
              </div>
            )}
          </article>
        ))}
      </section>

      <FailNextReply account={account} on={data.failNextReply} />
    </div>
  );
}

function WriteReview({ account }: { account: string }) {
  const queryClient = useQueryClient();
  const [reviewer, setReviewer] = useState("");
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const post = useMutation({
    mutationFn: () =>
      api<SimGoogleListing>(`/dev/simulator/google/${account}/reviews`, {
        method: "POST",
        body: { reviewer, rating, text },
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(["sim-google", account], data);
      setRating(0);
      setText("");
      toast.success("Review posted.");
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "Couldn't post the review."),
  });
  return (
    <form
      id="write"
      className="scroll-mt-6 space-y-4 rounded-lg border bg-card p-5"
      onSubmit={(event) => {
        event.preventDefault();
        post.mutate();
      }}
    >
      <h2 className="text-[17px] font-bold">Write a review</h2>
      <div className="flex gap-1" role="radiogroup" aria-label="Your rating">
        {[1, 2, 3, 4, 5].map((star) => {
          const Glyph = star <= rating ? IconStarFilled : IconStar;
          return (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={rating === star}
              aria-label={`${star} ${star === 1 ? "star" : "stars"}`}
              onClick={() => setRating(star)}
              className="flex size-11 items-center justify-center rounded-md text-signal hover:bg-muted"
            >
              <Glyph className={cn("size-8", star > rating && "text-muted-foreground/50")} />
            </button>
          );
        })}
      </div>
      <Field>
        <FieldLabel htmlFor="sim-reviewer">Your name (as Google shows it)</FieldLabel>
        <Input
          id="sim-reviewer"
          value={reviewer}
          maxLength={60}
          onChange={(event) => setReviewer(event.target.value)}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="sim-review">Your review (optional)</FieldLabel>
        <Textarea
          id="sim-review"
          rows={4}
          maxLength={4000}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </Field>
      <Button type="submit" disabled={rating === 0 || reviewer.trim().length < 2 || post.isPending}>
        {post.isPending && <Spinner />} Post
      </Button>
    </form>
  );
}

/** C-47 AC 6: make Google refuse the business's next reply, to see the retry and the error. */
function FailNextReply({ account, on }: { account: string; on: boolean }) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: (fail: boolean) =>
      api<SimGoogleListing>(`/dev/simulator/google/${account}/fail-next-reply`, {
        method: "POST",
        body: { fail },
      }),
    onSuccess: (data) => queryClient.setQueryData(["sim-google", account], data),
  });
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-dashed p-4 text-[15px]">
      <span>
        <span className="font-semibold">Simulator: refuse the business&apos;s next reply</span>
        <span className="block text-sm text-muted-foreground">
          To try how a failed post is retried and shown to the owner.
        </span>
      </span>
      <Switch
        checked={on}
        disabled={toggle.isPending}
        onCheckedChange={(checked) => toggle.mutate(checked)}
      />
    </label>
  );
}
