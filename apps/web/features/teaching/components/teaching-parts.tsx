"use client"

import { cn } from "@workspace/ui/lib/utils"

export interface Progress {
  total: number
  covered: number
  percent: number
  behind: string[]
  next: string | null
}

export function ProgressBar({ progress }: { progress: Progress }) {
  if (progress.total === 0) {
    return <span className="text-xs text-body">No syllabus yet</span>
  }
  return (
    <div className="grid gap-1">
      <div className="flex items-center gap-2 text-xs text-body tabular-nums">
        <div
          aria-hidden
          className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-strong"
        >
          <div
            className={cn(
              "h-full",
              progress.behind.length ? "bg-primary" : "bg-success"
            )}
            style={{ width: `${progress.percent}%` }}
          />
        </div>
        {progress.covered} / {progress.total} topics
      </div>
      {progress.behind.length > 0 && (
        <span className="text-xs text-primary" data-testid="behind">
          Behind: {progress.behind.slice(0, 2).join(", ")}
          {progress.behind.length > 2 &&
            ` and ${progress.behind.length - 2} more`}
        </span>
      )}
    </div>
  )
}
