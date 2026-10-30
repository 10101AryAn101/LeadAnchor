"use client";

import {
  type AudiencePreview,
  CAMPAIGN_SEGMENTS,
  CAMPAIGN_SEGMENT_LABELS,
  type CampaignAudience,
  type CampaignDetail,
  type CampaignDraft,
  type CampaignSegment,
  type CampaignSendInput,
  campaignProblems,
} from "@leadanchor/contracts";
import {
  IconAlertTriangle,
  IconCalendarClock,
  IconCircleCheck,
  IconMailForward,
  IconSend,
  IconSparkles,
  IconTrash,
} from "@tabler/icons-react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { api, isApiError } from "@/lib/api";
import { keys, useCampaignOptions, useMe, useServices } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { TRIGGER_ICON } from "./campaign-meta";
import { EmailPreview, previewKey } from "./email-preview";

interface Form {
  name: string;
  audience: CampaignAudience;
  offer: string;
  offerEndsOn: string;
  serviceId: string;
  subject: string;
  body: string;
}

const formOf = (campaign: CampaignDetail): Form => ({
  name: campaign.name,
  audience: campaign.audience,
  offer: campaign.offer ?? "",
  offerEndsOn: campaign.offerEndsOn ?? "",
  serviceId: campaign.serviceId ?? "",
  subject: campaign.subject,
  body: campaign.body,
});

const bodyOf = (form: Form) => ({
  name: form.name.trim() || "Untitled campaign",
  audience: form.audience,
  offer: form.offer.trim() || null,
  offerEndsOn: form.offerEndsOn || null,
  serviceId: form.serviceId || null,
  subject: form.subject,
  body: form.body,
});

const SEGMENT_HELP: Record<CampaignSegment, string> = {
  quiet: "Finished jobs with you, nothing since, and no job open now.",
  customers: "Everyone you've finished a job for.",
  service: "People who had one particular service done.",
  tag: "People whose jobs carry one of your tags.",
  not_booked: "Asked for a quote or a visit, then didn't go ahead.",
};

const audienceReady = (audience: CampaignAudience) =>
  (audience.segment !== "service" || Boolean(audience.service)) &&
  (audience.segment !== "tag" || Boolean(audience.tag));

