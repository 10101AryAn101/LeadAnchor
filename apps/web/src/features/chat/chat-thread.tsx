"use client";

import {
  CHAT_CHANNEL_LABELS,
  type ChatChannel,
  type ChatDetail,
  type ChatMessage,
  LEAD_STAGE_LABELS,
  formatPhone,
} from "@leadanchor/contracts";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowRight,
  IconBrandWhatsapp,
  IconMessage,
  IconPhone,
  IconRobot,
  IconSend,
  IconUserCheck,
  IconWorld,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api, isApiError } from "@/lib/api";
import { clockTime, dayLabel, telHref } from "@/lib/format";
import { keys, useChat } from "@/lib/queries";
import { cn } from "@/lib/utils";

export const CHANNEL_ICON: Record<ChatChannel, typeof IconMessage> = {
  whatsapp: IconBrandWhatsapp,
  web: IconWorld,
  sms: IconMessage,
};

/** One chat: what the customer and the assistant said, and the owner's reply box (C-11, C-16). */
export function ChatThread({ id, onBack }: { id: string; onBack?: () => void }) {
  const { data, isPending, error } = useChat(id);
  if (isPending) {
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-16 w-3/4 rounded-lg" />
        <Skeleton className="ml-auto h-16 w-2/3 rounded-lg" />
      </div>
    );
  }
  if (error || !data)
    return (
      <p className="p-6 text-[15px] text-muted-foreground">We couldn&apos;t open that chat.</p>
    );
  return <Thread chat={data} onBack={onBack} />;
}

function Thread({ chat, onBack }: { chat: ChatDetail; onBack?: () => void }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const ChannelIcon = CHANNEL_ICON[chat.channel];
  const refresh = (next: ChatDetail) => {
    queryClient.setQueryData(keys.chat(chat.id), next);
    void queryClient.invalidateQueries({ queryKey: keys.chats });
  };
  const send = useMutation({
    mutationFn: () =>
      api<ChatDetail>(`/chats/${chat.id}/reply`, { method: "POST", body: { text: text.trim() } }),
    onSuccess: (next) => {
      setText("");
      refresh(next);
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't send that."),
  });
  const handler = useMutation({
    mutationFn: (to: "owner" | "assistant") =>
      api<ChatDetail>(`/chats/${chat.id}/handler`, { method: "POST", body: { handler: to } }),
    onSuccess: (next, to) => {
      refresh(next);
      toast.success(
        to === "owner"
          ? "You've taken over. The assistant won't reply in this chat."
          : "The assistant is answering this chat again.",
      );
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't change that."),
  });

  const count = chat.messages.length;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [count, chat.typing]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-3">
        {onBack && (
          <Button
            variant="ghost"
            size="icon"
            className="-ml-2 lg:hidden"
            aria-label="Back to chats"
            onClick={onBack}
          >
            <IconArrowLeft />
          </Button>
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[17px] font-semibold">{chat.title}</p>
          <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <ChannelIcon className="size-4" /> {CHAT_CHANNEL_LABELS[chat.channel]}
            </span>
            {chat.phone && <span className="tabular">· {formatPhone(chat.phone)}</span>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {chat.phone && (
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<a href={telHref(chat.phone)} />}
            >
              <IconPhone /> Call
            </Button>
          )}
          {chat.lead && (
            <Button
              variant="ghost"
              size="sm"
              nativeButton={false}
              render={<Link href={`/leads/${chat.lead.id}`} />}
            >
              {chat.lead.title} · {LEAD_STAGE_LABELS[chat.lead.stage]} <IconArrowRight />
            </Button>
          )}
        </div>
      </header>

      <StateBar chat={chat} busy={handler.isPending} onChange={(to) => handler.mutate(to)} />

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-4">
        {chat.messages.map((message, index) => {
          const previous = chat.messages[index - 1];
          const newDay = !previous || dayLabel(previous.at) !== dayLabel(message.at);
          return (
            <div key={message.id}>
              {newDay && (
                <p className="py-1 text-center text-[13px] font-medium text-muted-foreground">
                  {dayLabel(message.at)}
                </p>
              )}
              <Bubble message={message} />
            </div>
          );
        })}
        {chat.typing && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <IconRobot className="size-4" /> The assistant is writing…
          </p>
        )}
        <div ref={bottom} />
      </div>

      <form
        className="space-y-2 border-t p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim()) send.mutate();
        }}
      >
        {chat.replyNote && <p className="text-sm text-muted-foreground">{chat.replyNote}</p>}
        <div className="flex items-end gap-2">
          <label htmlFor={`reply-${chat.id}`} className="sr-only">
            Your reply
          </label>
          <Textarea
            id={`reply-${chat.id}`}
            rows={2}
            maxLength={1500}
            value={text}
            disabled={!chat.canReply}
            placeholder={chat.canReply ? "Write a reply" : "Replies are closed on this channel"}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && text.trim()) {
                event.preventDefault();
                send.mutate();
              }
            }}
            className="min-h-11 flex-1 resize-none"
          />
          <Button
            type="submit"
            size="icon"
            className="size-11"
            aria-label="Send reply"
            disabled={!chat.canReply || !text.trim() || send.isPending}
          >
            {send.isPending ? <Spinner /> : <IconSend />}
          </Button>
        </div>
      </form>
    </div>
  );
}

