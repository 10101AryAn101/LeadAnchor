"use client";

import { type LeadDetail, MAX_TAGS_PER_JOB, tagName } from "@leadanchor/contracts";
import { IconPlus, IconTag, IconX } from "@tabler/icons-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTags } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { useUpdateLead } from "./use-lead-actions";

/** The owner's own labels on a job (module 4), quiet so they never compete with the job itself. */
export function TagChips({ tags, max = tags.length, className }: { tags: string[]; max?: number; className?: string }) {
  if (tags.length === 0) return null;
  const shown = tags.slice(0, max);
  return (
    <span className={cn("flex flex-wrap gap-1", className)}>
      {shown.map((tag) => (
        <span key={tag} className="inline-flex h-6 items-center gap-1 rounded-full border border-input bg-background px-2 text-[13px] font-medium text-foreground/80">
          <IconTag className="size-3 text-muted-foreground" />
          {tag}
        </span>
      ))}
      {tags.length > shown.length && <span className="inline-flex h-6 items-center px-1 text-[13px] text-muted-foreground">+{tags.length - shown.length}</span>}
    </span>
  );
}

/** Add and remove tags on one job. Existing tags come first so spellings stay consistent. */
export function TagsEditor({ lead }: { lead: LeadDetail }) {
  const update = useUpdateLead();
  const { data } = useTags();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = (tags: string[]) => update.mutate({ id: lead.id, tags });
  const has = (tag: string) => lead.tags.some((existing) => existing.toLowerCase() === tag.toLowerCase());
  const add = (raw: string) => {
    const parsed = tagName.safeParse(raw);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Enter a tag");
    if (lead.tags.length >= MAX_TAGS_PER_JOB) return setError(`Up to ${MAX_TAGS_PER_JOB} tags per job`);
    if (!has(parsed.data)) save([...lead.tags, parsed.data]);
    setDraft("");
    setError(null);
    setOpen(false);
  };

  const query = draft.trim().toLowerCase();
  const options = [...(data?.tags.map((tag) => tag.name) ?? []), ...(data?.suggestions ?? [])]
    .filter((tag) => !has(tag) && tag.toLowerCase().includes(query))
    .slice(0, 8);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {lead.tags.map((tag) => (
        <span key={tag} className="inline-flex h-8 items-center gap-1 rounded-full border border-input bg-background pr-1 pl-2.5 text-sm font-medium">
          <IconTag className="size-3.5 text-muted-foreground" />
          {tag}
          <button
            type="button"
            aria-label={`Remove tag ${tag}`}
            onClick={() => save(lead.tags.filter((existing) => existing !== tag))}
            className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <IconX className="size-3.5" />
          </button>
        </span>
      ))}
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setError(null);
        }}
      >
        <PopoverTrigger render={<Button type="button" variant="ghost" size="sm" className="text-muted-foreground" />}>
          <IconPlus /> {lead.tags.length === 0 ? "Add a tag" : "Tag"}
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-[min(88vw,300px)] gap-3 p-3">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              add(draft);
            }}
          >
            <Input
              autoFocus
              value={draft}
              maxLength={24}
              placeholder="New tag, e.g. Warranty"
              aria-label="Tag"
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(null);
              }}
            />
            {error && <p className="mt-1.5 text-sm text-destructive">{error}</p>}
          </form>
          {options.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {options.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => add(tag)}
                  className="inline-flex h-8 items-center rounded-full border border-input bg-background px-2.5 text-sm font-medium hover:bg-muted"
                >
                  {tag}
                </button>
              ))}
            </div>
          )}
          {draft.trim() && !options.some((tag) => tag.toLowerCase() === query) && (
            <Button type="button" size="sm" onClick={() => add(draft)}>
              <IconPlus /> Add &ldquo;{draft.trim()}&rdquo;
            </Button>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
