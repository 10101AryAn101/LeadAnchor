"use client";

import { LEAD_STAGE_LABELS, type LeadDetail as LeadDetailData, type LeadStage, type MediaItem, type MessageItem } from "@leadanchor/contracts";
import {
  IconAlertTriangle,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconFileText,
  IconLink,
  IconMapPin,
  IconMessage,
  IconPencil,
  IconPhone,
  IconSend,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { BookingCard } from "@/features/booking/booking-card";
import { ChatCard } from "@/features/chat/chat-card";
import { LeadMoney } from "@/features/money/lead-money";
import { api, isApiError } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { formatPhone, money, smsHref, telHref, timeAgo } from "@/lib/format";
import { keys, useLead, useSettings } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { SourceLabel, StageGlyph, UrgencyChip, WaitingChip, isWaiting } from "./lead-meta";
import { TagsEditor } from "./lead-tags";
import { LeadTimeline } from "./lead-timeline";
import { MoveLeadSheet, type MoveTarget } from "./move-lead-sheet";
import { useRecordContact, useUpdateLead } from "./use-lead-actions";

export function LeadDetailView() {
  const { id } = useParams<{ id: string }>();
  const { data: lead, isPending, error } = useLead(id);
  const [moving, setMoving] = useState<{ target: MoveTarget; stage: LeadStage | null } | null>(null);
  const [editing, setEditing] = useState(false);
  const [photoId, setPhotoId] = useState<string | null>(null);
  const openPhoto = useCallback((mediaId: string) => setPhotoId(mediaId), []);
  const recordContact = useRecordContact();

  if (isPending) return <DetailSkeleton />;
  if (error || !lead) {
    return (
      <Empty className="py-20">
        <EmptyHeader>
          <EmptyTitle>We couldn&apos;t find that lead</EmptyTitle>
          <EmptyDescription>It may have been removed. Head back to your board.</EmptyDescription>
        </EmptyHeader>
        <Button nativeButton={false} render={<Link href="/leads" />}>
          Back to leads
        </Button>
      </Empty>
    );
  }

  const name = lead.customer.name ?? formatPhone(lead.customer.phone);
  const photos = lead.media.filter((item) => item.kind === "photo");
  const moveTarget: MoveTarget = { id: lead.id, name: lead.customer.name ?? "this customer", stage: lead.stage, valueCents: lead.valueCents };

  return (
    <div className="pb-24 lg:pb-0">
      <Link href="/leads" className="-ml-1 inline-flex min-h-11 items-center gap-1 text-[15px] font-medium text-muted-foreground hover:text-foreground">
        <IconChevronLeft className="size-5" /> Leads
      </Link>

      <div className="mt-2 grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {/* Header: who, and the actions right under the name (Attio pattern). */}
          <header className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {isWaiting(lead) && <WaitingChip since={lead.createdAt} />}
              <SourceLabel source={lead.source} />
              {lead.customer.isReturning && <Badge variant="outline">Returning customer</Badge>}
            </div>
            <h1 className="font-display text-[28px] leading-[34px] font-semibold">{name}</h1>
            {lead.customer.name && <p className="tabular text-[17px] text-muted-foreground">{formatPhone(lead.customer.phone)}</p>}
            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="outline" onClick={() => setMoving({ target: moveTarget, stage: null })} className="gap-2">
                <StageGlyph stage={lead.stage} /> {LEAD_STAGE_LABELS[lead.stage]} <IconChevronDown className="size-4 text-muted-foreground" />
              </Button>
              <div className="hidden gap-2 sm:flex">
                <Button nativeButton={false} render={<a href={telHref(lead.customer.phone)} />} onClick={() => recordContact(lead, "call")}>
                  <IconPhone /> Call {lead.customer.name?.split(" ")[0] ?? ""}
                </Button>
                <Button variant="outline" nativeButton={false} render={<a href={smsHref(lead.customer.phone)} />} onClick={() => recordContact(lead, "text")}>
                  <IconMessage /> Text
                </Button>
              </div>
              <Button variant="ghost" onClick={() => setEditing(true)}>
                <IconPencil /> Edit
              </Button>
            </div>
            <TagsEditor lead={lead} />
          </header>

          <SummaryCard lead={lead} onEdit={() => setEditing(true)} />

          {photos.length > 0 && <PhotoStrip photos={photos} onOpen={setPhotoId} />}

          <LeadMoney lead={lead} />

          <div className="space-y-4">
            <h2 className="text-[17px] font-bold">Activity</h2>
            <LeadTimeline lead={lead} onPhoto={openPhoto} />
          </div>

          <NoteComposer leadId={lead.id} />
        </div>

        <aside className="space-y-4">
          <CustomerCard lead={lead} />
          {lead.chat && <ChatCard chat={lead.chat} />}
          <BookingCard lead={lead} onMarkWon={() => setMoving({ target: moveTarget, stage: "won" })} />
          <RequestDetailsCard lead={lead} />
        </aside>
      </div>

      {/* Phones: Call / Text / Move stay under the thumb. */}
      <div className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t bg-background px-4 pt-3 sm:hidden">
        <div className="mx-auto flex max-w-md gap-2">
          <Button size="lg" className="flex-1" nativeButton={false} render={<a href={telHref(lead.customer.phone)} />} onClick={() => recordContact(lead, "call")}>
            <IconPhone /> Call
          </Button>
          <Button
            size="lg"
            variant="outline"
            className="flex-1"
            nativeButton={false}
            render={<a href={smsHref(lead.customer.phone)} />}
            onClick={() => recordContact(lead, "text")}
          >
            <IconMessage /> Text
          </Button>
          <Button size="lg" variant="outline" className="flex-1" onClick={() => setMoving({ target: moveTarget, stage: null })}>
            Move
          </Button>
        </div>
      </div>

      <MoveLeadSheet target={moving?.target ?? null} initialStage={moving?.stage} onClose={() => setMoving(null)} />
      <EditLeadSheet lead={lead} open={editing} onClose={() => setEditing(false)} />
      <PhotoSheet leadId={lead.id} photo={photos.find((item) => item.id === photoId) ?? null} onClose={() => setPhotoId(null)} />
    </div>
  );
}

function SummaryCard({ lead, onEdit }: { lead: LeadDetailData; onEdit: () => void }) {
  return (
    <section className="rounded-lg bg-info-subtle p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-info-strong">
          <IconFileText className="size-4" /> Summary (auto)
        </p>
        <button type="button" onClick={onEdit} className="min-h-11 px-1 text-sm font-semibold text-info-strong hover:underline">
          Edit
        </button>
      </div>
      <p className="text-[17px] leading-6 font-semibold">{lead.title}</p>
      <p className="mt-1 text-[15px] leading-6 text-foreground/80">
        {lead.summary ?? "We'll write a summary as soon as the customer says what they need."}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <UrgencyChip urgency={lead.urgency} />
        {lead.serviceCategory && <span className="inline-flex h-6 items-center rounded-full bg-card px-2 text-[13px] font-medium">{lead.serviceCategory}</span>}
      </div>
    </section>
  );
}

function PhotoStrip({ photos, onOpen }: { photos: MediaItem[]; onOpen: (id: string) => void }) {
  return (
    <section className="space-y-3">
      <h2 className="text-[17px] font-bold">Photos from the customer</h2>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {photos.map((photo) => (
          <button
            key={photo.id}
            type="button"
            onClick={() => onOpen(photo.id)}
            className="group relative aspect-square overflow-hidden rounded-md border bg-muted"
            aria-label={photo.aiTags?.issue ? `Photo: ${photo.aiTags.issue}` : "Open photo"}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- private, per-user image served by our API */}
            <img src={`/api/media/${photo.id}?variant=thumb`} alt="" className="size-full object-cover transition-transform group-hover:scale-[1.02]" />
            {photo.aiStatus === "pending" && (
              <span className="absolute inset-x-1.5 bottom-1.5 inline-flex items-center justify-center gap-1 rounded-sm bg-background/95 px-1.5 py-0.5 text-[13px]">
                <Spinner className="size-3" /> Reading
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}

function PhotoSheet({ leadId, photo, onClose }: { leadId: string; photo: MediaItem | null; onClose: () => void }) {
  if (!photo) return null;
  const tags = photo.aiTags;
  return (
    <ResponsiveSheet open onOpenChange={(open) => !open && onClose()} title={tags?.issue ?? "Customer photo"} className="sm:max-w-xl">
      <div className="space-y-4 pb-2">
        {/* eslint-disable-next-line @next/next/no-img-element -- private image served by our API */}
        <img src={`/api/media/${photo.id}`} alt={tags?.summary ?? "Customer photo"} className="max-h-[50dvh] w-full rounded-md bg-muted object-contain" />
        <ShowcaseToggle leadId={leadId} photo={photo} />
        {tags ? (
          <div className="space-y-3">
            <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-info-strong">
              <IconFileText className="size-4" /> What we see (auto)
            </p>
            <p className="text-[15px] leading-6">{tags.summary}</p>
            <dl className="grid grid-cols-2 gap-3 text-[15px]">
              {tags.itemType && <Fact label="Item" value={tags.itemType} />}
              {(tags.brand || tags.model) && <Fact label="Brand and model" value={[tags.brand, tags.model].filter(Boolean).join(" ")} />}
              {tags.urgency && <Fact label="Urgency" value={tags.urgency === "normal" ? "Routine" : <UrgencyChip urgency={tags.urgency} />} />}
              {typeof tags.confidence === "number" && <Fact label="Confidence" value={`${Math.round(tags.confidence * 100)}%`} />}
            </dl>
            {tags.visibleRisks && tags.visibleRisks.length > 0 && (
              <div className="rounded-md bg-destructive-subtle p-3 text-[15px] text-destructive-strong">
                <p className="inline-flex items-center gap-1.5 font-semibold">
                  <IconAlertTriangle className="size-4" /> Visible risks
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {tags.visibleRisks.map((risk) => (
                    <li key={risk}>{risk}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="text-[15px] text-muted-foreground">
            {photo.aiStatus === "pending" ? "Reading this photo…" : photo.aiStatus === "failed" ? "We couldn't read this photo automatically." : "Not analysed."}
          </p>
        )}
      </div>
    </ResponsiveSheet>
  );
}

/** C-41: the owner picks which job photos appear on their public profile. */
function ShowcaseToggle({ leadId, photo }: { leadId: string; photo: MediaItem }) {
  const queryClient = useQueryClient();
  const toggle = useMutation({
    mutationFn: (showcase: boolean) => api(`/media/${photo.id}`, { method: "PATCH", body: { showcase } }),
    onSuccess: (_data, showcase) => {
      void queryClient.invalidateQueries({ queryKey: keys.lead(leadId) });
      toast.success(showcase ? "Added to your public work gallery." : "Removed from your public work gallery.");
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't update the photo."),
  });
  return (
    <Field orientation="horizontal" className="items-start justify-between gap-4 rounded-lg border p-3">
      <div className="space-y-1">
        <FieldLabel htmlFor={`showcase-${photo.id}`}>Show on my public profile</FieldLabel>
        <FieldDescription>Only share photos that don&apos;t show the customer, their house number or their mail.</FieldDescription>
      </div>
      <Switch id={`showcase-${photo.id}`} checked={photo.showcase} disabled={toggle.isPending} onCheckedChange={(checked) => toggle.mutate(checked)} />
    </Field>
  );
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

function CustomerCard({ lead }: { lead: LeadDetailData }) {
  // Calls arrive newest first; the first contact is the oldest one.
  const call = lead.calls.at(-1);
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="font-bold">Customer</h2>
      <dl className="mt-3 space-y-3 text-[15px]">
        <div>
          <dt className="text-sm text-muted-foreground">Name</dt>
          <dd className="font-semibold">{lead.customer.name ?? "Not given yet"}</dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Phone</dt>
          <dd className="tabular font-semibold">{formatPhone(lead.customer.phone)}</dd>
        </div>
        {call && (
          <div>
            <dt className="text-sm text-muted-foreground">First contact</dt>
            <dd>{timeAgo(call.startedAt)}</dd>
          </div>
        )}
        <div>
          <dt className="text-sm text-muted-foreground">Job value</dt>
          <dd className="tabular font-semibold">
            {lead.valueCents != null ? money(lead.valueCents) : lead.estimatedValueCents != null ? `${money(lead.estimatedValueCents)} est.` : "—"}
          </dd>
        </div>
      </dl>
      <Link href={`/customers/${lead.customer.id}`} className="mt-3 inline-flex min-h-11 items-center gap-1 text-[15px] font-semibold text-primary">
        All jobs and history <IconChevronRight className="size-4" />
      </Link>
      {lead.otherLeads.length > 0 && (
        <div className="mt-4 border-t pt-4">
          <h3 className="text-sm font-semibold text-muted-foreground">Earlier jobs</h3>
          <ul className="mt-2 space-y-1">
            {lead.otherLeads.map((other) => (
              <li key={other.id}>
                <Link href={`/leads/${other.id}`} className="flex min-h-11 items-center gap-2 rounded-md px-2 hover:bg-muted">
                  <StageGlyph stage={other.stage} />
                  <span className="min-w-0 flex-1 truncate text-[15px]">{other.title}</span>
                  <span className="tabular text-sm text-muted-foreground">{other.valueCents != null ? money(other.valueCents) : timeAgo(other.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {lead.calls.length === 0 && lead.customer.phone == null && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
          <IconMapPin className="size-4" /> No contact details yet.
        </p>
      )}
    </section>
  );
}

/** C-07: send (or re-send) the no-login request form, through the governed send path. */
function RequestDetailsCard({ lead }: { lead: LeadDetailData }) {
  const queryClient = useQueryClient();
  const { data: settings } = useSettings();
  const [result, setResult] = useState<{ url: string; message: MessageItem | null } | null>(null);
  const [copied, setCopied] = useState(false);
  // C-41: the profile link rides on a new customer's first text unless the owner unticks it.
  const textedBefore = lead.messages.some((message) => message.direction === "outbound" && message.channel !== "email");
  const [profileChoice, setProfileChoice] = useState<boolean | null>(null);
  const includeProfile = profileChoice ?? ((settings?.profileLinkInTexts ?? true) && !textedBefore);

  const send = useMutation({
    mutationFn: () =>
      api<{ url: string; message: MessageItem | null }>(`/leads/${lead.id}/request-details`, { method: "POST", body: { includeProfile } }),
    onSuccess: (data) => {
      setResult(data);
      void queryClient.invalidateQueries({ queryKey: keys.lead(lead.id) });
      if (data.message?.status === "queued" || data.message?.status === "sent" || data.message?.status === "delivered") toast.success("Request form texted.");
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't create the link."),
  });

  const status = lead.intakeStatus;
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="font-bold">Request form</h2>
      <p className="mt-1 text-[15px] text-muted-foreground">
        {status === "submitted"
          ? "The customer sent their details."
          : status === "opened"
            ? "The customer opened the form but hasn't sent it yet."
            : status === "link_sent"
              ? "A link was sent. Waiting for the customer."
              : "Ask for photos and details — they fill it in, no app needed."}
      </p>
      <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-2.5 text-[15px]">
        <Checkbox checked={includeProfile} onCheckedChange={(checked) => setProfileChoice(checked === true)} />
        Add my profile link
      </label>
      <Button variant="outline" className="mt-1 w-full" onClick={() => send.mutate()} disabled={send.isPending}>
        {send.isPending ? <Spinner /> : <IconSend />} {status === "none" ? "Send request form" : "Send a new link"}
      </Button>
      {result && (
        <div className="mt-3 space-y-2">
          {result.message?.status === "blocked" && (
            <p className="rounded-md bg-signal-subtle p-3 text-[15px] text-signal-strong">
              Not texted: {result.message.blockedReason} Share the link yourself instead.
            </p>
          )}
          <div className="flex items-center gap-2 rounded-md border bg-muted px-3">
            <IconLink className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate py-2.5 text-sm">{result.url}</span>
            <button
              type="button"
              className="flex size-11 items-center justify-center text-muted-foreground hover:text-foreground"
              aria-label="Copy link"
              onClick={async () => {
                if (!(await copyText(result.url))) return;
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <IconCheck className="size-5 text-primary" /> : <IconCopy className="size-5" />}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function NoteComposer({ leadId }: { leadId: string }) {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const add = useMutation({
    mutationFn: () => api(`/leads/${leadId}/notes`, { method: "POST", body: { text } }),
    onSuccess: () => {
      setText("");
      void queryClient.invalidateQueries({ queryKey: keys.lead(leadId) });
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't save the note."),
  });

  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (text.trim()) add.mutate();
      }}
    >
      <label htmlFor="note" className="text-[17px] font-bold">
        Add a note
      </label>
      <Textarea id="note" value={text} onChange={(event) => setText(event.target.value)} placeholder="Gate code, parts to bring, what you quoted…" rows={3} />
      <div className="flex justify-end">
        <Button type="submit" variant="outline" disabled={add.isPending}>
          {add.isPending && <Spinner />} Save note
        </Button>
      </div>
    </form>
  );
}

function EditLeadSheet({ lead, open, onClose }: { lead: LeadDetailData; open: boolean; onClose: () => void }) {
  const update = useUpdateLead();
  const [title, setTitle] = useState(lead.title);
  const [name, setName] = useState(lead.customer.name ?? "");
  const [value, setValue] = useState(lead.valueCents != null ? String(Math.round(lead.valueCents / 100)) : "");

  const save = () => {
    update.mutate(
      {
        id: lead.id,
        ...(title.trim() && title.trim() !== lead.title && { title: title.trim() }),
        ...(name.trim() !== (lead.customer.name ?? "") && { customerName: name.trim() }),
        valueDollars: value.trim() === "" ? null : Number(value),
      },
      { onSuccess: (detail) => toast.success(detail.stage !== lead.stage ? `Saved. Moved to ${LEAD_STAGE_LABELS[detail.stage]}.` : "Saved.") },
    );
    onClose();
  };

  return (
    <ResponsiveSheet
      open={open}
      onOpenChange={(next) => !next && onClose()}
      title="Edit lead"
      footer={
        <Button size="lg" className="w-full" onClick={save}>
          Save changes
        </Button>
      }
    >
      <div className="space-y-4 pb-2">
        <Field>
          <FieldLabel htmlFor="edit-title">What they need</FieldLabel>
          <Input id="edit-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="edit-name">Customer name</FieldLabel>
          <Input id="edit-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        <Field>
          <FieldLabel htmlFor="edit-value">Job value</FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText>$</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput id="edit-value" type="number" inputMode="decimal" min={0} value={value} onChange={(e) => setValue(e.target.value)} />
          </InputGroup>
          {(lead.stage === "new" || lead.stage === "contacted") && <FieldDescription>The price you quoted. Adding it moves the job to Quoted.</FieldDescription>}
        </Field>
      </div>
    </ResponsiveSheet>
  );
}

function DetailSkeleton() {
  return (
    <div className={cn("grid gap-8 pt-12 lg:grid-cols-[minmax(0,1fr)_340px]")}>
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-11 w-80" />
        <Skeleton className="h-36 rounded-lg" />
        <Skeleton className="h-64 rounded-lg" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-56 rounded-lg" />
        <Skeleton className="h-40 rounded-lg" />
      </div>
    </div>
  );
}
