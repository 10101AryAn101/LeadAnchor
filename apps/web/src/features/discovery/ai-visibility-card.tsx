"use client";

import type { AiVisibility } from "@leadanchor/contracts";
import {
  IconChevronDown,
  IconCircleCheck,
  IconCircleX,
  IconExternalLink,
  IconFlask,
  IconRefresh,
  IconSparkles,
} from "@tabler/icons-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { UpgradeNotice, useFeature } from "@/features/billing/upgrade-notice";
import { api, isApiError } from "@/lib/api";
import { keys, useDiscovery, useMe } from "@/lib/queries";
import { cn } from "@/lib/utils";

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/**
 * C-42 on Today: how often AI assistants name the business when customers ask for one, in plain
 * words, with two or three things that would help. Influenced, never guaranteed (AC e).
 */
export function AiVisibilityCard() {
  const { data } = useDiscovery();
  const { data: me } = useMe();
  const allowed = useFeature("ai_discovery");
  const owner = me?.role === "owner";
  const queryClient = useQueryClient();
  const [showQuestions, setShowQuestions] = useState(false);

  const update = (next: AiVisibility) => queryClient.setQueryData(keys.discovery, next);
  const check = useMutation({
    mutationFn: (simulate: boolean) =>
      api<AiVisibility>(simulate ? "/dev/simulator/discovery/check" : "/discovery/check", {
        method: "POST",
      }),
    onSuccess: (next) => {
      update(next);
      toast.success("Checked. Here's how often you came up.");
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't check just now."),
  });
  const optOut = useMutation({
    mutationFn: (optedOut: boolean) =>
      api<AiVisibility>("/discovery", { method: "PATCH", body: { optedOut } }),
    onSuccess: (next) => {
      update(next);
      toast.success(
        next.optedOut
          ? "Switched off. Your profile page no longer has the AI answers."
          : "Switched on. AI assistants can read your profile page again.",
      );
    },
    onError: (error) => toast.error(isApiError(error) ? error.message : "Couldn't change that."),
  });

  if (!data) return null;
  const latest = data.latest;

  return (
    <section className="space-y-4 rounded-lg border bg-card p-5">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-info-subtle text-info-strong">
          <IconSparkles className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-bold">Found by AI</h2>
          <p className="text-[15px] text-muted-foreground">
            When customers ask ChatGPT or Gemini for a pro near them, does your name come up?
          </p>
        </div>
      </div>

      {!allowed ? (
        <UpgradeNotice feature="ai_discovery" />
      ) : data.optedOut ? (
        <div className="space-y-3 rounded-lg bg-muted p-4 text-[15px]">
          <p>
            Switched off: your profile page has no AI answers, isn&apos;t in the sitemap, and no
            monthly check runs.
          </p>
          {owner && (
            <Button
              variant="outline"
              disabled={optOut.isPending}
              onClick={() => optOut.mutate(false)}
            >
              {optOut.isPending && <Spinner />} Switch back on
            </Button>
          )}
        </div>
      ) : (
        <>
          {latest ? (
            <div className="space-y-2">
              <p className="text-[15px]">
                <span className="tabular font-display text-[28px] leading-none font-semibold">
                  {latest.mentioned} of {latest.asked}
                </span>{" "}
                <span className="text-muted-foreground">
                  questions named you ({shortDate(latest.checkedAt)}
                  {latest.simulated && ", made-up answers for testing"})
                </span>
              </p>
              {data.history.length > 1 && <Trend history={data.history} />}
              <button
                type="button"
                onClick={() => setShowQuestions((open) => !open)}
                className="inline-flex min-h-11 items-center gap-1 text-[15px] font-semibold text-primary"
                aria-expanded={showQuestions}
              >
                What we asked{" "}
                <IconChevronDown
                  className={cn("size-4 transition-transform", showQuestions && "rotate-180")}
                />
              </button>
              {showQuestions && (
                <ul className="divide-y rounded-md border text-[15px]">
                  {latest.questions.map((item) => (
                    <li key={item.question} className="flex items-start gap-2 px-3 py-2">
                      {item.mentioned ? (
                        <IconCircleCheck className="mt-0.5 size-4 shrink-0 text-primary" />
                      ) : (
                        <IconCircleX className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0">
                        {item.question}
                        {!item.mentioned && item.named.length > 0 && (
                          <span className="block text-sm text-muted-foreground">
                            Named instead: {item.named.join(", ")}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="text-[15px] text-muted-foreground">
              Not checked yet. Once a month we ask an AI assistant ten questions a customer near you
              might ask, and count how often you come up.
            </p>
          )}

          <p className="text-sm text-muted-foreground">
            AI answers change from day to day. This counts how often you came up, never a ranking:
            LeadAnchor can make it more likely, not guarantee it.
          </p>

          {data.nextActions.length > 0 && (
            <div className="space-y-2">
              <p className="font-semibold">What would help most</p>
              <ul className="space-y-2">
                {data.nextActions.map((action) => (
                  <li key={action.title} className="rounded-md border p-3">
                    {action.href ? (
                      <Link
                        href={action.href}
                        className="font-semibold text-primary underline-offset-2 hover:underline"
                      >
                        {action.title}
                      </Link>
                    ) : (
                      <p className="font-semibold">{action.title}</p>
                    )}
                    <p className="text-sm text-muted-foreground">{action.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              nativeButton={false}
              render={<a href={data.pageUrl} target="_blank" rel="noopener noreferrer" />}
            >
              <IconExternalLink /> Your AI-readable page
            </Button>
            {owner && data.canCheckNow && (
              <Button
                variant="outline"
                disabled={check.isPending}
                onClick={() => check.mutate(false)}
              >
                {check.isPending && !check.variables ? <Spinner /> : <IconRefresh />} Check now
              </Button>
            )}
            {owner && process.env.NODE_ENV !== "production" && (
              <Button variant="ghost" disabled={check.isPending} onClick={() => check.mutate(true)}>
                {check.isPending && check.variables ? <Spinner /> : <IconFlask />} Test with made-up
                answers
              </Button>
            )}
            {owner && (
              <Button
                variant="ghost"
                className="text-muted-foreground"
                disabled={optOut.isPending}
                onClick={() => optOut.mutate(true)}
              >
                Switch off
              </Button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** Each monthly check as a bar: how often the business came up. */
function Trend({ history }: { history: AiVisibility["history"] }) {
  return (
    <div className="flex h-12 items-end gap-1.5" aria-label="How often you came up in each check">
      {history.map((point) => (
        <span
          key={point.checkedAt}
          title={`${shortDate(point.checkedAt)}: ${Math.round(point.rate * 100)}%`}
          className="w-5 rounded-t bg-info-strong/70"
          style={{ height: `${Math.max(6, point.rate * 100)}%` }}
        />
      ))}
    </div>
  );
}
