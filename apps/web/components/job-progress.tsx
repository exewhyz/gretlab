"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef } from "react"

import { Button, buttonVariants } from "@workspace/ui/components/button"
import { Progress } from "@workspace/ui/components/progress"
import { cn } from "@workspace/ui/lib/utils"

import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { toast } from "@/lib/toast"
import type { jobView } from "@/features/jobs/server"

type Job = ApiResult<typeof jobView>

/**
 * A background job someone started (an export of a whole gradebook): how far it has got, and
 * its file once it's ready, which downloads by itself. Asks every 2 seconds while it runs, then
 * stops. Jobs move forward on the server whether or not this is open.
 */
export function JobProgress({
  id,
  label,
  onClose,
  onFinished,
  autoDownload = true,
}: {
  id: string
  /** "Gradebook export". */
  label: string
  onClose?: () => void
  /** Called once when it ends (done, failed or cancelled), with what it ended as. */
  onFinished?: (job: Job) => void
  /** Download the file by itself when ready (exports); off for an import's report. */
  autoDownload?: boolean
}) {
  const queryClient = useQueryClient()
  const { data: job } = useQuery({
    queryKey: ["job", id],
    queryFn: () => api<Job>(`/jobs/${id}`),
    refetchInterval: (q) =>
      !q.state.data || ["queued", "running"].includes(q.state.data.status)
        ? 2_000
        : false,
  })
  const told = useRef(false)
  const fileUrl = `/api/v1/jobs/${id}/file`
  useEffect(() => {
    if (!job || told.current) return
    if (["done", "failed", "cancelled"].includes(job.status)) onFinished?.(job)
    if (job.status === "done") {
      told.current = true
      toast.success(`${label}: done`)
      // The file downloads by itself; the button stays for another copy.
      if (job.file && autoDownload) {
        const a = document.createElement("a")
        a.href = fileUrl
        a.download = job.file.name
        a.click()
      }
    } else if (job.status === "failed") {
      told.current = true
      toast.error(`${label}: failed`)
    } else if (job.status === "cancelled") told.current = true
  }, [job, label, fileUrl, onFinished, autoDownload])

  const running = !job || job.status === "queued" || job.status === "running"
  const percent =
    job?.total && job.total > 0
      ? Math.min(100, Math.round((100 * job.progress) / job.total))
      : null
  return (
    <div
      className="grid gap-2 rounded-xl bg-card p-3 ring-1 ring-foreground/10"
      data-testid="job-progress"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-body-sm font-medium text-ink">{label}</span>
        <span className="text-caption text-muted-foreground tabular-nums">
          {!job
            ? "Starting…"
            : job.status === "queued" && job.progress === 0
              ? "Waiting to start…"
              : running
                ? job.total
                  ? `${job.progress.toLocaleString()} of ${job.total.toLocaleString()}`
                  : "Working…"
                : job.status === "done"
                  ? "Ready"
                  : job.status === "cancelled"
                    ? "Cancelled"
                    : "Failed"}
        </span>
      </div>
      {running && <Progress value={percent ?? 0} aria-label={label} />}
      {job?.result?.summary && (
        <p className="text-body-sm text-body">{job.result.summary}</p>
      )}
      {job?.result?.lines && job.result.lines.length > 0 && (
        <ul
          className="max-h-48 overflow-y-auto rounded-lg bg-muted/40 p-2 text-caption text-body"
          data-testid="job-lines"
        >
          {job.result.lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {job?.status === "failed" && (
        <p className="text-body-sm text-destructive">
          {job.error ?? "It couldn't finish."} Try again; if it keeps failing,
          tell support the reference.
        </p>
      )}
      {job?.status === "queued" && job.error && (
        <p className="text-caption text-muted-foreground">
          A step failed and will be tried again shortly.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {job?.status === "done" && job.file && (
          <a
            href={fileUrl}
            download={job.file.name}
            className={cn(buttonVariants({ size: "sm" }))}
          >
            {autoDownload
              ? `Download ${job.file.name}`
              : "Download the full report"}
          </a>
        )}
        {running && (
          <Button
            size="sm"
            variant="outline"
            onClick={async () => {
              await api(`/jobs/${id}/cancel`, { method: "POST" })
              await queryClient.invalidateQueries({ queryKey: ["job", id] })
            }}
          >
            Cancel
          </Button>
        )}
        {!running && onClose && (
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        )}
      </div>
    </div>
  )
}
