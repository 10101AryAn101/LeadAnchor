"use client";

import type { WaitlistItem } from "@leadanchor/contracts";
import { IconHourglass, IconPhone, IconX } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, isApiError } from "@/lib/api";
import { formatPhone, telHref, timeAgo, visitTime } from "@/lib/format";
import { keys, useMe, useWaitlist } from "@/lib/queries";

/**
 * "Nov 2" or "Nov 2 – Nov 6": the days someone could come, on the business's calendar. The
 * window ends at midnight after the last day.
 */
function days(entry: WaitlistItem, timeZone: string | undefined) {
  const day = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" });
  const from = day.format(new Date(entry.from));
  const to = day.format(new Date(new Date(entry.to).getTime() - 1));
  return from === to ? from : `${from} – ${to}`;
}

/**
 * C-22 on the Schedule: who'd take a time that opens up. They hear first when a visit is
 * cancelled or moved; the owner can also just call them.
 */
export function WaitlistPanel() {
  const { data: entries } = useWaitlist();
  const { data: me } = useMe();
  if (!entries?.length) return null;
  return (
    <section aria-labelledby="waitlist-title" className="space-y-2">
      <div className="flex items-baseline gap-2 px-1">
        <h2 id="waitlist-title" className="text-[17px] font-bold">
          Waitlist
        </h2>
        <span className="text-sm text-muted-foreground">
          {entries.length} waiting · offered first when a time frees up
        </span>
      </div>
      <ul className="divide-y rounded-lg border bg-card">
        {entries.map((entry) => (
          <WaitlistRow key={entry.id} entry={entry} timeZone={me?.tenant?.timezone} />
        ))}
      </ul>
    </section>
  );
}

function WaitlistRow({ entry, timeZone }: { entry: WaitlistItem; timeZone: string | undefined }) {
  const queryClient = useQueryClient();
  const name = entry.customer.name ?? formatPhone(entry.customer.phone);
  const remove = useMutation({
    mutationFn: () => api(`/waitlist/${entry.id}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.waitlist });
      toast.success(`${name} is off the waitlist.`);
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't remove them."),
  });
  const reach = [entry.textsAllowed && "text", entry.customer.email && "email"]
    .filter(Boolean)
    .join(" or ");
  const body = (
    <>
      <p className="truncate text-[17px] leading-6 font-semibold">{name}</p>
      <p className="truncate text-[15px] text-muted-foreground">
        {[
          entry.service?.name,
          entry.bookedFor
            ? `booked ${visitTime(entry.bookedFor)}, wants earlier`
            : `any time ${days(entry, timeZone)}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p className="truncate text-sm text-muted-foreground">
        {entry.lastOfferedAt
          ? `Last offered a time ${timeAgo(entry.lastOfferedAt)}`
          : `Joined ${timeAgo(entry.createdAt)}`}
        {reach ? ` · hears by ${reach}` : " · call them: no text or email"}
      </p>
    </>
  );

  return (
    <li className="flex items-center gap-3 p-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <IconHourglass className="size-[18px]" />
      </span>
      {entry.leadId ? (
        <Link
          href={`/leads/${entry.leadId}`}
          className="min-w-0 flex-1 rounded-md outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
        >
          {body}
        </Link>
      ) : (
        <div className="min-w-0 flex-1">{body}</div>
      )}
      {entry.customer.phone && (
        <Button
          variant="outline"
          size="icon"
          nativeButton={false}
          render={<a href={telHref(entry.customer.phone)} />}
          aria-label={`Call ${name}`}
        >
          <IconPhone />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        disabled={remove.isPending}
        onClick={() => remove.mutate()}
        aria-label={`Take ${name} off the waitlist`}
      >
        <IconX />
      </Button>
    </li>
  );
}
