"use client";

import { LOW_RATING_MAX, type ReviewItem } from "@leadanchor/contracts";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconCornerDownRight,
  IconRefresh,
  IconSend,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, isApiError } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { keys } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { Stars } from "./stars";

/** One Google review: what they wrote, the reply (drafted by AI, approved by the owner), and the profile switch. */
export function ReviewCard({ review }: { review: ReviewItem }) {
  const queryClient = useQueryClient();
  const low = review.rating <= LOW_RATING_MAX;
  const serverText = review.draft ?? review.reply?.text ?? "";
  const [text, setText] = useState(serverText);
  const [seen, setSeen] = useState(serverText);
  const [editing, setEditing] = useState(false);
  // A draft that arrives (or is redone) fills the box, unless the owner has started typing.
  if (seen !== serverText) {
    if (text === seen) setText(serverText);
    setSeen(serverText);
  }

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: keys.reviews });
    void queryClient.invalidateQueries({ queryKey: keys.reviewsSummary });
  };
  const post = useMutation({
    mutationFn: () =>
      api<ReviewItem>(`/reviews/${review.id}/reply`, { method: "POST", body: { text } }),
    onSuccess: () => {
      setEditing(false);
      refresh();
      toast.success("Approved. Posting your reply to Google.");
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't post the reply."),
  });
  const redraft = useMutation({
    mutationFn: () => api<ReviewItem>(`/reviews/${review.id}/draft`, { method: "POST" }),
    onSuccess: (data) => {
      setText(data.draft ?? "");
      refresh();
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "Couldn't write a new draft."),
  });
  const showOnProfile = useMutation({
    mutationFn: (show: boolean) =>
      api<ReviewItem>(`/reviews/${review.id}`, { method: "PATCH", body: { showOnProfile: show } }),
    onSuccess: (_data, show) => {
      refresh();
      toast.success(show ? "It's on your profile page now." : "Taken off your profile page.");
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't change that."),
  });

  const posting = review.replyStatus === "posting";
  const showEditor = !posting && (review.replyStatus !== "posted" || editing);
  const canFeature = review.rating >= 4 && Boolean(review.text);

  return (
    <article
      className={cn("space-y-3 rounded-lg border bg-card p-4", low && "border-l-4 border-l-signal")}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Stars rating={review.rating} className="text-[17px]" />
        <p className="font-semibold">{review.reviewer}</p>
        <span className="text-sm text-muted-foreground">{timeAgo(review.publishedAt)}</span>
        {low && review.replyStatus !== "posted" && (
          <span className="inline-flex h-6 items-center gap-1 rounded-full bg-signal-subtle px-2 text-[13px] font-semibold text-signal-strong">
            <IconAlertTriangle className="size-3.5" /> Reply soon
          </span>
        )}
        {review.job && (
          <Link
            href={`/leads/${review.job.leadId}`}
            className="ml-auto inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-primary"
          >
            {review.job.title} <IconArrowRight className="size-4" />
          </Link>
        )}
      </header>

      {review.text ? (
        <p className="text-[15px] leading-6 whitespace-pre-wrap">{review.text}</p>
      ) : (
        <p className="text-[15px] text-muted-foreground">A star rating, no words.</p>
      )}

      {review.reply && !editing && (
        <div className="rounded-md bg-muted p-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
            <IconCornerDownRight className="size-4" /> Your reply · {timeAgo(review.reply.postedAt)}
          </p>
          <p className="mt-1 text-[15px] leading-6 whitespace-pre-wrap">{review.reply.text}</p>
        </div>
      )}

      {posting && (
        <div className="space-y-2 rounded-md bg-muted p-3">
          <p className="flex items-center gap-2 text-sm font-semibold">
            <Spinner className="size-4" /> Posting your reply to Google…
          </p>
          <p className="text-[15px] leading-6 whitespace-pre-wrap">{review.draft}</p>
          {review.replyError && <p className="text-sm text-signal-strong">{review.replyError}</p>}
        </div>
      )}

      {showEditor && (
        <div className="space-y-2">
          <label
            htmlFor={`reply-${review.id}`}
            className="text-sm font-semibold text-muted-foreground"
          >
            {review.replyStatus === "needs_reply" && !text
              ? "Drafting a reply for you…"
              : editing
                ? "Edit your reply"
                : "Your reply (drafted for you: check it, then post)"}
          </label>
          <Textarea
            id={`reply-${review.id}`}
            rows={4}
            maxLength={4000}
            value={text}
            placeholder="Write your reply"
            onChange={(event) => setText(event.target.value)}
          />
          {review.replyStatus === "failed" && review.replyError && (
            <p className="flex items-start gap-1.5 rounded-md bg-destructive-subtle p-2.5 text-sm text-destructive-strong">
              <IconAlertTriangle className="mt-0.5 size-4 shrink-0" /> {review.replyError}
            </p>
          )}
          {low && (
            <p className="text-sm text-muted-foreground">
              A calm, short reply that invites them to talk reads best to future customers.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button disabled={!text.trim() || post.isPending} onClick={() => post.mutate()}>
              {post.isPending ? <Spinner /> : <IconSend />}{" "}
              {review.replyStatus === "failed" ? "Try again" : "Post reply"}
            </Button>
            <Button variant="ghost" disabled={redraft.isPending} onClick={() => redraft.mutate()}>
              {redraft.isPending ? <Spinner /> : <IconRefresh />} Write it again
            </Button>
            {editing && (
              <Button variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      )}

      {(review.replyStatus === "posted" && !editing) || canFeature ? (
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          {review.replyStatus === "posted" && !editing ? (
            <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
              Edit reply
            </Button>
          ) : (
            <span />
          )}
          {canFeature && (
            <label className="flex min-h-9 cursor-pointer items-center gap-2.5 text-sm font-medium">
              Show on my profile
              <Switch
                checked={review.showOnProfile}
                disabled={showOnProfile.isPending}
                onCheckedChange={(checked) => showOnProfile.mutate(checked)}
              />
            </label>
          )}
        </footer>
      ) : null}
    </article>
  );
}
