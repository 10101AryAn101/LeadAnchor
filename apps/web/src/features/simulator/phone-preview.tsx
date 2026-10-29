"use client";

import { formatPhone } from "@leadanchor/contracts";
import { IconArrowUp } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { api, isApiError } from "@/lib/api";
import { clockTime } from "@/lib/format";
import { keys } from "@/lib/queries";
import { cn } from "@/lib/utils";

interface InboxMessage {
  id: string;
  direction: "outbound" | "inbound";
  body: string;
  channel: string;
  status: string;
  createdAt: string;
}

/** Renders text with tappable links (the request-form link opens in a new tab, as on a real phone). */
function Linkified({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/\S+)/g);
  return (
    <>
      {parts.map((part, index) =>
        /^https?:\/\//.test(part) ? (
          <a key={index} href={part} target="_blank" rel="noreferrer" className="break-all underline underline-offset-2">
            {part}
          </a>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

/** The simulated customer's phone: texts the business sent them, and a box to reply (try STOP). */
export function PhonePreview({ phone, businessName }: { phone: string | null; businessName: string }) {
  const queryClient = useQueryClient();
  const [reply, setReply] = useState("");

  const inbox = useQuery({
    queryKey: keys.simInbox(phone ?? "none"),
    queryFn: () => api<{ messages: InboxMessage[] }>(`/dev/simulator/inbox?phone=${encodeURIComponent(phone ?? "")}`),
    enabled: Boolean(phone),
    refetchInterval: 4000,
  });

  const send = useMutation({
    mutationFn: (text: string) => api("/dev/simulator/reply", { method: "POST", body: { from: phone, text } }),
    onSuccess: () => {
      setReply("");
      void queryClient.invalidateQueries({ queryKey: keys.simInbox(phone ?? "none") });
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't send."),
  });

  return (
    <div className="mx-auto w-full max-w-[320px]">
      <div className="rounded-[40px] border-[10px] border-foreground/90 bg-background shadow-[var(--shadow-float)]">
        <div className="flex h-[560px] flex-col overflow-hidden rounded-[30px]">
          <div className="border-b bg-muted px-4 pt-6 pb-3 text-center">
            <p className="text-[13px] text-muted-foreground">Text messages</p>
            <p className="font-semibold">{businessName}</p>
          </div>
          <div className="flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-4">
            {!phone ? (
              <p className="pt-10 text-center text-sm text-muted-foreground">The caller&apos;s phone shows up here after a test call.</p>
            ) : inbox.data?.messages.length ? (
              inbox.data.messages.map((message) => (
                <div key={message.id} className={cn("flex flex-col", message.direction === "inbound" ? "items-end" : "items-start")}>
                  <div
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3 py-2 text-[15px] leading-5 whitespace-pre-wrap",
                      message.direction === "inbound" ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-muted",
                    )}
                  >
                    <Linkified text={message.body} />
                  </div>
                  <span className="tabular mt-0.5 px-1 text-[11px] text-muted-foreground">{clockTime(message.createdAt)}</span>
                </div>
              ))
            ) : (
              <p className="pt-10 text-center text-sm text-muted-foreground">No texts yet for {formatPhone(phone)}.</p>
            )}
          </div>
          <form
            className="flex items-center gap-2 border-t p-2.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (reply.trim() && phone) send.mutate(reply.trim());
            }}
          >
            <input
              value={reply}
              onChange={(event) => setReply(event.target.value)}
              disabled={!phone}
              placeholder={phone ? "Reply as the customer (try STOP)" : "No conversation yet"}
              className="h-11 min-w-0 flex-1 rounded-full border border-input bg-background px-4 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <button
              type="submit"
              disabled={!phone || !reply.trim() || send.isPending}
              className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
              aria-label="Send reply"
            >
              <IconArrowUp className="size-5" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
