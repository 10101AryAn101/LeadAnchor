"use client";

import type {
  PublicChatContext,
  PublicChatMessage,
  PublicChatThread,
  RequestSource,
} from "@leadanchor/contracts";
import { IconArrowUp, IconRobot } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Spinner } from "@/components/ui/spinner";
import { ContactButtons } from "@/features/money/business-header";
import { api, isApiError } from "@/lib/api";
import { clockTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const storageKey = (slug: string) => `leadanchor-chat:${slug}`;

function readToken(slug: string) {
  try {
    return window.localStorage.getItem(storageKey(slug));
  } catch {
    return null;
  }
}

function writeToken(slug: string, token: string | null) {
  try {
    if (token) window.localStorage.setItem(storageKey(slug), token);
    else window.localStorage.removeItem(storageKey(slug));
  } catch {
    // Private windows can refuse storage; the chat still works until the page closes.
  }
}

/** Links in a message can be tapped (the assistant sends the booking link). */
function Linked({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/\S+)/g).map((part, index) =>
        /^https?:\/\//.test(part) ? (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noreferrer"
            className="font-semibold break-all underline underline-offset-2"
          >
            {part}
          </a>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

/**
 * C-10, C-16: the website chat. The assistant answers at once; the owner sees every message and
 * can step in. The chat's key stays on this device, so coming back picks it up again.
 */
export function CustomerChat({
  slug,
  context,
  source,
}: {
  slug: string;
  context: PublicChatContext;
  source: RequestSource;
}) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(null);
  const [text, setText] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  // The saved key can only be read in the browser, after the page loads.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser storage is read once after mount
    setToken(readToken(slug));
  }, [slug]);

  const threadKey = ["public-chat", slug, token];
  const thread = useQuery({
    queryKey: threadKey,
    queryFn: () =>
      api<PublicChatThread>(`/public/chat/${encodeURIComponent(slug)}/thread`, {
        headers: { "x-chat-token": token! },
      }),
    enabled: Boolean(token),
    retry: false,
    refetchInterval: (query) => (query.state.data?.typing ? 1500 : 4000),
  });
  // An old chat that has gone: start a fresh one.
  if (thread.error && isApiError(thread.error) && thread.error.status === 404 && token) {
    writeToken(slug, null);
    setToken(null);
  }

  const send = useMutation({
    mutationFn: () =>
      api<PublicChatThread>(`/public/chat/${encodeURIComponent(slug)}/messages`, {
        method: "POST",
        body: { text: text.trim(), source },
        headers: token ? { "x-chat-token": token } : {},
      }),
    onSuccess: (data) => {
      setText("");
      const next = data.token ?? token;
      if (data.token) {
        writeToken(slug, data.token);
        setToken(data.token);
      }
      queryClient.setQueryData(["public-chat", slug, next], data);
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "That didn't send. Please try again."),
  });

  const messages: PublicChatMessage[] = thread.data?.messages ?? [];
  const typing = thread.data?.typing ?? false;
  const count = messages.length;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [count, typing]);

  const business = context.business;
  return (
    <div className="mx-auto flex h-dvh max-w-xl flex-col">
      <header className="border-b px-5 pt-4 pb-3">
        <p className="text-sm text-muted-foreground">Chat with</p>
        <h1 className="font-display text-[22px] leading-tight font-semibold">{business.name}</h1>
        <p className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <IconRobot className="size-4" /> An AI assistant answers first; the team sees every
          message.
        </p>
      </header>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 py-4">
        <Bubble from="business" text={context.greeting} />
        {messages.map((message) => (
          <Bubble key={message.id} from={message.from} text={message.text} at={message.at} />
        ))}
        {(typing || send.isPending) && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <Spinner className="size-4" /> {send.isPending ? "Sending…" : "Typing…"}
          </p>
        )}
        <div ref={bottom} />
      </div>

      <div className="space-y-3 border-t px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)]">
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim()) send.mutate();
          }}
        >
          <label htmlFor="chat-message" className="sr-only">
            Your message
          </label>
          <textarea
            id="chat-message"
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
          <button
            type="submit"
            disabled={!text.trim() || send.isPending}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
            aria-label="Send"
          >
            <IconArrowUp className="size-5" />
          </button>
        </form>
        <ContactButtons business={business} />
      </div>
    </div>
  );
}

function Bubble({ from, text, at }: { from: "customer" | "business"; text: string; at?: string }) {
  const mine = from === "customer";
  return (
    <div className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2 text-[15px] leading-6 wrap-anywhere whitespace-pre-wrap",
          mine ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted",
        )}
      >
        <Linked text={text} />
      </div>
      {at && (
        <span className="tabular mt-0.5 px-1 text-[12px] text-muted-foreground">
          {clockTime(at)}
        </span>
      )}
    </div>
  );
}
