"use client";

import {
  type ListingResponse,
  type ListingSyncField,
  REPLY_TONES,
  REPLY_TONE_LABELS,
  type ReplyTone,
} from "@leadanchor/contracts";
import {
  IconAlertTriangle,
  IconBrandGoogle,
  IconCircleCheck,
  IconExternalLink,
  IconRefresh,
  IconSparkles,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api, isApiError } from "@/lib/api";
import { formatPhone, timeAgo } from "@/lib/format";
import { keys, useListing } from "@/lib/queries";
import { cn } from "@/lib/utils";

/**
 * Module 9 (C-21): the Google listing. LeadAnchor keeps the business's details up to date on it,
 * reads reviews back in, and publishes the updates the owner writes.
 */
export function GoogleSection() {
  const { data, isPending } = useListing();
  return (
    <section id="google" className="scroll-mt-24 rounded-lg border bg-card p-5">
      <div className="mb-4 space-y-1">
        <h2 className="text-[17px] font-bold">Google listing</h2>
        <p className="text-[15px] text-muted-foreground">
          Keep your hours, phone and Book button right on Google without logging in there, see new
          reviews here, and post updates.
        </p>
      </div>
      {isPending || !data ? (
        <div className="space-y-3">
          <Skeleton className="h-24 rounded-lg" />
          <Skeleton className="h-48 rounded-lg" />
        </div>
      ) : (
        <div className="space-y-4">
          <ConnectionCard data={data} />
          {data.listing.connected && (
            <>
              <SyncedFields data={data} />
              <ReplyToneCard data={data} />
              <Posts data={data} />
            </>
          )}
        </div>
      )}
    </section>
  );
}

function useSetListing() {
  const queryClient = useQueryClient();
  return (data: ListingResponse) => {
    queryClient.setQueryData(keys.listing, data);
    void queryClient.invalidateQueries({ queryKey: keys.reviews });
    void queryClient.invalidateQueries({ queryKey: keys.reviewsSummary });
  };
}

