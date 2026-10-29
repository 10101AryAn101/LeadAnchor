"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent } from "react";
import { toast } from "sonner";
import { type SimulatedAlert, showSimulatedAlert } from "@/lib/push";
import { keys } from "@/lib/queries";

type RealtimeEvent =
  | { type: "lead.created" | "lead.updated"; leadId: string }
  | { type: "call.updated"; callId: string }
  | { type: "notification.created"; notificationId: string; title: string; body: string; leadId: string | null }
  | { type: "message.created"; messageId: string; leadId: string | null }
  | { type: "registration.updated" }
  | { type: "settings.updated" }
  | ({ type: "push.preview" } & SimulatedAlert);

/**
 * Subscribes to the API's server-sent events and refreshes exactly the data that
 * changed — a missed call appears on the board within a second, no refresh needed.
 */
export function useRealtime(onNotification?: (event: { title: string; body: string; leadId: string | null }) => void) {
  const queryClient = useQueryClient();
  // Always calls the latest handler without reconnecting when it changes.
  const notify = useEffectEvent((event: { title: string; body: string; leadId: string | null }) => onNotification?.(event));

  useEffect(() => {
    let source: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const connect = () => {
      source = new EventSource("/api/events", { withCredentials: true });
      source.onmessage = (message) => {
        let event: RealtimeEvent;
        try {
          event = JSON.parse(message.data);
        } catch {
          return;
        }
        switch (event.type) {
          case "lead.created":
          case "lead.updated":
            void queryClient.invalidateQueries({ queryKey: keys.leads });
            void queryClient.invalidateQueries({ queryKey: keys.lead(event.leadId) });
            void queryClient.invalidateQueries({ queryKey: keys.dashboardAll });
            void queryClient.invalidateQueries({ queryKey: keys.customersAll });
            void queryClient.invalidateQueries({ queryKey: keys.customerAll });
            void queryClient.invalidateQueries({ queryKey: keys.tags });
            break;
          case "call.updated":
            void queryClient.invalidateQueries({ queryKey: keys.calls });
            void queryClient.invalidateQueries({ queryKey: ["sim-call"] });
            void queryClient.invalidateQueries({ queryKey: keys.dashboardAll });
            break;
          case "notification.created":
            void queryClient.invalidateQueries({ queryKey: keys.notifications });
            notify(event);
            break;
          case "message.created":
            if (event.leadId) void queryClient.invalidateQueries({ queryKey: keys.lead(event.leadId) });
            void queryClient.invalidateQueries({ queryKey: ["sim-inbox"] });
            void queryClient.invalidateQueries({ queryKey: keys.outbox });
            void queryClient.invalidateQueries({ queryKey: ["consent"] });
            break;
          case "settings.updated":
            void queryClient.invalidateQueries({ queryKey: keys.settings });
            break;
          case "push.preview":
            // Firebase isn't connected yet: show the phone alert from here (C-05).
            void showSimulatedAlert(event).then((delayMs) => {
              if (delayMs !== null && event.tag === "test") toast.success(`Test alert shown ${(delayMs / 1000).toFixed(1)} s after it was sent.`);
            });
            void queryClient.invalidateQueries({ queryKey: keys.pushDevices });
            break;
          case "registration.updated":
            void queryClient.invalidateQueries({ queryKey: keys.registration });
            void queryClient.invalidateQueries({ queryKey: keys.integrations });
            void queryClient.invalidateQueries({ queryKey: keys.me });
            break;
        }
      };
      source.onerror = () => {
        source?.close();
        if (!closed) retryTimer = setTimeout(connect, 4000);
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(retryTimer);
      source?.close();
    };
  }, [queryClient]);
}

export { toast };
