import { IconStar, IconStarFilled, IconStarHalfFilled } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

/** A star rating, read out as "4.5 out of 5 stars". Halves round to the nearest half star. */
export function Stars({ rating, className }: { rating: number; className?: string }) {
  const halves = Math.round(rating * 2);
  return (
    <span
      role="img"
      aria-label={`${rating} out of 5 stars`}
      className={cn("inline-flex items-center text-signal", className)}
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const Glyph =
          halves >= star * 2
            ? IconStarFilled
            : halves === star * 2 - 1
              ? IconStarHalfFilled
              : IconStar;
        return (
          <Glyph
            key={star}
            aria-hidden
            className={cn("size-[1em]", Glyph === IconStar && "text-muted-foreground/40")}
          />
        );
      })}
    </span>
  );
}
