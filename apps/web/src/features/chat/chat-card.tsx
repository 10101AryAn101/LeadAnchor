"use client";

import { CHAT_CHANNEL_LABELS, type LeadDetail } from "@leadanchor/contracts";
import { IconAlertTriangle, IconMessages } from "@tabler/icons-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CHANNEL_ICON } from "./chat-thread";

const STATE_TEXT = {
  assistant: "The assistant is answering.",
  needs_owner: "Needs you: the assistant passed it over.",
  owner: "You're handling this chat.",
} as const;

/** The customer's chat about this job (C-11, C-16), one tap from the job. */
export function ChatCard({ chat }: { chat: NonNullable<LeadDetail["chat"]> }) {
  const Icon = CHANNEL_ICON[chat.channel];
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="font-bold">Chat</h2>
      <p className="mt-1 flex items-center gap-1.5 text-[15px] font-semibold">
        <Icon className="size-[18px] shrink-0 text-primary" /> {CHAT_CHANNEL_LABELS[chat.channel]}
      </p>
      <p
        className={cn(
          "mt-0.5 flex items-center gap-1.5 text-sm",
          chat.state === "needs_owner"
            ? "font-semibold text-signal-strong"
            : "text-muted-foreground",
        )}
      >
        {chat.state === "needs_owner" && <IconAlertTriangle className="size-4" />}
        {STATE_TEXT[chat.state]}
      </p>
      <Button
        variant="outline"
        className="mt-3 w-full"
        nativeButton={false}
        render={<Link href={`/chats?c=${chat.id}`} />}
      >
        <IconMessages /> Open the chat
      </Button>
    </section>
  );
}
