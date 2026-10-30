"use client";

import type { EmailFeedbackType, OutboxEmail } from "@leadanchor/contracts";
import { IconMail, IconMailX, IconSend, IconThumbDown } from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useHydrated } from "@/hooks/use-hydrated";
import { api, isApiError } from "@/lib/api";
import { fullDate } from "@/lib/format";
import { keys, useOutbox } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Development: every email the app would have sent, until an email service is connected. */
export function OutboxView() {
  const hydrated = useHydrated();
  const queryClient = useQueryClient();
  const sendSummary = useMutation({
    mutationFn: () => api("/dev/value-proof/send", { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.outbox });
      void queryClient.invalidateQueries({ queryKey: keys.notifications });
      toast.success("Summary sent. It's in your alerts and below.");
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't send the summary."),
  });

  return (
    <div className="space-y-5">
      <PageHeader
        title="Email outbox"
        description="No email service is connected yet, so emails the app sends wait here. You can also play the email service reporting a bounce or a spam complaint. For development only."
        actions={
          <Button variant="outline" onClick={() => sendSummary.mutate()} disabled={sendSummary.isPending}>
            {sendSummary.isPending ? <Spinner /> : <IconSend />} Send my summary now
          </Button>
        }
      />
      {hydrated ? <EmailList /> : <ListSkeleton />}
    </div>
  );
}

function EmailList() {
  const { data: emails, isPending } = useOutbox();
  if (isPending || !emails) return <ListSkeleton />;
  if (emails.length === 0) {
    return (
      <Empty className="rounded-lg border border-dashed py-14">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconMail />
          </EmptyMedia>
          <EmptyTitle>No emails yet</EmptyTitle>
          <EmptyDescription>Your daily or weekly summary lands here, along with receipts, review requests and campaign emails.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  return (
    <ul className="space-y-3">
      {emails.map((email) => (
        <EmailItem key={email.id} email={email} />
      ))}
    </ul>
  );
}

const FEEDBACK_LABEL: Record<EmailFeedbackType, string> = { bounce: "Bounced", complaint: "Marked as spam" };

function EmailItem({ email }: { email: OutboxEmail }) {
  const [open, setOpen] = useState(false);
  const [plain, setPlain] = useState(false);
  const queryClient = useQueryClient();
  const report = useMutation({
    mutationFn: (type: EmailFeedbackType) => api(`/dev/outbox/${email.id}/feedback`, { method: "POST", body: { type } }),
    onSuccess: (_, type) => {
      void queryClient.invalidateQueries({ queryKey: keys.outbox });
      void queryClient.invalidateQueries({ queryKey: keys.campaignAll });
      toast.success(type === "bounce" ? "Bounced. No more email goes to that address." : "Marked as spam. No more offers go to that address.");
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't report it."),
  });
  const delivered = (email.status === "sent" || email.status === "delivered") && !email.feedback;
  return (
    <li className="rounded-lg border bg-card">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="flex w-full items-start gap-3 p-4 text-left">
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">{email.subject ?? "(no subject)"}</span>
          <span className="block truncate text-sm text-muted-foreground">To {email.to}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-sm text-muted-foreground">{fullDate(email.createdAt)}</span>
          {email.status === "blocked" && (
            <Badge variant="outline" className="mt-1">
              Not sent
            </Badge>
          )}
          {email.feedback && (
            <Badge variant="outline" className="mt-1 text-destructive-strong">
              {FEEDBACK_LABEL[email.feedback]}
            </Badge>
          )}
        </span>
      </button>
      <div className={cn("space-y-3 border-t px-4 py-3", !open && "hidden")}>
        {email.blockedReason && <p className="text-[15px] text-signal-strong">{email.blockedReason}</p>}
        {email.replyTo && <p className="text-sm text-muted-foreground">Replies go to {email.replyTo}</p>}
        {email.html && !plain ? (
          <iframe title={email.subject ?? "Email"} srcDoc={email.html} sandbox="" className="block h-[520px] w-full rounded-md border bg-[#f4f2ec]" />
        ) : (
          <p className="text-[15px] leading-6 whitespace-pre-wrap">{email.body}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {email.html && (
            <Button variant="outline" size="sm" onClick={() => setPlain((value) => !value)}>
              {plain ? "Show the designed version" : "Show the plain text"}
            </Button>
          )}
          {delivered && (
            <>
              <Button variant="outline" size="sm" disabled={report.isPending} onClick={() => report.mutate("bounce")}>
                <IconMailX /> Make it bounce
              </Button>
              <Button variant="outline" size="sm" disabled={report.isPending} onClick={() => report.mutate("complaint")}>
                <IconThumbDown /> Mark it as spam
              </Button>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-20 rounded-lg" />
      <Skeleton className="h-20 rounded-lg" />
    </div>
  );
}
