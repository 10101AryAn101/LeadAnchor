"use client";

import { LEAD_STAGE_LABELS, LEAD_STAGES, type LeadCard as LeadCardData, type LeadStage } from "@leadanchor/contracts";
import { IconCalendarEvent, IconFlask, IconLayoutKanban, IconTag } from "@tabler/icons-react";
import Link from "next/link";
import { parseAsString, parseAsStringLiteral, useQueryState } from "nuqs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Kanban, KanbanBoard, KanbanColumn, KanbanItem, KanbanOverlay } from "@/components/ui/kanban";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useHydrated } from "@/hooks/use-hydrated";
import { useIsMobile } from "@/hooks/use-media-query";
import { money } from "@/lib/format";
import { useLeads } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { LeadCard } from "./lead-card";
import { LeadsSchedule } from "./leads-schedule";
import { StageGlyph, sortForColumn } from "./lead-meta";
import { MoveLeadSheet, type MoveTarget } from "./move-lead-sheet";
import { useUpdateLead } from "./use-lead-actions";

type Columns = Record<LeadStage, LeadCardData[]>;

function toColumns(leads: LeadCardData[]): Columns {
  const columns = Object.fromEntries(LEAD_STAGES.map((stage) => [stage, [] as LeadCardData[]])) as Columns;
  for (const lead of leads) columns[lead.stage].push(lead);
  for (const stage of LEAD_STAGES) columns[stage].sort(sortForColumn);
  return columns;
}

function columnTotal(leads: LeadCardData[]) {
  let cents = 0;
  let estimated = false;
  for (const lead of leads) {
    if (lead.valueCents != null) cents += lead.valueCents;
    else if (lead.estimatedValueCents != null) {
      cents += lead.estimatedValueCents;
      estimated = true;
    }
  }
  return { cents, estimated };
}

/** Module 4: two parallel views of the same jobs, by stage (Board) and by visit day (Schedule). */
const VIEWS = ["board", "schedule"] as const;
const viewParam = parseAsStringLiteral(VIEWS).withDefault("board").withOptions({ history: "replace" });
const tagParam = parseAsString.withOptions({ history: "replace" });

export function LeadsBoard() {
  // The board comes from browser-side queries; render it only after hydration (see useHydrated).
  return useHydrated() ? <LeadsBoardContent /> : <BoardSkeleton />;
}