/** Module 11: everything about a campaign before the owner approves it. Changes save as they're made. */
export function CampaignEditor({ campaign }: { campaign: CampaignDetail }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Form>(() => formOf(campaign));
  // What the server has, to know when the form has unsaved changes.
  const [saved, setSaved] = useState(() => JSON.stringify(bodyOf(formOf(campaign))));
  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const save = useMutation({
    mutationFn: (body: ReturnType<typeof bodyOf>) =>
      api<CampaignDetail>(`/campaigns/${campaign.id}`, { method: "PATCH", body }),
    onSuccess: (next, body) => {
      setSaved(JSON.stringify(body));
      queryClient.setQueryData(keys.campaign(campaign.id), next);
      void queryClient.invalidateQueries({ queryKey: previewKey(campaign.id) });
      void queryClient.invalidateQueries({ queryKey: keys.campaigns });
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "Couldn't save the change."),
  });

  // Saves a moment after the owner stops typing.
  const pending = JSON.stringify(bodyOf(form)) !== saved;
  const { mutate } = save;
  useEffect(() => {
    if (!pending || !audienceReady(form.audience)) return;
    const timer = setTimeout(() => mutate(bodyOf(form)), 700);
    return () => clearTimeout(timer);
  }, [form, pending, mutate]);

  const audience = useQuery({
    queryKey: ["campaign-audience", JSON.stringify(form.audience)],
    queryFn: () =>
      api<AudiencePreview>("/campaigns/audience", { method: "POST", body: form.audience }),
    enabled: audienceReady(form.audience),
    placeholderData: keepPreviousData,
  });

  const copyProblems = campaignProblems(form);
  const incomplete = audienceReady(form.audience)
    ? null
    : `Pick the ${form.audience.segment === "service" ? "service" : "tag"} for the audience.`;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="min-w-0 space-y-5">
        {campaign.trigger && <TriggerNote campaign={campaign} />}

        <Card title="Name" description="Only you see this.">
          <Input
            aria-label="Campaign name"
            value={form.name}
            maxLength={80}
            onChange={(event) => set("name", event.target.value)}
          />
        </Card>

        <Card
          title="Who gets it"
          description="Only people who already came to you, through a job or a request. Anyone who unsubscribed is left out."
        >
          <AudiencePicker audience={form.audience} onChange={(value) => set("audience", value)} />
          <AudienceSummary
            preview={audience.data}
            loading={audience.isFetching}
            ready={audienceReady(form.audience)}
          />
        </Card>

        <Card
          title="The offer"
          description="Optional. It's shown in its own box, and on the booking page they land on."
        >
          <OfferFields form={form} set={set} bookingOn={campaign.bookingOn} />
        </Card>

        <Card
          title="The email"
          description="Write {first_name} where their first name should go."
          action={
            <DraftButton
              id={campaign.id}
              onDraft={(draft) =>
                setForm((current) => ({ ...current, subject: draft.subject, body: draft.body }))
              }
            />
          }
        >
          <Field>
            <FieldLabel htmlFor="campaign-subject">Subject</FieldLabel>
            <Input
              id="campaign-subject"
              value={form.subject}
              maxLength={150}
              onChange={(event) => set("subject", event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="campaign-body">Message</FieldLabel>
            <Textarea
              id="campaign-body"
              rows={11}
              value={form.body}
              maxLength={4000}
              onChange={(event) => set("body", event.target.value)}
            />
            <FieldDescription>
              The email adds a booking button, your phone number, your address and an unsubscribe
              link.
            </FieldDescription>
          </Field>
          {copyProblems.length > 0 && (
            <ul className="space-y-1.5">
              {copyProblems.map((problem) => (
                <li key={problem} className="flex items-start gap-2 text-[15px] text-signal-strong">
                  <IconAlertTriangle className="mt-0.5 size-4 shrink-0" /> {problem}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <DeleteButton campaign={campaign} />
      </div>

      <aside className="min-w-0 space-y-4 lg:sticky lg:top-20 lg:self-start">
        <SendCard
          campaign={campaign}
          reachable={audience.data?.reachable ?? null}
          saving={!incomplete && (save.isPending || pending)}
          incomplete={incomplete}
        />
        <EmailPreview id={campaign.id} />
      </aside>
    </div>
  );
}

function Card({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="space-y-4 rounded-lg border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-[17px] font-bold">{title}</h2>
          {description && <p className="text-[15px] text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function TriggerNote({ campaign }: { campaign: CampaignDetail }) {
  const trigger = campaign.trigger!;
  const Icon = TRIGGER_ICON[trigger.kind];
  return (
    <div className="flex items-start gap-3 rounded-lg border border-signal/40 bg-signal-subtle p-4">
      <Icon className="mt-0.5 size-5 shrink-0 text-signal-strong" />
      <div className="min-w-0 text-[15px]">
        <p className="font-semibold text-signal-strong">{trigger.title}</p>
        <p className="text-foreground/80">
          {trigger.detail}{" "}
          {campaign.status === "suggested"
            ? "We drafted this offer for you. Nothing is sent until you approve it."
            : ""}
        </p>
      </div>
    </div>
  );
}

const selectClass = "h-11 w-full rounded-md border border-input bg-background px-3 text-[15px]";

function AudiencePicker({
  audience,
  onChange,
}: {
  audience: CampaignAudience;
  onChange: (audience: CampaignAudience) => void;
}) {
  const { data: options } = useCampaignOptions();
  return (
    <div className="space-y-3">
      <div role="radiogroup" aria-label="Who gets it" className="grid grid-cols-1 gap-2">
        {CAMPAIGN_SEGMENTS.map((segment) => {
          const checked = audience.segment === segment;
          return (
            <label
              key={segment}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
                checked ? "border-primary bg-primary-subtle/50" : "hover:bg-muted/50",
              )}
            >
              <input
                type="radio"
                name="segment"
                value={segment}
                checked={checked}
                onChange={() => onChange({ ...audience, segment })}
                className="mt-1 size-4 accent-[var(--primary)]"
              />
              <span className="min-w-0">
                <span className="block font-semibold">{CAMPAIGN_SEGMENT_LABELS[segment]}</span>
                <span className="block text-sm text-muted-foreground">{SEGMENT_HELP[segment]}</span>
              </span>
            </label>
          );
        })}
      </div>
      {(audience.segment === "quiet" || audience.segment === "not_booked") && (
        <Field>
          <FieldLabel htmlFor="audience-months">
            {audience.segment === "quiet" ? "No work for at least" : "Asked within the last"}
          </FieldLabel>
          <select
            id="audience-months"
            className={selectClass}
            value={audience.months}
            onChange={(event) => onChange({ ...audience, months: Number(event.target.value) })}
          >
            {[3, 6, 9, 12, 18, 24].map((months) => (
              <option key={months} value={months}>
                {months} months
              </option>
            ))}
          </select>
        </Field>
      )}
      {audience.segment === "service" && (
        <Field>
          <FieldLabel htmlFor="audience-service">Service</FieldLabel>
          <select
            id="audience-service"
            className={selectClass}
            value={audience.service ?? ""}
            onChange={(event) => onChange({ ...audience, service: event.target.value || null })}
          >
            <option value="">Pick a service</option>
            {options?.services.map((service) => (
              <option key={service} value={service}>
                {service}
              </option>
            ))}
          </select>
        </Field>
      )}
      {audience.segment === "tag" && (
        <Field>
          <FieldLabel htmlFor="audience-tag">Tag</FieldLabel>
          <select
            id="audience-tag"
            className={selectClass}
            value={audience.tag ?? ""}
            onChange={(event) => onChange({ ...audience, tag: event.target.value || null })}
          >
            <option value="">
              {options && options.tags.length === 0 ? "No tags on your jobs yet" : "Pick a tag"}
            </option>
            {options?.tags.map((tag) => (
              <option key={tag} value={tag}>
                {tag}
              </option>
            ))}
          </select>
        </Field>
      )}
    </div>
  );
}

function AudienceSummary({
  preview,
  loading,
  ready,
}: {
  preview: AudiencePreview | undefined;
  loading: boolean;
  ready: boolean;
}) {
  if (!ready)
    return <p className="text-[15px] text-muted-foreground">Pick one to see who it reaches.</p>;
  if (!preview)
    return (
      <p className="flex items-center gap-2 text-[15px] text-muted-foreground">
        <Spinner className="size-4" /> Finding them…
      </p>
    );
  const names = preview.sample.map((person) => person.name);
  const more = preview.reachable - names.length;
  return (
    <div
      className={cn(
        "space-y-1.5 rounded-lg bg-muted/60 p-3 text-[15px] transition-opacity",
        loading && "opacity-60",
      )}
    >
      <p className="font-semibold">
        {preview.reachable === 0
          ? "Nobody can get it yet"
          : `${preview.reachable} ${preview.reachable === 1 ? "person" : "people"} will get it`}
      </p>
      {names.length > 0 && (
        <p className="text-muted-foreground">
          {names.join(", ")}
          {more > 0 ? ` and ${more} more` : ""}
        </p>
      )}
      {preview.skipped.length > 0 && (
        <p className="text-muted-foreground">
          Left out:{" "}
          {preview.skipped.map((skip) => `${skip.count} ${skip.reason.toLowerCase()}`).join(", ")}.
        </p>
      )}
    </div>
  );
}

function OfferFields({
  form,
  set,
  bookingOn,
}: {
  form: Form;
  set: <K extends keyof Form>(key: K, value: Form[K]) => void;
  bookingOn: boolean;
}) {
  const { data: services } = useServices();
  const active = services?.filter((service) => service.active) ?? [];
  return (
    <div className="space-y-4">
      <Field>
        <FieldLabel htmlFor="campaign-offer">Offer</FieldLabel>
        <Input
          id="campaign-offer"
          value={form.offer}
          maxLength={120}
          placeholder="For example: $25 off your next visit"
          onChange={(event) => set("offer", event.target.value)}
        />
      </Field>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="campaign-ends">Ends on</FieldLabel>
          <Input
            id="campaign-ends"
            type="date"
            value={form.offerEndsOn}
            onChange={(event) => set("offerEndsOn", event.target.value)}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="campaign-service">
            {bookingOn ? "Booking button opens" : "About"}
          </FieldLabel>
          <select
            id="campaign-service"
            className={selectClass}
            value={form.serviceId}
            onChange={(event) => set("serviceId", event.target.value)}
          >
            <option value="">Any service</option>
            {active.map((service) => (
              <option key={service.id} value={service.id}>
                {service.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {!bookingOn && (
        <FieldDescription>
          Online booking is off, so the button opens your request form instead.
        </FieldDescription>
      )}
    </div>
  );
}

function DraftButton({ id, onDraft }: { id: string; onDraft: (draft: CampaignDraft) => void }) {
  const draft = useMutation({
    mutationFn: () => api<CampaignDraft>(`/campaigns/${id}/draft`, { method: "POST" }),
    onSuccess: (result) => {
      onDraft(result);
      toast.success(
        result.source === "ai"
          ? "Written by AI. Read it through before sending."
          : "The AI is busy, so here's a ready-made version to edit.",
      );
    },
    onError: (error) =>
      toast.error(isApiError(error) ? error.message : "Couldn't write it. Try again in a moment."),
  });
  return (
    <Button
      type="button"
      variant="outline"
      disabled={draft.isPending}
      onClick={() => draft.mutate()}
    >
      {draft.isPending ? <Spinner /> : <IconSparkles />} Write it for me
    </Button>
  );
}

function DeleteButton({ campaign }: { campaign: CampaignDetail }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api(`/campaigns/${campaign.id}`, { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.campaigns });
      toast.success(
        campaign.status === "suggested"
          ? "Dismissed. We won't suggest it again."
          : "Draft deleted.",
      );
      router.push("/campaigns");
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't remove it."),
  });
  return (
    <Button
      type="button"
      variant="ghost"
      className="text-muted-foreground"
      disabled={remove.isPending}
      onClick={() => remove.mutate()}
    >
      {remove.isPending ? <Spinner /> : <IconTrash />}{" "}
      {campaign.status === "suggested" ? "Dismiss this suggestion" : "Delete draft"}
    </Button>
  );
}

const tomorrow = () => {
  const day = new Date(Date.now() + 86_400_000);
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
};

/** The owner's approval: a test to their own inbox, then send now or at a set time (C-30). */
function SendCard({
  campaign,
  reachable,
  saving,
  incomplete,
}: {
  campaign: CampaignDetail;
  reachable: number | null;
  saving: boolean;
  incomplete: string | null;
}) {
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const [confirming, setConfirming] = useState<"now" | "later" | null>(null);
  const [date, setDate] = useState(tomorrow);
  const [time, setTime] = useState("09:00");
  const isOwner = me?.role === "owner";

  const test = useMutation({
    mutationFn: () => api<{ to: string }>(`/campaigns/${campaign.id}/test`, { method: "POST" }),
    onSuccess: ({ to }) => toast.success(`Test sent to ${to}.`),
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't send the test."),
  });
  const send = useMutation({
    mutationFn: (input: CampaignSendInput) =>
      api<CampaignDetail>(`/campaigns/${campaign.id}/send`, { method: "POST", body: input }),
    onSuccess: (next, input) => {
      setConfirming(null);
      queryClient.setQueryData(keys.campaign(campaign.id), next);
      void queryClient.invalidateQueries({ queryKey: keys.campaigns });
      toast.success(
        input.when === "now" ? "Approved. It's going out now." : "Approved and scheduled.",
      );
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't send it."),
  });

  const blocked =
    incomplete ??
    campaign.problems[0] ??
    (reachable === 0 ? "Nobody in this audience can get an email yet." : null);
  const settled = !saving && !incomplete;
  const people =
    reachable === null ? "your customers" : `${reachable} ${reachable === 1 ? "person" : "people"}`;
  const minutes = Math.ceil((reachable ?? 0) / 60);
  const ready = settled && !blocked && isOwner && reachable !== null;
  return (
    <section className="space-y-3 rounded-lg border bg-card p-5">
      <div className="space-y-1">
        <h2 className="text-[17px] font-bold">Send</h2>
        <p className="text-[15px] text-muted-foreground">
          Goes to {people}, from your business name. Replies come to {me?.user.email ?? "you"}.
        </p>
      </div>
      {saving ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" /> Saving your changes…
        </p>
      ) : blocked ? (
        <p className="flex items-start gap-2 text-[15px] text-signal-strong">
          <IconAlertTriangle className="mt-0.5 size-4 shrink-0" /> {blocked}
        </p>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <IconCircleCheck className="size-4 text-primary" /> Saved and ready.
        </p>
      )}
      {!isOwner && me && (
        <p className="text-sm text-muted-foreground">Only the owner can approve a campaign.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!ready} onClick={() => setConfirming("now")}>
          <IconSend /> Send now
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!ready}
          onClick={() => setConfirming("later")}
        >
          <IconCalendarClock /> Schedule
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={!settled || test.isPending || Boolean(campaign.problems.length)}
          onClick={() => test.mutate()}
        >
          {test.isPending ? <Spinner /> : <IconMailForward />} Send me a test
        </Button>
      </div>

      <ResponsiveSheet
        open={confirming === "now"}
        onOpenChange={(open) => setConfirming(open ? "now" : null)}
        title={`Send “${campaign.name}” now?`}
        description={`It goes to ${people} ${minutes > 1 ? `over the next ${minutes} minutes` : "within a minute"}. Once it's out, it can't be taken back.`}
        footer={
          <Button
            type="button"
            disabled={send.isPending}
            onClick={() => send.mutate({ when: "now" })}
          >
            {send.isPending ? <Spinner /> : <IconSend />} Send to {people}
          </Button>
        }
      >
        <p className="pb-2 text-[15px] text-muted-foreground">
          Anyone who unsubscribes before it goes out is left out automatically.
        </p>
      </ResponsiveSheet>

      <ResponsiveSheet
        open={confirming === "later"}
        onOpenChange={(open) => setConfirming(open ? "later" : null)}
        title="Schedule it"
        description={`Times are in your business's time zone (${campaign.timezone.replace("_", " ")}).`}
        footer={
          <Button
            type="button"
            disabled={send.isPending || !date || !time}
            onClick={() => send.mutate({ when: "later", date, time })}
          >
            {send.isPending ? <Spinner /> : <IconCalendarClock />} Schedule for {people}
          </Button>
        }
      >
        <div className="grid grid-cols-1 gap-4 pb-2 sm:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="send-date">Day</FieldLabel>
            <Input
              id="send-date"
              type="date"
              value={date}
              min={tomorrow()}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="send-time">Time</FieldLabel>
            <Input
              id="send-time"
              type="time"
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </Field>
        </div>
      </ResponsiveSheet>
    </section>
  );
}
