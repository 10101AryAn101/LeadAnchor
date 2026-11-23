"use client";

import { CHAT_CHANNEL_LABELS, type ChatSummary } from "@leadanchor/contracts";
import { IconMessages, IconRobot, IconSettings } from "@tabler/icons-react";
import Link from "next/link";
import { parseAsString, useQueryState } from "nuqs";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { timeAgo } from "@/lib/format";
import { useChats } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { CHANNEL_ICON, ChatThread } from "./chat-thread";

const STATE_CHIP: Record<ChatSummary["state"], { label: string; tone: string }> = {
  assistant: { label: "Assistant", tone: "bg-primary-subtle text-primary-subtle-foreground" },
  needs_owner: { label: "Needs you", tone: "bg-signal-subtle text-signal-strong" },
  owner: { label: "You", tone: "bg-muted text-muted-foreground" },
};

const WHO: Record<NonNullable<ChatSummary["lastMessage"]>["author"], string> = {
  customer: "",
  assistant: "Assistant: ",
  owner: "You: ",
  system: "",
};

/** C-11, C-16: every WhatsApp, website and text chat, with the assistant's answers and the owner's. */
export function ChatsView() {
  const { data, isPending } = useChats();
  const [selected, setSelected] = useQueryState("c", parseAsString);
  const chats = data?.chats ?? [];

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      <div className={cn(selected && "hidden lg:block")}>
        <PageHeader
          title="Chats"
          description="WhatsApp, your website chat and texts. The assistant answers from your price list, hours and notes until you take over."
          actions={
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href="/settings#assistant" />}
            >
              <IconSettings /> Assistant settings
            </Button>
          }
        />
        {data && !data.assistantOn && (
          <p className="mt-3 flex items-center gap-2 rounded-md bg-muted p-3 text-[15px] text-muted-foreground">
            <IconRobot className="size-5 shrink-0" /> The assistant is off, so every chat waits for
            you. Turn it on in Settings.
          </p>
        )}
      </div>

      {isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-16 rounded-lg" />
          <Skeleton className="h-16 rounded-lg" />
        </div>
      ) : chats.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
          <IconMessages className="size-8 text-muted-foreground" />
          <p className="font-semibold">No chats yet</p>
          <p className="max-w-md text-[15px] text-muted-foreground">
            Share your WhatsApp link, or add the chat to your website. Both are in Settings → Chat
            assistant.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
          <ul
            className={cn(
              "divide-y overflow-hidden rounded-lg border bg-card lg:max-h-[calc(100dvh-14rem)] lg:overflow-y-auto",
              selected && "hidden lg:block",
            )}
          >
            {chats.map((chat) => (
              <ChatRow
                key={chat.id}
                chat={chat}
                active={chat.id === selected}
                onOpen={() => void setSelected(chat.id)}
              />
            ))}
          </ul>
          <section
            className={cn(
              "min-w-0 overflow-hidden rounded-lg border bg-card",
              selected
                ? "fixed inset-x-0 top-14 bottom-14 z-30 rounded-none border-0 lg:static lg:h-[calc(100dvh-14rem)] lg:rounded-lg lg:border"
                : "hidden lg:block lg:h-[calc(100dvh-14rem)]",
            )}
          >
            {selected ? (
              <ChatThread key={selected} id={selected} onBack={() => void setSelected(null)} />
            ) : (
              <p className="flex h-full items-center justify-center p-6 text-[15px] text-muted-foreground">
                Pick a chat to read it.
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function ChatRow({
  chat,
  active,
  onOpen,
}: {
  chat: ChatSummary;
  active: boolean;
  onOpen: () => void;
}) {
  const Icon = CHANNEL_ICON[chat.channel];
  const chip = STATE_CHIP[chat.state];
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          "flex w-full items-start gap-3 p-3 text-left hover:bg-muted/50",
          active && "bg-muted",
        )}
      >
        <span className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-5" />
          {chat.waiting && (
            <span
              className="absolute -top-0.5 -right-0.5 size-3 rounded-full border-2 border-card bg-signal"
              aria-label="Waiting for a reply"
            />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-semibold">{chat.title}</span>
            {chat.lastMessage && (
              <span className="shrink-0 text-[13px] text-muted-foreground">
                {timeAgo(chat.lastMessage.at)}
              </span>
            )}
          </span>
          <span className="block truncate text-sm text-muted-foreground">
            {chat.lastMessage
              ? `${WHO[chat.lastMessage.author]}${chat.lastMessage.text}`
              : CHAT_CHANNEL_LABELS[chat.channel]}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                "inline-flex h-5 items-center rounded-full px-2 text-[12px] font-semibold",
                chip.tone,
              )}
            >
              {chip.label}
            </span>
            {chat.lead && (
              <span className="truncate text-[12px] text-muted-foreground">{chat.lead.title}</span>
            )}
          </span>
        </span>
      </button>
    </li>
  );
}
