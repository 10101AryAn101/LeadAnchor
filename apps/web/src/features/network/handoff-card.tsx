"use client";

import {
  HANDOFF_OFFER_HOURS,
  HANDOFF_SHARED_FIELDS,
  HANDOFF_STAY_DAYS,
  type HandoffItem,
  type LeadDetail,
  type LeadStage,
  TRADES,
  TRADE_LABELS,
  type Trade,
} from "@leadanchor/contracts";
import {
  IconArrowBackUp,
  IconCircleCheck,
  IconClock,
  IconPhone,
  IconUsersGroup,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api, isApiError } from "@/lib/api";
import { clockTime, formatPhone, telHref } from "@/lib/format";
import { keys, useMe } from "@/lib/queries";

/** Jobs that can be passed on: not booked, won or lost yet. */
const PASSABLE: LeadStage[] = ["new", "contacted", "quoted"];

const firstName = (lead: LeadDetail) => lead.customer.name?.trim().split(/\s+/)[0] ?? null;

/** C-24 on a job: pass it to a trusted pro instead of letting it go, and see who has it. */
export function HandoffCard({ lead }: { lead: LeadDetail }) {
  const [passing, setPassing] = useState(false);
  const handoff = lead.handoff;
  if (lead.passedBy) return <PassedToYou from={lead.passedBy} />;
  const passable =
    PASSABLE.includes(lead.stage) &&
    (!handoff || handoff.status === "expired" || handoff.status === "withdrawn");
  if (!handoff && !passable) return null;

  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="flex items-center gap-2 font-bold">
        <IconUsersGroup className="size-5 text-muted-foreground" /> Trusted pros
      </h2>
      {handoff ? (
        <HandoffStatus lead={lead} handoff={handoff} />
      ) : (
        <p className="mt-1 text-[15px] text-muted-foreground">
          Too busy for this one? Pass it to a pro near you instead of letting it go.
        </p>
      )}
      {passable && (
        <Button variant="outline" className="mt-3 w-full" onClick={() => setPassing(true)}>
          Pass to a trusted pro
        </Button>
      )}
      <PassSheet lead={lead} open={passing} onClose={() => setPassing(false)} />
    </section>
  );
}

function HandoffStatus({ lead, handoff }: { lead: LeadDetail; handoff: HandoffItem }) {
  const queryClient = useQueryClient();
  const withdraw = useMutation({
    mutationFn: () => api<HandoffItem>(`/handoffs/${handoff.id}/withdraw`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.lead(lead.id) });
      void queryClient.invalidateQueries({ queryKey: keys.network });
      toast.success("Taken back. The job is all yours again.");
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't take it back."),
  });
  const customer = firstName(lead) ?? "The customer";

  switch (handoff.status) {
    case "offered":
      return (
        <div className="mt-2 space-y-2">
          <p className="flex items-start gap-2 text-[15px]">
            <IconClock className="mt-0.5 size-4 shrink-0 text-signal-strong" />
            Offered to {handoff.offeredTo} {handoff.offeredTo === 1 ? "pro" : "pros"} near you until{" "}
            {clockTime(handoff.expiresAt)}. The first to accept gets it.
          </p>
          <p className="text-sm text-muted-foreground">
            They see only the job and the area until one of them takes it.
          </p>
          <Button
            variant="ghost"
            size="sm"
            disabled={withdraw.isPending}
            onClick={() => withdraw.mutate()}
          >
            {withdraw.isPending ? <Spinner /> : <IconArrowBackUp />} Take it back
          </Button>
        </div>
      );
    case "accepted":
      return (
        <div className="mt-2 space-y-2">
          <p className="flex items-start gap-2 text-[15px]">
            <IconCircleCheck className="mt-0.5 size-4 shrink-0 text-primary" />
            Passed to {handoff.partner?.name ?? "a pro"}.
          </p>
          {handoff.partner?.phone && (
            <a
              href={telHref(handoff.partner.phone)}
              className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-primary"
            >
              <IconPhone className="size-4" /> {formatPhone(handoff.partner.phone)}
            </a>
          )}
          <p className="text-sm text-muted-foreground">
            {customer} got a text naming them, and can choose to stay with you for{" "}
            {HANDOFF_STAY_DAYS} days.
          </p>
          {handoff.convertedAt && (
            <p className="text-sm font-medium text-primary">
              They won the job, so it counts toward your referral credit.
            </p>
          )}
        </div>
      );
    case "declined":
      return (
        <p className="mt-2 text-[15px]">
          {customer} chose to stay with you, so the job is back on your board.
        </p>
      );
    case "expired":
      return (
        <p className="mt-2 text-[15px] text-muted-foreground">
          No pro took it last time. You can try again.
        </p>
      );
    case "withdrawn":
      return (
        <p className="mt-2 text-[15px] text-muted-foreground">You took it back from the network.</p>
      );
  }
}

