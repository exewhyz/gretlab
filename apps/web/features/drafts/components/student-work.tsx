"use client"

import { WarningIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Slider } from "@workspace/ui/components/slider"
import { cn } from "@workspace/ui/lib/utils"

import { Loading } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import { formatDateTime } from "@/lib/format"
import { languageLabel } from "@workspace/judge"

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
        <span>{languageLabel(data.draft.language)}</span>
        <span>Saved {ago(data.draft.updatedAt, now)}</span>
      </div>
      <Code files={data.draft.files} />
    </div>
  )
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

export interface Snapshot {
  language: string
  files: File[]
  at: string
}

/** A step where a lot of new code appeared at once (bigJumps, packages/judge/src/replay.ts). */
export interface Jump {
  step: number
  added: number
  seconds: number | null
}

/** A graded submission shown on the timeline: pressing it shows the code as it was then. */
export interface Mark {
  id: string
  at: string
  label: string
}

/** The code as it grew, snapshot by snapshot: to see how a solution was written. */
export function Playback({ path }: { path: string }) {
  const { data, error } = useQuery({
    queryKey: ["playback", path],
    queryFn: () =>
      api<{ history: Snapshot[]; jumps?: Jump[] }>(`${path}&history=1`),
  })
  if (!data) return <Loading error={error} />
  return <PlaybackView history={data.history} jumps={data.jumps ?? []} />
}

/** The last snapshot at or before a moment (the first, if none is that early). */
const stepAt = (history: Snapshot[], at: string) => {
  const t = new Date(at).getTime()
  let step = 0
  history.forEach((s, i) => {
    if (new Date(s.at).getTime() <= t) step = i
  })
  return step
}

/**
 * Plays a history back. `jumps` are pointed out and can be jumped to; `marks` (submissions)
 * show the code as it was when each was made; `origin` is what minutes count from (the
 * contest's start), else the first snapshot.
 */
export function PlaybackView({
  history,
  jumps = [],
  marks = [],
  origin,
}: {
  history: Snapshot[]
  jumps?: Jump[]
  marks?: Mark[]
  origin?: { at: string; label: string }
}) {
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

  if (history.length === 0) {
    return (
      <p className="text-body-sm text-body">
        No history yet. It builds up every few seconds while the student types.
      </p>
    )
  }
  const snapshot = history[at]!
  const from = new Date(origin?.at ?? history[0]!.at).getTime()
  const minutes = Math.round((new Date(snapshot.at).getTime() - from) / 60000)
  const jumpHere = jumps.find((j) => j.step === at)
  const go = (s: number) => {
    setPlaying(false)
    setStep(s)
  }
  return (
    <div className="grid gap-3" data-testid="playback">
      {jumps.length > 0 && (
        <div
          className="grid gap-1.5 rounded-md border border-hairline-strong bg-muted p-3 text-body-sm text-ink"
          data-testid="playback-jumps"
        >
          <p className="flex gap-2">
            <WarningIcon aria-hidden className="mt-0.5 shrink-0" />
            <span>
              {jumps.length === 1
                ? "Once, a lot of new code appeared at once"
                : `${jumps.length} times, a lot of new code appeared at once`}
              : more than anyone types in one save, so it was probably pasted.
              Worth a look, not proof: it may be the student&apos;s own code.
            </span>
          </p>
          <div className="flex flex-wrap gap-1.5">
            {jumps.map((j) => (
              <Button
                key={j.step}
                size="xs"
                variant={j.step === at ? "default" : "outline"}
                onClick={() => go(j.step)}
              >
                Step {j.step + 1}: +{j.added} characters
              </Button>
            ))}
          </div>
        </div>
      )}
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
          onValueChange={(value) =>
            go(Array.isArray(value) ? value[0]! : value)
          }
        />
        <span className="text-caption text-body tabular-nums">
          {at + 1} of {history.length}
        </span>
      </div>
      {marks.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-caption text-body">
          <span>Code when submitted:</span>
          {marks.map((m) => (
            <Button
              key={m.id}
              size="xs"
              variant="ghost"
              onClick={() => go(stepAt(history, m.at))}
            >
              {m.label}
            </Button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-x-3 text-caption text-body">
        <span>{formatDateTime(snapshot.at)}</span>
        <span>
          {origin
            ? `${origin.label} ${Math.max(0, minutes)}`
            : minutes === 0
              ? "at the start"
              : `${minutes} min after starting`}
        </span>
        <span>{languageLabel(snapshot.language)}</span>
        <span className="text-primary">Highlighted: changed in this step</span>
      </div>
      {jumpHere && (
        <p className="text-caption text-ink" data-testid="playback-jump-here">
          This step added {jumpHere.added} characters of new code
          {jumpHere.seconds !== null &&
            `, ${jumpHere.seconds} s after the save before`}
          .
        </p>
      )}
      <Code
        files={snapshot.files}
        changed={changedLines(history[at - 1], snapshot)}
      />
    </div>
  )
}
