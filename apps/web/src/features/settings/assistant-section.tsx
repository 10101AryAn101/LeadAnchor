"use client";

import type { AssistantSettings } from "@leadanchor/contracts";
import { IconBrandWhatsapp, IconCopy, IconExternalLink, IconWorld } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api, isApiError } from "@/lib/api";
import { copyText } from "@/lib/clipboard";
import { formatPhone } from "@/lib/format";
import { keys, useAssistant } from "@/lib/queries";

/** C-11, C-16: the assistant that answers WhatsApp, the website chat and texts, and where customers find it. */
export function AssistantSection() {
  const { data, isPending } = useAssistant();
  return (
    <section id="assistant" className="scroll-mt-24 rounded-lg border bg-card p-5">
      <div className="mb-4 space-y-1">
        <h2 className="text-[17px] font-bold">Chat assistant</h2>
        <p className="text-[15px] text-muted-foreground">
          Answers WhatsApp, your website chat and texts from your price list, your hours and the
          notes below. It finds out what they need, sends your booking link, and passes the chat to
          you when it can&apos;t help. You can take over any chat.
        </p>
      </div>
      {isPending || !data ? (
        <Skeleton className="h-48 rounded-lg" />
      ) : (
        <AssistantForm data={data} />
      )}
    </section>
  );
}

function AssistantForm({ data }: { data: AssistantSettings }) {
  const queryClient = useQueryClient();
  const [notes, setNotes] = useState(data.notes);
  const [saved, setSaved] = useState(data.notes);
  // Notes saved elsewhere come in unless the owner is typing.
  if (saved !== data.notes) {
    if (notes === saved) setNotes(data.notes);
    setSaved(data.notes);
  }
  const save = useMutation({
    mutationFn: (body: { enabled?: boolean; notes?: string }) =>
      api<AssistantSettings>("/assistant", { method: "PUT", body }),
    onSuccess: (next, body) => {
      queryClient.setQueryData(keys.assistant, next);
      void queryClient.invalidateQueries({ queryKey: keys.chats });
      toast.success(
        body.enabled === undefined
          ? "Saved. The assistant uses it from the next message."
          : body.enabled
            ? "The assistant is answering chats."
            : "The assistant is off; chats wait for you.",
      );
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't save that."),
  });
  const origin = new URL(data.webChatUrl).origin;
  const slug = new URL(data.webChatUrl).pathname.split("/").pop() ?? "";
  const snippet = `<script src="${origin}/widget.js" data-business="${slug}" data-action="chat" async></script>`;

  return (
    <div className="space-y-4">
      <Field
        orientation="horizontal"
        className="items-start justify-between gap-4 rounded-lg border bg-background p-4"
      >
        <div className="space-y-1">
          <FieldLabel htmlFor="assistant-enabled">Let the assistant answer chats</FieldLabel>
          <FieldDescription>
            It says it&apos;s an assistant, never quotes beyond your price list, and tells callers
            with an emergency to phone you.
          </FieldDescription>
        </div>
        <Switch
          id="assistant-enabled"
          checked={data.enabled}
          disabled={save.isPending}
          onCheckedChange={(enabled) => save.mutate({ enabled })}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor="assistant-notes">What should the assistant know?</FieldLabel>
        <Textarea
          id="assistant-notes"
          rows={4}
          maxLength={1500}
          value={notes}
          placeholder="For example: We cover Austin and Round Rock. We don't do septic tanks. Estimates are free on weekdays."
          onChange={(event) => setNotes(event.target.value)}
        />
        <FieldDescription>
          Facts only. It answers from these, your price list and your hours, and checks with you on
          anything else.
        </FieldDescription>
        {notes !== data.notes && (
          <div>
            <Button
              type="button"
              size="sm"
              disabled={save.isPending}
              onClick={() => save.mutate({ notes: notes.trim() })}
            >
              {save.isPending && <Spinner />} Save notes
            </Button>
          </div>
        )}
      </Field>

      <LinkCard
        icon={<IconBrandWhatsapp className="size-[18px]" />}
        title="Chat on WhatsApp"
        body={
          data.whatsappLink
            ? `Customers tap this to message ${data.whatsappNumber ? formatPhone(data.whatsappNumber) : "you"} on WhatsApp. It's also set as the chat link on your Google listing.${data.whatsappSimulated ? " WhatsApp isn't connected to Meta yet, so it opens a simulated WhatsApp." : ""}`
            : "WhatsApp isn't connected yet."
        }
        value={data.whatsappLink}
        copied="WhatsApp link copied."
      />
      <LinkCard
        icon={<IconWorld className="size-[18px]" />}
        title="Chat on your website"
        body="Share the link, or paste this line into your website to add a Chat button."
        value={data.webChatUrl}
        copied="Chat link copied."
        code={snippet}
        preview={`/widget-demo.html?business=${encodeURIComponent(slug)}&action=chat`}
      />
      {!data.textsAllowed && (
        <p className="text-sm text-muted-foreground">
          Texts get answered once carriers approve your business for texting.
        </p>
      )}
    </div>
  );
}

function LinkCard({
  icon,
  title,
  body,
  value,
  copied,
  code,
  preview,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  value: string | null;
  copied: string;
  code?: string;
  /** A sample website showing the button. */
  preview?: string;
}) {
  const copy = async (text: string, message: string) =>
    (await copyText(text))
      ? toast.success(message)
      : toast.error("Couldn't copy. Select the text and copy it instead.");
  return (
    <div className="space-y-3 rounded-lg border bg-background p-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {icon}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{title}</p>
          <p className="text-[15px] text-muted-foreground">{body}</p>
        </div>
      </div>
      {value && (
        <>
          <p className="rounded-md bg-muted px-3 py-2.5 text-[15px] break-all">{value}</p>
          {code && (
            <p className="rounded-md bg-muted p-3 font-mono text-[13px] leading-5 break-all">
              {code}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void copy(value, copied)}>
              <IconCopy /> Copy link
            </Button>
            {code && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void copy(code, "Website code copied.")}
              >
                <IconCopy /> Copy website code
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              nativeButton={false}
              render={<a href={value} target="_blank" rel="noreferrer" />}
            >
              <IconExternalLink /> Open
            </Button>
            {preview && (
              <Button
                type="button"
                variant="ghost"
                nativeButton={false}
                render={<a href={preview} target="_blank" rel="noreferrer" />}
              >
                <IconExternalLink /> Preview on a website
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
