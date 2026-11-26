"use client"

import { CheckIcon } from "@phosphor-icons/react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

/**
 * Where a short guided flow is (creating an organization): numbered steps, the current one in
 * ink, finished ones ticked and reachable again. The numbers carry the order, so they stay.
 */
export function Steps({
  steps,
  current,
  onStep,
}: {
  steps: readonly string[]
  current: number
  /** Going back to a finished step. */
  onStep?: (index: number) => void
}) {
  return (
    <ol
      className="flex flex-wrap items-center gap-x-1 gap-y-2"
      aria-label="Steps"
      data-testid="steps"
    >
      {steps.map((label, i) => {
        const done = i < current
        const here = i === current
        return (
          <li key={label} className="flex items-center gap-1">
            {i > 0 && (
              <span
                aria-hidden
                className="mx-1 hidden h-px w-5 bg-hairline-strong sm:block"
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!done || !onStep}
              aria-current={here ? "step" : undefined}
              onClick={() => onStep?.(i)}
              className={cn(
                "gap-2 px-2 disabled:opacity-100",
                here ? "text-ink" : done ? "text-body" : "text-muted-foreground"
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "flex size-5 items-center justify-center rounded-full text-caption tabular-nums",
                  here
                    ? "bg-ink text-canvas"
                    : done
                      ? "bg-hairline text-ink"
                      : "ring-1 ring-hairline-strong"
                )}
              >
                {done ? <CheckIcon className="size-3" /> : i + 1}
              </span>
              <span className={cn(here && "font-medium")}>{label}</span>
            </Button>
          </li>
        )
      })}
    </ol>
  )
}
