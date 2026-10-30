"use client";

import { IconBell, IconBellOff, IconBellRinging, IconDeviceMobile, IconSend, IconTrash } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useHydrated } from "@/hooks/use-hydrated";
import { api, isApiError } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { type AlertSupport, alertSupport, savedDevice, turnOffAlerts, turnOnAlerts } from "@/lib/push";
import { keys, usePushDevices } from "@/lib/queries";
import { cn } from "@/lib/utils";

const UNAVAILABLE: Record<Exclude<AlertSupport, "ready">, string> = {
  insecure: "Alerts need a secure (https) connection. They work at localhost on this computer, and on phones once LeadAnchor is hosted.",
  install_first: "On iPhone, add LeadAnchor to your Home Screen first: tap Share, then Add to Home Screen. Open it from there and turn alerts on.",
  unsupported: "This browser can't show alerts. Try Chrome, Edge or Firefox.",
};

const errorText = (error: Error) =>
  error.message === "blocked"
    ? "Notifications are blocked for LeadAnchor. Allow them in the browser's site settings."
    : error.message === "dismissed"
      ? "Alerts weren't turned on: the permission prompt was closed."
      : isApiError(error)
        ? error.message
        : "Something went wrong with alerts. Please try again.";

/** C-05: a "tap to call back" alert on the owner's phone within seconds of a missed call. */
export function PhoneAlerts() {
  const hydrated = useHydrated();
  const queryClient = useQueryClient();
  const { data } = usePushDevices();
  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.pushDevices });

  const turnOn = useMutation({
    mutationFn: () => turnOnAlerts(data!.provider, data!.firebase),
    onSuccess: () => {
      void refresh();
      toast.success("Alerts are on for this phone. Send a test to see one.");
    },
    onError: (error) => toast.error(errorText(error)),
  });
  const turnOff = useMutation({
    mutationFn: (deviceId: string) => turnOffAlerts(deviceId),
    onSuccess: () => void refresh(),
    onError: (error) => toast.error(errorText(error)),
  });
  const test = useMutation({
    mutationFn: (deviceId: string) => api<{ status: string }>(`/push/devices/${deviceId}/test`, { method: "POST", body: {} }),
    onError: (error) => toast.error(errorText(error)),
  });

  if (!hydrated || !data) return <Skeleton className="h-32 rounded-lg" />;

  const support = alertSupport();
  const mine = savedDevice();
  const thisDevice = data.devices.find((device) => device.token === mine?.token) ?? null;
  const permission = support === "ready" ? Notification.permission : "default";
  const blocked = permission === "denied";
  // Registered but no longer allowed to show notifications counts as off.
  const on = thisDevice !== null && permission === "granted";
  const StatusIcon = on ? IconBellRinging : support === "ready" && !blocked ? IconBell : IconBellOff;

  return (
    <div className="space-y-4">
      <div className="space-y-4 rounded-lg border bg-background p-4">
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-full",
              on ? "bg-primary-subtle text-primary-subtle-foreground" : "bg-muted text-muted-foreground",
            )}
          >
            <StatusIcon className="size-[18px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{on ? "On for this phone" : "Off on this phone"}</p>
            <p className="text-[15px] text-muted-foreground">
              {on
                ? "Missed calls and voicemails show up here within seconds, with a Call back button."
                : support !== "ready"
                  ? UNAVAILABLE[support]
                  : blocked
                    ? "Notifications are blocked for LeadAnchor in this browser. Allow them in the browser's site settings, then come back."
                    : "Turn alerts on to hear about a missed call within seconds, even with LeadAnchor in the background."}
            </p>
          </div>
        </div>
        {on && thisDevice ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => test.mutate(thisDevice.id)} disabled={test.isPending}>
              {test.isPending ? <Spinner /> : <IconSend />} Send a test alert
            </Button>
            <Button type="button" variant="ghost" onClick={() => turnOff.mutate(thisDevice.id)} disabled={turnOff.isPending}>
              Turn off
            </Button>
          </div>
        ) : support === "ready" && !blocked ? (
          <Button type="button" onClick={() => turnOn.mutate()} disabled={turnOn.isPending}>
            {turnOn.isPending ? <Spinner /> : <IconBell />} Turn on alerts on this phone
          </Button>
        ) : (
          thisDevice && (
            <Button type="button" variant="ghost" onClick={() => turnOff.mutate(thisDevice.id)} disabled={turnOff.isPending}>
              Remove this phone
            </Button>
          )
        )}
      </div>

      {data.devices.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Getting alerts</p>
          <ul className="divide-y rounded-lg border bg-background">
            {data.devices.map((device) => {
              const isThis = device.token === mine?.token;
              return (
                <li key={device.id} className="flex items-center gap-3 p-3">
                  <IconDeviceMobile className="size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {device.label}
                      {isThis && (
                        <span className="ml-2 rounded-full bg-primary-subtle px-2 py-0.5 text-xs font-semibold text-primary-subtle-foreground">This phone</span>
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Added {timeAgo(device.createdAt)}
                      {device.lastAlertAt && ` · last alert ${timeAgo(device.lastAlertAt)}`}
                    </p>
                  </div>
                  {!isThis && (
                    <Button type="button" variant="ghost" size="icon" aria-label={`Stop alerts on ${device.label}`} onClick={() => turnOff.mutate(device.id)}>
                      <IconTrash />
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {data.provider === "simulator" && (
        <p className="text-sm text-muted-foreground">
          Simulator: Firebase isn&apos;t connected yet, so alerts reach a phone only while LeadAnchor is open in a tab. Once Firebase is set up, they
          arrive even when the app is closed.
        </p>
      )}
    </div>
  );
}
