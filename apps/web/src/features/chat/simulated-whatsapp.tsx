"use client";

import { type SimWhatsAppThread, formatPhone } from "@leadanchor/contracts";
import { IconArrowUp, IconBrandWhatsapp, IconFlask, IconRefresh } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, isApiError } from "@/lib/api";
import { clockTime } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Fictional 555-01xx numbers can never reach a real person. */
const randomCustomer = () =>
  `(512) 555-01${String(Math.floor(Math.random() * 100)).padStart(2, "0")}`;
const STORE = "leadanchor-sim-whatsapp";

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
            className="break-all underline underline-offset-2"
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
 * Development only: the customer's WhatsApp, chatting with a business (C-11). Messages go in as
 * Meta's webhook would deliver them, so the assistant and the owner see exactly what they would live.
 */
export function SimulatedWhatsApp({ business, prefill }: { business: string; prefill: string }) {
  const queryClient = useQueryClient();
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [text, setText] = useState(prefill);
  const bottom = useRef<HTMLDivElement>(null);
  // A random customer number, picked in the browser and kept for the next visit.
  useEffect(() => {
    let saved: { phone?: string; name?: string } = {};
    try {
      saved = JSON.parse(window.localStorage.getItem(STORE) ?? "{}") as typeof saved;
    } catch {
      saved = {};
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- browser-only values, read once after the page loads
    setPhone(saved.phone ?? randomCustomer());
    setName(saved.name ?? "");
  }, []);
  useEffect(() => {
    if (!phone) return;
    try {
      window.localStorage.setItem(STORE, JSON.stringify({ phone, name }));
    } catch {
      // Not saved; the next visit picks a new number.
    }
  }, [phone, name]);

  const thread = useQuery({
    queryKey: ["sim-whatsapp", business, phone],
    queryFn: () =>
      api<SimWhatsAppThread>(`/dev/simulator/whatsapp/${business}/thread`, {
        method: "POST",
        body: { from: phone },
      }),
    enabled: phone.replace(/\D/g, "").length >= 10,
    retry: false,
    refetchInterval: (query) => (query.state.data?.typing ? 1500 : 4000),
  });
  const send = useMutation({
    mutationFn: () =>
      api<SimWhatsAppThread>(`/dev/simulator/whatsapp/${business}/messages`, {
        method: "POST",
        body: { from: phone, name, text: text.trim() },
      }),
    onSuccess: (data) => {
      setText("");
      queryClient.setQueryData(["sim-whatsapp", business, phone], data);
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't send."),
  });

  const messages = thread.data?.messages ?? [];
  const count = messages.length;
  const typing = thread.data?.typing ?? false;
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [count, typing]);

  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-6">
      <p className="flex items-start gap-2 rounded-lg border border-dashed bg-muted/60 p-3 text-sm text-muted-foreground">
        <IconFlask className="mt-0.5 size-4 shrink-0" />
        <span>
          Simulated WhatsApp. You&apos;re the customer; what you send reaches the business&apos;s
          assistant and Chats page as a real WhatsApp would.
        </span>
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_9rem]">
        <label className="space-y-1 text-sm">
          <span className="block text-muted-foreground">Your WhatsApp number</span>
          <div className="flex gap-2">
            <Input
              inputMode="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
            <Button
              variant="outline"
              size="icon"
              aria-label="New customer"
              onClick={() => setPhone(randomCustomer())}
            >
              <IconRefresh />
            </Button>
          </div>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-muted-foreground">Profile name</span>
          <Input
            value={name}
            placeholder="Maria"
            onChange={(event) => setName(event.target.value)}
          />
        </label>
      </div>

      <div className="overflow-hidden rounded-[28px] border-[8px] border-foreground/90 bg-background shadow-[var(--shadow-float)]">
        <div className="flex items-center gap-2 bg-primary px-4 py-3 text-primary-foreground">
          <IconBrandWhatsapp className="size-5" />
          <div className="min-w-0">
            <p className="truncate font-semibold">{thread.data?.business.name ?? "Business"}</p>
            <p className="text-[12px] opacity-80">
              {typing ? "typing…" : thread.data ? formatPhone(thread.data.business.number) : ""}
            </p>
          </div>
        </div>
        <div className="h-[460px] space-y-2 overflow-y-auto overscroll-contain bg-muted/40 px-3 py-4">
          {messages.length === 0 && (
            <p className="pt-10 text-center text-sm text-muted-foreground">
              Say hi to start the chat.
            </p>
          )}
          {messages.map((message) => (
            <div
              key={message.id}
              className={cn(
                "flex flex-col",
                message.from === "customer" ? "items-end" : "items-start",
              )}
            >
              <div
                className={cn(
                  "max-w-[85%] rounded-2xl px-3 py-2 text-[15px] leading-5 wrap-anywhere whitespace-pre-wrap",
                  message.from === "customer"
                    ? "rounded-br-md bg-primary-subtle text-primary-subtle-foreground"
                    : "rounded-bl-md bg-card",
                )}
              >
                <Linked text={message.text} />
              </div>
              <span className="tabular mt-0.5 px-1 text-[11px] text-muted-foreground">
                {clockTime(message.at)}
              </span>
            </div>
          ))}
          <div ref={bottom} />
        </div>
        <form
          className="flex items-center gap-2 border-t p-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            if (text.trim()) send.mutate();
          }}
        >
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="Message"
            aria-label="Message"
            className="h-11 min-w-0 flex-1 rounded-full border border-input bg-background px-4 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          />
          <button
            type="submit"
            disabled={!text.trim() || send.isPending || !phone}
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
            aria-label="Send"
          >
            <IconArrowUp className="size-5" />
          </button>
        </form>
      </div>
    </div>
  );
}
