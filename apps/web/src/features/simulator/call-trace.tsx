"use client";

import { CALL_OUTCOME_LABELS, type CallItem, formatPhone } from "@leadanchor/contracts";
import {
  type Icon,
  IconHeadset,
  IconMessageCircleQuestion,
  IconPhoneCall,
  IconPhoneIncoming,
  IconPhoneOff,
  IconPhoneX,
  IconRecordMail,
  IconShieldCheck,
  IconVolume,
} from "@tabler/icons-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { clockTimeSeconds } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface TraceEvent {
  id: string;
  type: string;
  data: Record<string, unknown>;
  occurredAt: string;
}

export interface CallTrace {
  call: CallItem & { state: string };
  events: TraceEvent[];
}

const quote = (value: unknown) => (typeof value === "string" && value ? `“${value}”` : "");

function describe(event: TraceEvent): { icon: Icon; title: string; detail?: string; tone?: "good" | "waiting" | "neutral" } {
  const d = event.data;
  switch (event.type) {
    case "call.incoming":
      return { icon: IconPhoneIncoming, title: "Call came in", detail: d.callerType === "known" ? "Returning caller" : "New caller" };
    case "owner.answered":
      return { icon: IconPhoneCall, title: "You picked up", detail: "Call connected to your cell.", tone: "good" };
    case "owner.unavailable":
      return {
        icon: IconPhoneX,
        title: d.reason === "machine" ? "Your voicemail picked up" : d.reason === "busy" ? "Your line was busy" : "Your cell rang — no answer",
        detail: d.reason === "machine" ? "We took the call back so the lead isn't lost in your mailbox." : "LeadAnchor takes over.",
        tone: "waiting",
      };
    case "playback.finished":
      return d.tag === "greeting"
        ? { icon: IconHeadset, title: "AI Dispatcher greeted the caller", detail: "Named the business and asked what they need." }
        : d.tag === "consent_question"
          ? { icon: IconMessageCircleQuestion, title: "Asked for permission to text" }
          : d.tag === "vm_prompt"
            ? { icon: IconVolume, title: "Played your voicemail greeting" }
            : { icon: IconVolume, title: "Said goodbye" };
    case "speech.result":
      return d.tag === "consent"
        ? { icon: IconShieldCheck, title: "Caller answered", detail: quote(d.transcript), tone: "good" }
        : { icon: IconMessageCircleQuestion, title: "Caller said", detail: quote(d.transcript) };
    case "speech.timeout":
      return { icon: IconMessageCircleQuestion, title: "Caller didn't answer" };
    case "recording.saved":
      return { icon: IconRecordMail, title: "Voicemail recorded", detail: typeof d.durationSecs === "number" ? `${d.durationSecs} seconds` : undefined };
    case "recording.transcribed":
      return { icon: IconRecordMail, title: "Voicemail transcribed", detail: quote(d.text), tone: "good" };
    case "caller.hangup":
      return { icon: IconPhoneOff, title: "Call ended" };
    default:
      return { icon: IconPhoneCall, title: event.type };
  }
}

export function CallTraceView({ trace, waiting }: { trace: CallTrace | null; waiting: boolean }) {
  if (!trace) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-6 text-center text-[15px] text-muted-foreground">
        {waiting ? (
          <>
            <Spinner className="size-5" /> Dialing your LeadAnchor line…
          </>
        ) : (
          "Place a test call to watch each step happen live."
        )}
      </div>
    );
  }

  const done = trace.call.state === "completed";
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="tabular font-semibold">{trace.call.customer?.name ?? formatPhone(trace.call.from)}</p>
        <span
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[13px] font-semibold",
            done ? "bg-primary-subtle text-primary-subtle-foreground" : "bg-info-subtle text-info-strong",
          )}
        >
          {!done && <Spinner className="size-3.5" />}
          {done ? CALL_OUTCOME_LABELS[trace.call.outcome] : "Call in progress"}
        </span>
      </div>
      <ol className="relative space-y-3.5 before:absolute before:top-2 before:bottom-2 before:left-[15px] before:w-px before:bg-border">
        {trace.events.map((event) => {
          const step = describe(event);
          return (
            <li key={event.id} className="relative flex gap-3 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200">
              <span
                className={cn(
                  "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full ring-4 ring-card",
                  step.tone === "good" ? "bg-primary-subtle text-primary-subtle-foreground" : step.tone === "waiting" ? "bg-signal-subtle text-signal-strong" : "bg-muted text-muted-foreground",
                )}
              >
                <step.icon className="size-4" stroke={1.75} />
              </span>
              <div className="min-w-0 flex-1 pt-1">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-semibold">{step.title}</p>
                  <span className="tabular shrink-0 text-[13px] text-muted-foreground">{clockTimeSeconds(event.occurredAt)}</span>
                </div>
                {step.detail && <p className="text-[15px] text-muted-foreground">{step.detail}</p>}
              </div>
            </li>
          );
        })}
      </ol>
      {done && trace.call.leadId && (
        <Button variant="outline" className="w-full" nativeButton={false} render={<Link href={`/leads/${trace.call.leadId}`} />}>
          Open the lead
        </Button>
      )}
    </div>
  );
}