function LeadsBoardContent() {
  const { data: leads, isPending } = useLeads();
  const isMobile = useIsMobile();
  const [moving, setMoving] = useState<{ target: MoveTarget; stage: LeadStage | null } | null>(null);
  const [view, setView] = useQueryState("view", viewParam);
  const [tag, setTag] = useQueryState("tag", tagParam);
  const shown = useMemo(
    () => (tag ? (leads ?? []).filter((lead) => lead.tags.some((name) => name.toLowerCase() === tag.toLowerCase())) : (leads ?? [])),
    [leads, tag],
  );

  const openMove = useCallback((lead: LeadCardData, stage: LeadStage | null = null) => {
    setMoving({
      target: { id: lead.id, name: lead.customer.name ?? "this customer", stage: lead.stage, valueCents: lead.valueCents },
      stage,
    });
  }, []);

  if (isPending) return <BoardSkeleton />;

  if (!leads || leads.length === 0) {
    return (
      <Empty className="rounded-lg border border-dashed py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <IconLayoutKanban />
          </EmptyMedia>
          <EmptyTitle>No leads yet</EmptyTitle>
          <EmptyDescription>Missed calls show up here within a minute — with what the caller needs.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button nativeButton={false} render={<Link href="/simulator" />}>
            <IconFlask /> Place a test call
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <>
      <LeadsToolbar leads={leads} view={view} onView={(next) => void setView(next)} tag={tag} onTag={(next) => void setTag(next)} />
      {view === "schedule" ? (
        <LeadsSchedule leads={shown} />
      ) : isMobile ? (
        <MobileColumns leads={shown} onMove={openMove} />
      ) : (
        <DesktopBoard leads={shown} onMove={openMove} />
      )}
      <MoveLeadSheet target={moving?.target ?? null} initialStage={moving?.stage} onClose={() => setMoving(null)} />
    </>
  );
}

/** Board or Schedule, plus a tag filter that both views share. */
function LeadsToolbar({
  leads,
  view,
  onView,
  tag,
  onTag,
}: {
  leads: LeadCardData[];
  view: (typeof VIEWS)[number];
  onView: (view: (typeof VIEWS)[number]) => void;
  tag: string | null;
  onTag: (tag: string | null) => void;
}) {
  const counted = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const lead of leads) {
      for (const name of lead.tags) {
        const entry = counts.get(name.toLowerCase()) ?? { name, count: 0 };
        entry.count += 1;
        counts.set(name.toLowerCase(), entry);
      }
    }
    return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [leads]);
  // A tag from an old link that no job has any more still shows, so it can be cleared.
  const tags = tag && !counted.some((item) => item.name.toLowerCase() === tag.toLowerCase()) ? [...counted, { name: tag, count: 0 }] : counted;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <ToggleGroup value={[view]} onValueChange={(value) => value[0] && onView(value[0] as (typeof VIEWS)[number])} variant="outline" aria-label="View">
        <ToggleGroupItem value="board" className="px-3">
          <IconLayoutKanban /> Board
        </ToggleGroupItem>
        <ToggleGroupItem value="schedule" className="px-3">
          <IconCalendarEvent /> Schedule
        </ToggleGroupItem>
      </ToggleGroup>
      {tags.length > 0 && (
        <div className="scrollbar-none -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="group" aria-label="Filter by tag">
          <FilterChip active={!tag} onClick={() => onTag(null)}>
            All jobs
          </FilterChip>
          {tags.map((item) => {
            const active = tag?.toLowerCase() === item.name.toLowerCase();
            return (
              <FilterChip key={item.name} active={active} onClick={() => onTag(active ? null : item.name)}>
                <IconTag className="size-3.5" />
                {item.name}
                <span className={cn("tabular text-sm", active ? "text-background/70" : "text-muted-foreground")}>{item.count}</span>
              </FilterChip>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Whether a sideways scroller has more to show on its left and on its right. */
function useScrollEdges(ref: React.RefObject<HTMLElement | null>) {
  const [edges, setEdges] = useState({ start: false, end: false });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const start = element.scrollLeft > 4;
      const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 4;
      setEdges((current) => (current.start === start && current.end === end ? current : { start, end }));
    };
    element.addEventListener("scroll", update, { passive: true });
    // Also reports once straight away, and again whenever the scroller or what's in it changes size.
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of element.children) observer.observe(child);
    return () => {
      element.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [ref]);
  return edges;
}

/** Soft fades on the sides that have more to scroll to, so stages off screen don't go unnoticed. */
function EdgeFades({ edges }: { edges: { start: boolean; end: boolean } }) {
  const fade = "pointer-events-none absolute inset-y-0 w-10 from-background to-transparent transition-opacity";
  return (
    <>
      <div aria-hidden className={cn(fade, "left-0 bg-linear-to-r", edges.start ? "opacity-100" : "opacity-0")} />
      <div aria-hidden className={cn(fade, "right-0 bg-linear-to-l", edges.end ? "opacity-100" : "opacity-0")} />
    </>
  );
}

/**
 * Every stage with its count. On phones they're tabs for the one column on screen, and the chosen
 * one scrolls into view (swiping to Won or Lost brings its chip along); on bigger screens they jump
 * the board to that column.
 */
function StageChips({
  counts,
  active,
  onPick,
  className,
  rowClassName,
}: {
  counts: Record<LeadStage, number>;
  active: LeadStage | null;
  onPick: (stage: LeadStage) => void;
  className?: string;
  rowClassName?: string;
}) {
  const row = useRef<HTMLDivElement>(null);
  const edges = useScrollEdges(row);

  useEffect(() => {
    const element = row.current;
    const chip = active ? element?.querySelector<HTMLElement>(`[data-stage="${active}"]`) : null;
    if (!element || !chip) return;
    element.scrollTo({ left: Math.max(0, chip.offsetLeft - (element.clientWidth - chip.offsetWidth) / 2), behavior: "smooth" });
  }, [active]);

  return (
    <div className={cn("relative bg-background", className)}>
      <div
        ref={row}
        className={cn("scrollbar-none relative flex gap-2 overflow-x-auto px-4 py-2.5", rowClassName)}
        role={active ? "tablist" : "group"}
        aria-label="Stages"
      >
        {LEAD_STAGES.map((stage) => {
          const selected = active === stage;
          return (
            <button
              key={stage}
              type="button"
              data-stage={stage}
              role={active ? "tab" : undefined}
              aria-selected={active ? selected : undefined}
              onClick={() => onPick(stage)}
              className={cn(
                "flex h-10 shrink-0 items-center gap-1.5 rounded-full border border-input px-3.5 text-[15px] font-medium",
                selected ? "border-foreground bg-foreground text-background" : "bg-card text-foreground hover:bg-muted",
              )}
            >
              {LEAD_STAGE_LABELS[stage]}
              <span className={cn("tabular text-sm", selected ? "text-background/70" : "text-muted-foreground")}>{counts[stage]}</span>
            </button>
          );
        })}
      </div>
      <EdgeFades edges={edges} />
    </div>
  );
}

const countsOf = (columns: Columns) => Object.fromEntries(LEAD_STAGES.map((stage) => [stage, columns[stage].length])) as Record<LeadStage, number>;

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-input px-3 text-[15px] font-medium",
        active ? "border-foreground bg-foreground text-background" : "bg-card text-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

/* ── Desktop and tablet: drag between columns (plus the same Move sheet) ─── */

function DesktopBoard({ leads, onMove }: { leads: LeadCardData[]; onMove: (lead: LeadCardData, stage?: LeadStage | null) => void }) {
  const update = useUpdateLead();
  const serverColumns = useMemo(() => toColumns(leads), [leads]);
  const [columns, setColumns] = useState<Columns>(serverColumns);
  const dragging = useRef<{ id: string; from: LeadStage } | null>(null);
  const board = useRef<HTMLDivElement>(null);
  const edges = useScrollEdges(board);
  const [flash, setFlash] = useState<LeadStage | null>(null);

  useEffect(() => {
    if (!dragging.current) setColumns(serverColumns);
  }, [serverColumns]);

  const findStage = (cols: Columns, id: string) => LEAD_STAGES.find((stage) => cols[stage].some((lead) => lead.id === id));

  // Six columns rarely fit side by side, so a stage chip slides the board to its column and marks it briefly.
  const jumpTo = (stage: LeadStage) => {
    const scroller = board.current;
    const column = scroller?.querySelector<HTMLElement>(`[data-stage="${stage}"]`);
    if (!scroller || !column) return;
    scroller.scrollTo({ left: column.offsetLeft - Number.parseFloat(getComputedStyle(scroller).paddingLeft), behavior: "smooth" });
    setFlash(stage);
    window.setTimeout(() => setFlash((current) => (current === stage ? null : current)), 1200);
  };

  return (
    <Kanban<LeadCardData>
      value={columns}
      onValueChange={(next) => setColumns(next as Columns)}
      getItemValue={(lead) => lead.id}
      onDragStart={({ active }) => {
        const from = findStage(serverColumns, String(active.id));
        if (from) dragging.current = { id: String(active.id), from };
      }}
      onDragCancel={() => {
        dragging.current = null;
        setColumns(serverColumns);
      }}
      onDragEnd={() => {
        const drag = dragging.current;
        dragging.current = null;
        if (!drag) return;
        const to = findStage(columns, drag.id);
        const lead = leads.find((item) => item.id === drag.id);
        setColumns(serverColumns);
        if (!to || !lead || to === drag.from) return;
        // Won and Lost ask for what they need first; cancelling leaves the card where it was.
        if (to === "won" || to === "lost") onMove(lead, to);
        else update.mutate({ id: lead.id, stage: to, undoStage: drag.from });
      }}
    >
      <StageChips counts={countsOf(serverColumns)} active={null} onPick={jumpTo} className="-mt-1 mb-2" rowClassName="px-0" />
      <div className="relative -mx-4 sm:-mx-6 lg:-mx-10">
        <KanbanBoard ref={board} className="relative flex gap-3 overflow-x-auto px-4 pb-4 [scrollbar-width:thin] sm:px-6 lg:px-10">
          {LEAD_STAGES.map((stage) => {
            const items = columns[stage];
            const total = columnTotal(items);
            return (
              <KanbanColumn
                key={stage}
                value={stage}
                data-stage={stage}
                className={cn(
                  "h-auto min-h-[60dvh] w-[300px] shrink-0 gap-2.5 rounded-lg border bg-muted/50 p-2.5 transition-shadow dark:bg-card/40",
                  stage === "lost" && "opacity-90",
                  flash === stage && "ring-2 ring-primary",
                )}
              >
                <header className="flex items-center gap-2 px-1.5 pt-1 pb-1.5">
                  <StageGlyph stage={stage} />
                  <span className="font-semibold">{LEAD_STAGE_LABELS[stage]}</span>
                  <span className="tabular text-sm text-muted-foreground">{items.length}</span>
                  {total.cents > 0 && (
                    <span className="tabular ml-auto text-sm text-muted-foreground">
                      {money(total.cents)}
                      {total.estimated ? " est." : ""}
                    </span>
                  )}
                </header>
                {items.map((lead) => (
                  <KanbanItem key={lead.id} value={lead.id} asHandle className="rounded-lg data-dragging:opacity-40">
                    <LeadCard lead={lead} onMove={(item) => onMove(item)} />
                  </KanbanItem>
                ))}
                {items.length === 0 && <p className="px-2 py-6 text-center text-sm text-muted-foreground">Drop a job here</p>}
              </KanbanColumn>
            );
          })}
        </KanbanBoard>
        <EdgeFades edges={edges} />
      </div>
      <KanbanOverlay>
        {({ value, variant }) => {
          if (variant !== "item") return null;
          const lead = leads.find((item) => item.id === value);
          return lead ? <LeadCard lead={lead} onMove={() => {}} className="w-[276px] scale-[1.02] shadow-[var(--shadow-float)]" /> : null;
        }}
      </KanbanOverlay>
    </Kanban>
  );
}

/* ── Phones: one column per screen, stage chips on top, no dragging ─────── */

const stageParam = parseAsStringLiteral(LEAD_STAGES).withDefault("new").withOptions({ history: "replace" });

function MobileColumns({ leads, onMove }: { leads: LeadCardData[]; onMove: (lead: LeadCardData) => void }) {
  const columns = useMemo(() => toColumns(leads), [leads]);
  const [stage, setStage] = useQueryState("stage", stageParam);
  const scroller = useRef<HTMLDivElement>(null);
  const columnRefs = useRef<Partial<Record<LeadStage, HTMLElement | null>>>({});
  const programmatic = useRef(false);

  // Sideways only: scrollIntoView would also scroll the page down past the title and the Board/Schedule switch.
  const slideTo = (next: LeadStage, behavior: ScrollBehavior) => {
    const column = columnRefs.current[next];
    if (column) scroller.current?.scrollTo({ left: column.offsetLeft, behavior });
  };

  // Scroll to the stage in the URL on first render (deep links from alerts land on the right column).
  useEffect(() => {
    slideTo(stage, "instant");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the chip row in sync while the owner swipes between columns.
  useEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (programmatic.current) return;
        const visible = entries.find((entry) => entry.isIntersecting);
        const next = visible?.target.getAttribute("data-stage") as LeadStage | null;
        if (next) void setStage(next);
      },
      { root, threshold: 0.6 },
    );
    for (const element of Object.values(columnRefs.current)) if (element) observer.observe(element);
    return () => observer.disconnect();
  }, [setStage]);

  const jump = (next: LeadStage) => {
    programmatic.current = true;
    void setStage(next);
    slideTo(next, "smooth");
    setTimeout(() => (programmatic.current = false), 450);
  };

  return (
    <div className="-mx-4">
      <StageChips counts={countsOf(columns)} active={stage} onPick={jump} className="sticky top-14 z-20" />

      <div ref={scroller} className="scrollbar-none relative flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-4 pt-1 pb-4">
        {LEAD_STAGES.map((option) => {
          const items = columns[option];
          const total = columnTotal(items);
          return (
            <section
              key={option}
              ref={(element) => {
                columnRefs.current[option] = element;
              }}
              data-stage={option}
              aria-label={LEAD_STAGE_LABELS[option]}
              className="w-[calc(100%-24px)] shrink-0 snap-start"
            >
              <div className="mb-2 flex items-baseline justify-between px-1">
                <h2 className="text-[17px] font-bold">{LEAD_STAGE_LABELS[option]}</h2>
                {total.cents > 0 && (
                  <span className="tabular text-sm text-muted-foreground">
                    {money(total.cents)}
                    {total.estimated ? " est." : ""}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-2.5">
                {items.map((lead) => (
                  <LeadCard key={lead.id} lead={lead} onMove={onMove} />
                ))}
                {items.length === 0 && (
                  <p className="rounded-lg border border-dashed px-4 py-10 text-center text-[15px] text-muted-foreground">
                    Nothing in {LEAD_STAGE_LABELS[option].toLowerCase()} right now.
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function BoardSkeleton() {
  return (
    <div className="flex gap-3 overflow-hidden">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="w-[300px] shrink-0 space-y-2.5 rounded-lg border bg-muted/50 p-2.5">
          <Skeleton className="h-6 w-28" />
          <Skeleton className="h-44 rounded-lg" />
          <Skeleton className="h-44 rounded-lg" />
        </div>
      ))}
    </div>
  );
}
