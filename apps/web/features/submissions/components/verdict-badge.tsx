import { verdictLabel, type Verdict } from "@workspace/judge"

import { cn } from "@workspace/ui/lib/utils"

export function verdictTone(verdict: Verdict | null) {
  if (verdict === "AC") return "text-success"
  if (verdict === "OK" || verdict === null) return "text-body"
  return "text-destructive"
}

export function VerdictText({
  verdict,
  kind,
  status,
  className,
}: {
  verdict: Verdict | null
  kind: "run" | "submit"
  status: "queued" | "running" | "done"
  className?: string
}) {
  const label =
    status === "queued"
      ? "Waiting"
      : status === "running"
        ? "Running"
        : verdict
          ? verdictLabel(verdict, kind)
          : "Unknown"
  return <span className={cn(verdictTone(verdict), className)}>{label}</span>
}

export const formatRuntime = (ms: number | null) =>
  ms === null ? "—" : `${ms} ms`

export const formatMemory = (kb: number | null) =>
  !kb ? "—" : `${(kb / 1024).toFixed(1)} MB`

/** "2 min ago", falling back to the date for anything older than a day. */
export function formatWhen(value: string) {
  const date = new Date(value)
  const seconds = Math.max(0, (Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return "just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}
