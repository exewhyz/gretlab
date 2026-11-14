import Link from "next/link"
import type { ReactNode } from "react"

import { cn } from "@workspace/ui/lib/utils"

/*
 * A home's figures: one ruled card, a cell per figure, never a row of separate tiles.
 * Cells wrap and grow to fill each row, so five figures never leave one alone on a line
 * with gaps beside it. The hairlines between cells are the card showing through a 1px gap.
 */
export function Figures({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap gap-px overflow-hidden rounded-xl bg-hairline shadow-xs ring-1 ring-foreground/10",
        className
      )}
    >
      {children}
    </div>
  )
}

/**
 * One figure: label, value and an optional line under it. `bad` turns the value red;
 * figures are never orange (orange is for actions). With `href` the cell leads to the
 * detail behind the number.
 */
export function Figure({
  label,
  value,
  hint,
  tone,
  href,
  testId,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: "bad" | "good"
  href?: string
  testId?: string
}) {
  const body = (
    <>
      <span className="text-caption text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-display-md font-semibold text-ink tabular-nums",
          tone === "bad" && "text-destructive",
          tone === "good" && "text-success"
        )}
      >
        {value}
      </span>
      {hint && (
        <span className="text-caption text-muted-foreground">{hint}</span>
      )}
    </>
  )
  const cell = "flex min-w-0 flex-1 basis-36 flex-col gap-1 bg-card px-4 py-3.5"
  return href ? (
    <Link
      href={href}
      data-testid={testId}
      className={cn(
        cell,
        "transition-colors hover:bg-canvas-soft focus-visible:-outline-offset-2"
      )}
    >
      {body}
    </Link>
  ) : (
    <div data-testid={testId} className={cell}>
      {body}
    </div>
  )
}
