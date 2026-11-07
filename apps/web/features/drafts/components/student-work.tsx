"use client"

import { useQuery } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Slider } from "@workspace/ui/components/slider"
import { cn } from "@workspace/ui/lib/utils"

import { Loading } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import { formatDateTime } from "@/lib/format"

interface File {
  path: string
  content: string
}

export interface WorkingCopy {
  language: string
  files: File[]
  updatedAt: string
}

/** "12 seconds ago", "4 minutes ago": how fresh a working copy is. */
function ago(at: string, now: number) {
  const seconds = Math.max(0, Math.round((now - new Date(at).getTime()) / 1000))
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"} ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`
  return formatDateTime(at)
}

function Code({ files, changed }: { files: File[]; changed?: Set<string> }) {
  return (
    <div className="grid gap-2">
      {files.map((f) => (
        <div key={f.path} className="grid gap-1">
          {files.length > 1 && (
            <div className="text-xs text-body">{f.path}</div>
          )}
          <pre className="max-h-96 overflow-auto rounded-md border border-hairline bg-muted p-3 font-mono text-xs leading-5 text-ink [font-variant-ligatures:none]">
            {f.content.split("\n").map((line, i) => (
              <div
                key={i}
                className={cn(
                  "min-h-5",
                  changed?.has(`${f.path}:${i}`) && "-mx-3 bg-primary/15 px-3"
                )}
              >
                {line || " "}
              </div>
            ))}
          </pre>
        </div>
      ))}
    </div>
  )
}

/**
 * The code a student is writing right now, refreshed every few seconds while it's open.
 * `path` is the attempts endpoint for this student and problem.
 */
export function LiveCode({ path }: { path: string }) {
  const { data, error } = useQuery({
    queryKey: ["working-copy", path],
    queryFn: () => api<{ draft: WorkingCopy | null }>(path),
    refetchInterval: 5000,
  })
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  if (!data) return <Loading error={error} />
  if (!data.draft) {
    return (
      <p className="text-body-sm text-body">
        Nothing written yet. Code appears here as the student types.
      </p>
    )
  }
  return (
    <div className="grid gap-2" data-testid="working-copy">
      <div className="flex flex-wrap items-center gap-x-3 text-caption text-body">
        <span className="flex items-center gap-1.5 text-ink">
          <span aria-hidden className="size-2 rounded-full bg-success" />
          Live
        </span>
        <span>{data.draft.language}</span>
        <span>Saved {ago(data.draft.updatedAt, now)}</span>
      </div>
      <Code files={data.draft.files} />
    </div>
  )
}

interface Snapshot {
  language: string
  files: File[]
  at: string
}

/** Lines that differ from the snapshot before, to show what each step changed. */
function changedLines(before: Snapshot | undefined, after: Snapshot) {
  const changed = new Set<string>()
  for (const f of after.files) {
    const old =
      before?.files.find((x) => x.path === f.path)?.content.split("\n") ?? []
    f.content.split("\n").forEach((line, i) => {
      if (line.trim() && old[i] !== line) changed.add(`${f.path}:${i}`)
    })
  }
  return changed
}

/** The code as it grew, snapshot by snapshot: to see how a solution was written. */
export function Playback({ path }: { path: string }) {
  const { data, error } = useQuery({
    queryKey: ["playback", path],
    queryFn: () => api<{ history: Snapshot[] }>(`${path}&history=1`),
  })
  const history = useMemo(() => data?.history ?? [], [data])
  const [step, setStep] = useState<number | null>(null)
  const [playing, setPlaying] = useState(false)
  const at = step ?? history.length - 1
  useEffect(() => {
    if (!playing) return
    if (at >= history.length - 1) {
      setPlaying(false)
      return
    }
    const timer = setTimeout(() => setStep(at + 1), 350)
    return () => clearTimeout(timer)
  }, [playing, at, history.length])

  if (!data) return <Loading error={error} />
  if (history.length === 0) {
    return (
      <p className="text-body-sm text-body">
        No history yet. It builds up every few seconds while the student types.
      </p>
    )
  }
  const snapshot = history[at]!
  const first = new Date(history[0]!.at).getTime()
  const minutes = Math.round((new Date(snapshot.at).getTime() - first) / 60000)
  return (
    <div className="grid gap-3" data-testid="playback">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (at >= history.length - 1) setStep(0)
            setPlaying((p) => !p)
          }}
        >
          {playing ? "Pause" : at >= history.length - 1 ? "Replay" : "Play"}
        </Button>
        <Slider
          aria-label="Point in the history"
          min={0}
          max={Math.max(1, history.length - 1)}
          step={1}
          value={[at]}
          className="min-w-40 flex-1 py-2"
          onValueChange={(value) => {
            setPlaying(false)
            setStep(Array.isArray(value) ? value[0]! : value)
          }}
        />
        <span className="text-caption text-body tabular-nums">
          {at + 1} of {history.length}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-3 text-caption text-body">
        <span>{formatDateTime(snapshot.at)}</span>
        <span>
          {minutes === 0 ? "at the start" : `${minutes} min after starting`}
        </span>
        <span>{snapshot.language}</span>
        <span className="text-primary">Highlighted: changed in this step</span>
      </div>
      <Code
        files={snapshot.files}
        changed={changedLines(history[at - 1], snapshot)}
      />
    </div>
  )
}