function StateBar({
  chat,
  busy,
  onChange,
}: {
  chat: ChatDetail;
  busy: boolean;
  onChange: (to: "owner" | "assistant") => void;
}) {
  if (chat.state === "needs_owner") {
    return (
      <div className="flex flex-wrap items-center gap-3 bg-signal-subtle px-4 py-2.5 text-sm text-signal-strong">
        <IconAlertTriangle className="size-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="font-semibold">Needs you.</span> {chat.stateReason}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="bg-background"
          disabled={busy}
          onClick={() => onChange("assistant")}
        >
          Let the assistant answer
        </Button>
      </div>
    );
  }
  if (chat.state === "owner") {
    return (
      <div className="flex flex-wrap items-center gap-3 bg-muted px-4 py-2.5 text-sm">
        <IconUserCheck className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-muted-foreground">
          You&apos;re handling this chat; the assistant stays quiet.
        </span>
        <Button
          variant="outline"
          size="sm"
          className="bg-background"
          disabled={busy}
          onClick={() => onChange("assistant")}
        >
          Let the assistant answer
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 bg-primary-subtle px-4 py-2.5 text-sm text-primary-subtle-foreground">
      <IconRobot className="size-4 shrink-0" />
      <span className="min-w-0 flex-1">
        The assistant is answering. Replying yourself takes over.
      </span>
      <Button
        variant="outline"
        size="sm"
        className="bg-background"
        disabled={busy}
        onClick={() => onChange("owner")}
      >
        Take over
      </Button>
    </div>
  );
}

const AUTHOR_LABEL: Record<ChatMessage["author"], string> = {
  customer: "",
  assistant: "Assistant",
  owner: "You",
  system: "LeadAnchor",
};

function Bubble({ message }: { message: ChatMessage }) {
  const fromCustomer = message.author === "customer";
  const problem = message.status === "blocked" || message.status === "failed";
  return (
    <div className={cn("flex flex-col", fromCustomer ? "items-start" : "items-end")}>
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2 text-[15px] leading-6 wrap-anywhere whitespace-pre-wrap",
          fromCustomer
            ? "rounded-bl-md bg-muted"
            : message.author === "assistant"
              ? "rounded-br-md bg-primary-subtle text-primary-subtle-foreground"
              : "rounded-br-md bg-primary text-primary-foreground",
          problem && "opacity-60",
        )}
      >
        {message.text}
      </div>
      <span className="tabular mt-0.5 px-1 text-[12px] text-muted-foreground">
        {[AUTHOR_LABEL[message.author], clockTime(message.at)].filter(Boolean).join(" · ")}
        {problem && (
          <span className="text-destructive">
            {" "}
            · Not sent{message.blockedReason ? `: ${message.blockedReason}` : ""}
          </span>
        )}
      </span>
    </div>
  );
}