function ConnectionCard({ data }: { data: ListingResponse }) {
  const queryClient = useQueryClient();
  const setListing = useSetListing();
  const { listing } = data;
  const connect = useMutation({
    mutationFn: () =>
      api<{ url: string | null }>("/listing/connect", {
        method: "POST",
        body: { provider: "simulator" },
      }),
    onSuccess: ({ url }) => {
      if (url) return window.location.assign(url);
      void queryClient.invalidateQueries({ queryKey: keys.listing });
      void queryClient.invalidateQueries({ queryKey: keys.reviews });
      toast.success("Google listing connected and brought up to date.");
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't connect Google."),
  });
  const sync = useMutation({
    mutationFn: () => api<ListingResponse>("/listing/sync", { method: "POST" }),
    onSuccess: (next) => {
      setListing(next);
      toast.success("Google is up to date.");
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't update Google."),
  });
  const disconnect = useMutation({
    mutationFn: () => api<ListingResponse>("/listing/disconnect", { method: "POST" }),
    onSuccess: (next) => {
      setListing(next);
      toast.success("Google listing disconnected.");
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't disconnect."),
  });

  const on = listing.connected;
  return (
    <div className="space-y-3 rounded-lg border bg-background p-4">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full",
            on
              ? "bg-primary-subtle text-primary-subtle-foreground"
              : "bg-muted text-muted-foreground",
          )}
        >
          {on ? <IconCircleCheck className="size-5" /> : <IconBrandGoogle className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            {on ? (listing.locationName ?? "Your listing") : "Your Google listing"}
            {listing.simulated && (
              <span className="inline-flex h-6 items-center rounded-full bg-muted px-2 text-[13px] font-medium text-muted-foreground">
                Simulator
              </span>
            )}
          </p>
          <p className="text-[15px] text-muted-foreground">
            {on
              ? `Connected.${listing.lastPushedAt ? ` Updated ${timeAgo(listing.lastPushedAt)}.` : ""}${listing.lastSyncedAt ? ` Reviews checked ${timeAgo(listing.lastSyncedAt)}.` : ""}`
              : "Sign in with Google once; after that LeadAnchor keeps the listing up to date for you."}
          </p>
          {listing.simulated && (
            <p className="mt-1 text-sm text-muted-foreground">
              Google&apos;s API isn&apos;t set up yet, so a simulated listing stands in.{" "}
              {on && listing.listingUrl && (
                <a
                  href={listing.listingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-primary"
                >
                  See it as customers do
                </a>
              )}
            </p>
          )}
          {listing.error && (
            <p className="mt-2 flex items-start gap-1.5 rounded-md bg-signal-subtle p-2.5 text-sm text-signal-strong">
              <IconAlertTriangle className="mt-0.5 size-4 shrink-0" /> {listing.error}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {on ? (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={sync.isPending}
              onClick={() => sync.mutate()}
            >
              {sync.isPending ? <Spinner /> : <IconRefresh />} Update Google now
            </Button>
            {listing.listingUrl && (
              <Button
                type="button"
                variant="ghost"
                nativeButton={false}
                render={<a href={listing.listingUrl} target="_blank" rel="noreferrer" />}
              >
                <IconExternalLink /> Open listing
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              disabled={disconnect.isPending}
              onClick={() => disconnect.mutate()}
            >
              Disconnect
            </Button>
          </>
        ) : (
          <Button type="button" disabled={connect.isPending} onClick={() => connect.mutate()}>
            {connect.isPending ? <Spinner /> : <IconBrandGoogle />} Connect Google
          </Button>
        )}
      </div>
    </div>
  );
}

function SyncedFields({ data }: { data: ListingResponse }) {
  const setListing = useSetListing();
  const save = useMutation({
    mutationFn: (patch: Partial<Record<ListingSyncField, boolean>>) =>
      api<ListingResponse>("/listing/settings", { method: "PUT", body: { syncFields: patch } }),
    onSuccess: setListing,
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't save that."),
  });
  const { pushes, syncFields } = data;
  const rows: Array<{ field: ListingSyncField; label: string; value: React.ReactNode }> = [
    {
      field: "hours",
      label: "Opening hours",
      value: (
        <span className="grid grid-cols-[6.5rem_1fr] gap-x-2">
          {pushes.hours.map((row) => (
            <span key={row.day} className="contents">
              <span>{row.day}</span>
              <span className={cn(row.hours === "Closed" && "text-muted-foreground")}>
                {row.hours}
              </span>
            </span>
          ))}
        </span>
      ),
    },
    {
      field: "phone",
      label: "Phone",
      value: pushes.phone
        ? `${formatPhone(pushes.phone)}, your LeadAnchor line: Google callers get caught too`
        : "No LeadAnchor line yet",
    },
    { field: "website", label: "Website", value: pushes.website },
    {
      field: "bookingLink",
      label: "Book button",
      value: `${pushes.bookingLinkIs === "booking" ? "Your booking page" : "Your request form"}: ${pushes.bookingLink}`,
    },
    {
      field: "address",
      label: "Address",
      value:
        pushes.address ??
        "Add your street address and ZIP under Business profile to keep it on Google",
    },
    {
      field: "chatLink",
      label: "Chat button",
      value: pushes.chatLink ? `WhatsApp, answered by your assistant: ${pushes.chatLink}` : "Appears once WhatsApp is connected",
    },
  ];
  return (
    <div className="rounded-lg border bg-background p-4">
      <p className="font-semibold">Kept up to date on Google</p>
      <p className="text-[15px] text-muted-foreground">
        From your settings here; change them once and Google follows. Hours come from your online
        booking hours.
      </p>
      <ul className="mt-2 divide-y">
        {rows.map((row) => (
          <li key={row.field} className="flex items-start gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{row.label}</p>
              <div className="text-sm break-words text-muted-foreground">{row.value}</div>
            </div>
            <Switch
              checked={syncFields[row.field]}
              disabled={save.isPending}
              aria-label={`Keep ${row.label.toLowerCase()} up to date on Google`}
              onCheckedChange={(checked) => save.mutate({ [row.field]: checked })}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ReplyToneCard({ data }: { data: ListingResponse }) {
  const setListing = useSetListing();
  const save = useMutation({
    mutationFn: (replyTone: ReplyTone) =>
      api<ListingResponse>("/listing/settings", { method: "PUT", body: { replyTone } }),
    onSuccess: (next) => {
      setListing(next);
      toast.success("New reply drafts will use that tone.");
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't save that."),
  });
  return (
    <div className="space-y-2 rounded-lg border bg-background p-4">
      <p className="font-semibold">Drafted replies to reviews</p>
      <p className="text-[15px] text-muted-foreground">
        Every new review gets a reply drafted in this tone. Nothing is posted until you approve it,
        and replies never offer anything in return.
      </p>
      <ToggleGroup
        value={[data.replyTone]}
        onValueChange={(value) => value[0] && save.mutate(value[0] as ReplyTone)}
        variant="outline"
        aria-label="Reply tone"
      >
        {REPLY_TONES.map((tone) => (
          <ToggleGroupItem key={tone} value={tone} className="px-4">
            {REPLY_TONE_LABELS[tone]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

function Posts({ data }: { data: ListingResponse }) {
  const setListing = useSetListing();
  const [text, setText] = useState("");
  const draft = useMutation({
    mutationFn: () => api<{ text: string }>("/listing/posts/draft", { method: "POST" }),
    onSuccess: (result) => setText(result.text),
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't draft one."),
  });
  const publish = useMutation({
    mutationFn: () =>
      api<ListingResponse>("/listing/posts", { method: "POST", body: { text: text.trim() } }),
    onSuccess: (next) => {
      setListing(next);
      setText("");
      toast.success("Posted to your Google listing.");
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't post it."),
  });
  return (
    <div className="space-y-3 rounded-lg border bg-background p-4">
      <div>
        <p className="font-semibold">Post an update</p>
        <p className="text-[15px] text-muted-foreground">
          A short note on your listing: recent work, a busy season, a new service. Fresh posts help
          people choose you.
        </p>
      </div>
      <Textarea
        rows={4}
        maxLength={1500}
        value={text}
        placeholder="What's new?"
        onChange={(event) => setText(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={draft.isPending}
          onClick={() => draft.mutate()}
        >
          {draft.isPending ? <Spinner /> : <IconSparkles />} Draft one from my recent jobs
        </Button>
        <Button
          type="button"
          disabled={!text.trim() || publish.isPending}
          onClick={() => publish.mutate()}
        >
          {publish.isPending && <Spinner />} Post to Google
        </Button>
        <span className="tabular ml-auto text-sm text-muted-foreground">{text.length}/1500</span>
      </div>
      {data.posts.length > 0 && (
        <ul className="divide-y border-t">
          {data.posts.slice(0, 3).map((post) => (
            <li key={post.id} className="py-2.5">
              <p className="text-sm text-muted-foreground">
                {post.status === "posted" ? "Posted" : "Didn't post"} {timeAgo(post.createdAt)}
                {post.error && <span className="text-destructive"> · {post.error}</span>}
              </p>
              <p className="line-clamp-2 text-[15px]">{post.text}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
