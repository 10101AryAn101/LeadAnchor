import type { Metadata } from "next";
import { Suspense } from "react";
import { ChatsView } from "@/features/chat/chats-view";

export const metadata: Metadata = { title: "Chats" };

export default function ChatsPage() {
  return (
    <Suspense>
      <ChatsView />
    </Suspense>
  );
}
