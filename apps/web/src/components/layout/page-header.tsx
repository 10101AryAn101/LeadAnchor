import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Screen title (Archivo, semi-expanded) with an optional one-line description and actions. */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0 space-y-1.5">
        <h1 className="font-display text-2xl leading-[30px] font-semibold sm:text-[28px] sm:leading-[34px]">{title}</h1>
        {description && <p className="max-w-2xl text-[15px] text-pretty text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