function PassSheet({
  lead,
  open,
  onClose,
}: {
  lead: LeadDetail;
  open: boolean;
  onClose: () => void;
}) {
  const { data: me } = useMe();
  const queryClient = useQueryClient();
  const [trade, setTrade] = useState<Trade | null>(null);
  const [note, setNote] = useState("");
  const chosen = trade ?? me?.tenant?.trade ?? "plumbing";
  const pass = useMutation({
    mutationFn: () =>
      api<HandoffItem>(`/leads/${lead.id}/handoff`, {
        method: "POST",
        body: { trade: chosen, note },
      }),
    onSuccess: (handoff) => {
      void queryClient.invalidateQueries({ queryKey: keys.lead(lead.id) });
      void queryClient.invalidateQueries({ queryKey: keys.network });
      setNote("");
      onClose();
      toast.success(
        `Offered to ${handoff.offeredTo} ${handoff.offeredTo === 1 ? "pro" : "pros"}. You'll hear when one takes it.`,
      );
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "Couldn't pass the job on."),
  });

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Pass to a trusted pro"
      description="Up to three pros near you who take this kind of work see the job and the area. The first to accept gets it."
      footer={
        <Button
          size="lg"
          className="w-full"
          disabled={pass.isPending}
          onClick={() => pass.mutate()}
        >
          {pass.isPending && <Spinner />} Pass it on
        </Button>
      }
    >
      <div className="space-y-4 pb-2">
        <Field>
          <FieldLabel htmlFor="handoff-trade">Kind of work</FieldLabel>
          <select
            id="handoff-trade"
            className="h-11 w-full rounded-md border border-input bg-background px-3 text-[15px]"
            value={chosen}
            onChange={(event) => setTrade(event.target.value as Trade)}
          >
            {TRADES.map((item) => (
              <option key={item} value={item}>
                {TRADE_LABELS[item]}
              </option>
            ))}
          </select>
          <FieldDescription>
            Pick another trade when the job isn&apos;t yours to do.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="handoff-note">Note for the pros (optional)</FieldLabel>
          <Textarea
            id="handoff-note"
            rows={3}
            maxLength={300}
            value={note}
            placeholder="Wants someone this week. Older house, copper pipes."
            onChange={(event) => setNote(event.target.value)}
          />
          <FieldDescription>
            Leave out the customer&apos;s name and number: only the pro who accepts gets those.
          </FieldDescription>
        </Field>
        <div className="space-y-2 rounded-md bg-muted p-3 text-sm">
          <p>
            <span className="font-semibold">The pro who accepts gets:</span>{" "}
            {HANDOFF_SHARED_FIELDS.join(", ").toLowerCase()}. Never the customer&apos;s history or
            anyone else&apos;s details.
          </p>
          <p>
            {firstName(lead) ?? "The customer"} gets a text naming that pro, with a link to stay
            with you instead. If nobody accepts within {HANDOFF_OFFER_HOURS} hours, the job stays
            with you.
          </p>
          <p>
            <Link
              href="/network"
              className="font-semibold text-primary underline-offset-2 hover:underline"
            >
              How the trusted pros network works
            </Link>
          </p>
        </div>
      </div>
    </ResponsiveSheet>
  );
}

function PassedToYou({ from }: { from: string }) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="flex items-center gap-2 font-bold">
        <IconUsersGroup className="size-5 text-muted-foreground" /> Passed to you
      </h2>
      <p className="mt-1 text-[15px] text-muted-foreground">
        {from} passed you this job through the trusted pros network. Use the customer&apos;s details
        only for this job, as the partner terms say.
      </p>
    </section>
  );
}
