"use client";

import type { NotificationItem, NotificationKind } from "@leadanchor/contracts";
import {
  type Icon,
  IconBell,
  IconCamera,
  IconChecks,
  IconFileText,
  IconHeadset,
  IconPhoneX,
  IconRecordMail,
  IconTrendingUp,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { keys, useNotifications } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Amber only where someone is waiting on the owner. */
const KIND: Record<NotificationKind, { icon: Icon; tone: string }> = {
  ghost_call: { icon: IconPhoneX, tone: "bg-signal-subtle text-signal-strong" },
  voicemail: { icon: IconRecordMail, tone: "bg-signal-subtle text-signal-strong" },
  dispatcher_lead: { icon: IconHeadset, tone: "bg-primary-subtle text-primary-subtle-foreground" },
  intake_submitted: { icon: IconFileText, tone: "bg-primary-subtle text-primary-subtle-foreground" },
  photo_analyzed: { icon: IconCamera, tone: "bg-info-subtle text-info-strong" },
  value_proof: { icon: IconTrendingUp, tone: "bg-primary-subtle text-primary-subtle-foreground" },
};

export function NotificationsButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data } = useNotifications();
  const unread = data?.unread ?? 0;

  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api("/notifications/read", { method: "POST", body: ids ? { ids } : {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.notifications }),
  });

  const openItem = (item: NotificationItem) => {
    if (!item.readAt) markRead.mutate([item.id]);
    setOpen(false);
    if (item.leadId) router.push(`/leads/${item.leadId}`);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className={cn("relative rounded-full", className)}
            aria-label={`Alerts${unread ? `, ${unread} unread` : ""}`}
          />
        }
      >
        <IconBell className="size-[22px]" stroke={1.75} />
        {unread > 0 && (
          <span className="tabular absolute top-1 right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-signal px-1 text-[11px] font-bold text-signal-foreground ring-2 ring-background">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(92vw,400px)] gap-0 p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <p className="font-semibold">Alerts</p>
            <p className="text-sm text-muted-foreground">{unread ? `${unread} new` : "You're all caught up"}</p>
          </div>
          {unread > 0 && (
            <Button variant="ghost" size="sm" onClick={() => markRead.mutate(undefined)}>
              <IconChecks /> Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-[60vh]">
          {data?.items.length ? (
            <ul className="divide-y">
              {data.items.map((item) => {
                const kind = KIND[item.kind];
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => openItem(item)}
                      className="flex min-h-[72px] w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60"
                    >
                      <span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md", kind.tone)}>
                        <kind.icon className="size-[18px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className={cn("truncate", !item.readAt && "font-semibold")}>{item.title}</span>
                          {!item.readAt && <span className="size-2 shrink-0 rounded-full bg-signal" aria-label="Unread" />}
                        </span>
                        <span className="line-clamp-2 text-sm text-muted-foreground">{item.body}</span>
                        <span className="tabular mt-0.5 block text-sm text-muted-foreground">{timeAgo(item.createdAt)}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              Missed calls and new details from customers show up here the moment they happen.
            </p>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
