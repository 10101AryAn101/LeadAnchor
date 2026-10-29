"use client";

import { LEAD_STAGE_LABELS, LEAD_STAGES, type LeadStage } from "@leadanchor/contracts";
import { IconCheck } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { ResponsiveSheet } from "@/components/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import { StageGlyph } from "./lead-meta";
import { useUpdateLead } from "./use-lead-actions";

const LOST_REASONS = ["Went with someone else", "Price", "Couldn't reach them", "Not a job we do", "Other"];

export interface MoveTarget {
  id: string;
  name: string;
  stage: LeadStage;
  valueCents: number | null;
}

/**
 * "Move to…" (brief §4.4): the non-drag way to change a stage, and the prompt
 * every stage change goes through — Won asks for the job value (it feeds
 * "recovered"), Lost asks for a reason. Cancelling leaves the card where it was.
 */
export function MoveLeadSheet({
  target,
  initialStage,
  onClose,
}: {
  target: MoveTarget | null;
  /** Preselect a stage (e.g. a card dropped on the Won column). */
  initialStage?: LeadStage | null;
  onClose: () => void;
}) {
  const update = useUpdateLead();
  const [stage, setStage] = useState<LeadStage | null>(null);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    if (target) {
      setStage(initialStage ?? null);
      setValue(target.valueCents ? String(Math.round(target.valueCents / 100)) : "");
      setReason(null);
    }
  }, [target, initialStage]);

  if (!target) return null;

  const needsDetails = stage === "won" || stage === "lost";
  const valueNumber = Number(value);
  const valid = stage === "won" ? value.trim() !== "" && Number.isFinite(valueNumber) && valueNumber >= 0 : stage === "lost" ? Boolean(reason) : true;

  const commit = (next: LeadStage) => {
    update.mutate({
      id: target.id,
      stage: next,
      undoStage: target.stage,
      ...(next === "won" && { valueDollars: valueNumber }),
      ...(next === "lost" && { lostReason: reason }),
    });
    onClose();
  };

  const choose = (next: LeadStage) => {
    if (next === target.stage) return onClose();
    if (next === "won" || next === "lost") return setStage(next);
    commit(next);
  };

  return (
    <ResponsiveSheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={needsDetails ? (stage === "won" ? "Mark as won" : "Mark as lost") : `Move ${target.name}`}
      description={needsDetails ? undefined : "Pick where this job is now."}
      footer={
        needsDetails ? (
          <div className="flex w-full gap-2">
            <Button variant="outline" size="lg" className="flex-1" onClick={() => setStage(null)}>
              Back
            </Button>
            <Button size="lg" className="flex-1" disabled={!valid} onClick={() => stage && commit(stage)}>
              {stage === "won" ? "Mark as won" : "Mark as lost"}
            </Button>
          </div>
        ) : undefined
      }
    >
      {!needsDetails && (
        <ul className="-mx-1 flex flex-col gap-1 pb-2" role="listbox" aria-label="Stages">
          {LEAD_STAGES.map((option) => {
            const current = option === target.stage;
            return (
              <li key={option}>
                <button
                  type="button"
                  role="option"
                  aria-selected={current}
                  onClick={() => choose(option)}
                  className={cn(
                    "flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left font-medium transition-colors hover:bg-muted",
                    current && "bg-primary-subtle text-primary-subtle-foreground",
                  )}
                >
                  <StageGlyph stage={option} className="size-5" />
                  <span className="flex-1">{LEAD_STAGE_LABELS[option]}</span>
                  {current && <IconCheck className="size-5 text-primary" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {stage === "won" && (
        <Field className="pb-2">
          <FieldLabel htmlFor="job-value">What was the job worth?</FieldLabel>
          <InputGroup>
            <InputGroupAddon>
              <InputGroupText>$</InputGroupText>
            </InputGroupAddon>
            <InputGroupInput id="job-value" type="number" inputMode="decimal" min={0} autoFocus value={value} onChange={(e) => setValue(e.target.value)} />
          </InputGroup>
          <FieldDescription>This real amount is what &ldquo;recovered&rdquo; counts — never an estimate.</FieldDescription>
        </Field>
      )}

      {stage === "lost" && (
        <div className="space-y-3 pb-2">
          <p className="text-[15px] text-muted-foreground">What happened?</p>
          <div className="flex flex-wrap gap-2">
            {LOST_REASONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setReason(option)}
                aria-pressed={reason === option}
                className={cn(
                  "min-h-11 rounded-full border border-input px-4 text-[15px] transition-colors",
                  reason === option ? "border-primary bg-primary-subtle font-semibold text-primary-subtle-foreground" : "hover:bg-muted",
                )}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      )}
    </ResponsiveSheet>
  );
}
