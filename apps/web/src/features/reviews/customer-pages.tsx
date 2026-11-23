"use client";

import type {
  PublicChatThread,
  PublicFeedbackContext,
  PublicUnsubscribe,
} from "@leadanchor/contracts";
import { IconArrowUp, IconCircleCheck, IconLock, IconMailOff } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Bubble } from "@/features/chat/customer-chat";
import { ContactButtons } from "@/features/money/business-header";
import { api, isApiError } from "@/lib/api";

/**
 * C-46: the private line from the review request, a chat with the owner. It's tied to the job,
 * and every message reaches the owner as a priority alert and a note on the job; their replies
 * show here. It sits beside the review link; it never replaces it.
 */
export function PrivateChat({ token, initial }: { token: string; initial: PublicFeedbackContext }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const [company, setCompany] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const base = `/public/feedback/${encodeURIComponent(token)}`;
  const thread = useQuery({
    queryKey: ["private-chat", token],
    queryFn: () => api<PublicChatThread>(`${base}/thread`),
    refetchInterval: 4000,
  });
  const send = useMutation({
    mutationFn: () =>
      api<PublicChatThread>(`${base}/messages`, {
        method: "POST",
        body: { text: text.trim(), source: "link", company },
      }),
    onSuccess: (data) => {
      setText("");
      queryClient.setQueryData(["private-chat", token], data);
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "That didn't go through. Please try again."),
  });

  const messages = thread.data?.messages ?? [];
  const count = messages.length;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [count]);

  const business = initial.business.name;
  return (
    <div className="mx-auto flex h-dvh max-w-xl flex-col">
      <header className="border-b px-5 pt-4 pb-3">
        <p className="text-sm text-muted-foreground">Message</p>
        <h1 className="font-display text-[22px] leading-tight font-semibold">{business}</h1>
        <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <IconLock className="size-4" /> Private: this goes straight to the owner, who replies
          here.
        </p>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-4">
        <Bubble
          from="business"
          text={`${initial.firstName ? `Hi ${initial.firstName}! ` : "Hi! "}Tell us what happened and how we can put it right. The owner reads every message.`}
        />
        {messages.map((message) => (
          <Bubble key={message.id} from={message.from} text={message.text} at={message.at} />
        ))}
        {send.isPending && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <Spinner className="size-4" /> Sending…
          </p>
        )}
        <div ref={bottom} />
      </div>

      <div className="space-y-3 border-t px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        <form
          className="relative flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim()) send.mutate();
          }}
        >
          <label htmlFor="private-message" className="sr-only">
            Your message
          </label>
          <textarea
            id="private-message"
            rows={1}
            maxLength={1000}
            value={text}
            placeholder="Type a message"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && text.trim()) {
                event.preventDefault();
                send.mutate();
              }
            }}
            className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-input bg-background px-4 py-2.5 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          {/* Only bots fill this in. */}
          <input
            type="text"
            name="company"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            className="absolute -left-[9999px] h-0 w-0 opacity-0"
          />
          <button
            type="submit"
            disabled={!text.trim() || send.isPending}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
            aria-label="Send"
          >
            <IconArrowUp className="size-5" />
          </button>
        </form>
        <ContactButtons business={initial.business} />
      </div>
    </div>
  );
}

/** One click, no login (CAN-SPAM). Job emails such as booking confirmations and bills still come. */
export function Unsubscribe({ token, initial }: { token: string; initial: PublicUnsubscribe }) {
  const [state, setState] = useState(initial);
  const stop = useMutation({
    mutationFn: () =>
      api<PublicUnsubscribe>(`/public/unsubscribe/${encodeURIComponent(token)}`, {
        method: "POST",
      }),
    onSuccess: setState,
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "That didn't go through. Please try again."),
  });
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 py-10">
      <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {state.unsubscribed ? (
          <IconCircleCheck className="size-6 text-primary" />
        ) : (
          <IconMailOff className="size-6" />
        )}
      </span>
      {state.unsubscribed ? (
        <>
          <h1 className="font-display text-2xl font-semibold">You&apos;re unsubscribed</h1>
          <p className="text-[15px] text-muted-foreground">
            {state.email} won&apos;t get review requests or offers from {state.businessName} again.
            Emails about your own bookings, quotes and bills still come.
          </p>
        </>
      ) : (
        <>
          <h1 className="font-display text-2xl font-semibold">
            Stop these emails from {state.businessName}?
          </h1>
          <p className="text-[15px] text-muted-foreground">
            {state.email} won&apos;t get review requests or offers from them. Emails about your own
            bookings, quotes and bills still come.
          </p>
          <Button size="lg" disabled={stop.isPending} onClick={() => stop.mutate()}>
            {stop.isPending && <Spinner />} Unsubscribe
          </Button>
        </>
      )}
    </div>
  );
}
