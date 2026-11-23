"use client";

import type { PublicChatContext } from "@leadanchor/contracts";
import { IconX } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { type ComponentProps, type ReactNode, useEffect, useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/lib/api";
import { CustomerChat } from "./customer-chat";

const OPEN_EVENT = "leadanchor:open-chat";

/**
 * C-33: a chat button on the business's website. It's a plain link to the chat page, so it works
 * before the page's script has loaded; once it has, the chat opens on the website itself.
 */
export function OpenChatLink({
  slug,
  children,
  onClick,
  ...props
}: Omit<ComponentProps<"a">, "href"> & { slug: string; children?: ReactNode }) {
  return (
    <a
      {...props}
      href={`/c/${slug}?src=website`}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
        window.dispatchEvent(new Event(OPEN_EVENT));
      }}
    >
      {children}
    </a>
  );
}

/**
 * C-33: the website's chat, as a widget on the page rather than a separate page: a panel at the
 * bottom right on a computer, full screen on a phone. The same chat as the shareable link.
 */
export function ChatWidget({ slug }: { slug: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  const context = useQuery({
    queryKey: ["public-chat-context", slug],
    queryFn: () => api<PublicChatContext>(`/public/chat/${encodeURIComponent(slug)}`),
    enabled: open,
    staleTime: 5 * 60_000,
  });

  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={`Chat with ${context.data?.business.name ?? "us"}`}
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background shadow-2xl sm:inset-auto sm:right-4 sm:bottom-4 sm:h-[min(640px,calc(100dvh-2rem))] sm:w-[400px] sm:rounded-2xl sm:border"
    >
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="absolute top-2 right-2 z-10 flex size-11 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Close the chat"
      >
        <IconX className="size-5" />
      </button>
      {context.data ? (
        <CustomerChat slug={slug} context={context.data} source="website" embedded />
      ) : (
        <div className="space-y-3 p-5">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-16 rounded-2xl" />
        </div>
      )}
    </div>
  );
}
