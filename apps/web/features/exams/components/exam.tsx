"use client"

import { useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useEffect, useRef, useState, type ReactNode } from "react"

import { Button } from "@workspace/ui/components/button"

import { ConfirmButton } from "@/components/confirm"
import { FormMessage } from "@/components/form"
import { useViewer } from "@/features/account/use-viewer"
import { api } from "@/lib/api/client"
import { formatDateTime } from "@/lib/format"

export interface SittingView {
  status: "not_started" | "in_progress" | "finished"
  startedAt: string | null
  endsAt: string | null
  finishedEarly: boolean
}

export interface ProblemAssignment {
  slug: string
  title: string
  dueAt: string
  phase: "open" | "late"
  exam: { fullscreen: boolean; sitting: SittingView } | null
}

/** Open assignments using this problem; shared with the chips under its title. */
export function useProblemAssignments(problemSlug: string) {
  const { data: viewer } = useViewer()
  const enabled = Boolean(viewer?.user && viewer.features.assignments)
  return useQuery({
    queryKey: ["assignment", "for-problem", problemSlug],
    queryFn: () =>
      api<ProblemAssignment[]>(`/problems/${problemSlug}/assignments`),
    enabled,
  })
}

/** The exam this problem is part of that the student is sitting right now, if any. */
export function useExamInProgress(problemSlug: string) {
  const { data } = useProblemAssignments(problemSlug)
  return data?.find((a) => a.exam?.sitting.status === "in_progress") ?? null
}

/** Hints and the like, kept out of sight while the student is sitting an exam with this problem. */
export function HideDuringExam({
  problemSlug,
  children,
}: {
  problemSlug: string
  children: ReactNode
}) {
  return useExamInProgress(problemSlug) ? null : children
}

/** Refreshes everything that shows a sitting. */
function useRefreshExam() {
  const client = useQueryClient()
  return () =>
    client.invalidateQueries({
      predicate: (q) =>
        q.queryKey[0] === "assignment" || q.queryKey[0] === "assignments",
    })
}

const twoDigits = (n: number) => String(n).padStart(2, "0")

export function formatLeft(ms: number) {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h > 0 ? `${h}:${twoDigits(m)}:${twoDigits(s)}` : `${m}:${twoDigits(s)}`
}

/** Time left until `endsAt`, ticking each second; calls `onEnd` once at zero. */
function useTimeLeft(endsAt: string | null, onEnd?: () => void) {
  const [now, setNow] = useState(() => Date.now())
  const ended = useRef(false)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const left = endsAt ? new Date(endsAt).getTime() - now : 0
  useEffect(() => {
    if (endsAt && left <= 0 && !ended.current) {
      ended.current = true
      onEnd?.()
    }
  }, [endsAt, left, onEnd])
  return left
}

function enterFullscreen() {
  // Called straight from a click, which browsers require. Refusal isn't fatal: it's recorded.
  document.documentElement.requestFullscreen?.().catch(() => {})
}

/**
 * While a sitting is in progress: the time left, and what the browser notices (leaving the
 * tab or window, leaving fullscreen, pasting text copied from elsewhere) sent to the teacher.
 * A deterrent and a record, not proof: the teacher decides what it means.
 */
export function ExamGuard({
  slug,
  title,
  fullscreen,
  endsAt,
}: {
  slug: string
  title: string
  fullscreen: boolean
  endsAt: string
}) {
  const refresh = useRefreshExam()
  const left = useTimeLeft(endsAt, refresh)
  const [outside, setOutside] = useState(false)

  useEffect(() => {
    const last = new Map<string, number>()
    const report = (kind: string, detail?: string) => {
      // One report per kind every few seconds: alt-tab fires blur and visibility together.
      const now = Date.now()
      if (now - (last.get(kind) ?? 0) < 3000) return
      last.set(kind, now)
      api(`/assignments/${slug}/exam/events`, {
        body: { kind, detail },
      }).catch(() => {})
    }
    let copied = ""
    const onVisibility = () => {
      if (document.visibilityState === "hidden") report("left_tab", "Switched tab")
    }
    const onBlur = () => {
      if (document.visibilityState === "visible") report("left_tab", "Left the window")
    }
    const onFullscreen = () => {
      const inside = Boolean(document.fullscreenElement)
      setOutside(!inside)
      if (!inside) report("left_fullscreen")
    }
    const onCopy = () => {
      copied = String(window.getSelection() ?? "")
    }
    const onPaste = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData("text") ?? ""
      // Moving their own code around is fine; text from elsewhere is worth a note.
      if (text.trim() && text.trim() !== copied.trim()) {
        report("pasted", `${text.length} characters`)
      }
    }
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("blur", onBlur)
    document.addEventListener("copy", onCopy, true)
    document.addEventListener("cut", onCopy, true)
    document.addEventListener("paste", onPaste, true)
    if (fullscreen) {
      document.addEventListener("fullscreenchange", onFullscreen)
      setOutside(!document.fullscreenElement)
    }
    return () => {
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("blur", onBlur)
      document.removeEventListener("copy", onCopy, true)
      document.removeEventListener("cut", onCopy, true)
      document.removeEventListener("paste", onPaste, true)
      document.removeEventListener("fullscreenchange", onFullscreen)
    }
  }, [slug, fullscreen])

  const low = left < 5 * 60_000
  return (
    <>
      <Link
        href={`/assignments/${slug}`}
        data-testid="exam-timer"
        title={`${title}: back to the exam`}
        className={
          "fixed right-4 bottom-4 z-40 rounded-full border px-3 py-1.5 text-body-sm font-medium tabular-nums shadow-md " +
          (low
            ? "border-destructive bg-destructive text-white"
            : "border-hairline bg-card text-ink")
        }
      >
        {title} · {formatLeft(left)} left
      </Link>
      {fullscreen && outside && (
        <div
          role="alertdialog"
          aria-label="Return to fullscreen"
          className="fixed inset-0 z-50 grid place-items-center bg-canvas/95 p-4"
        >
          <div className="grid max-w-md gap-3 text-center">
            <h2 className="text-title-sm text-ink">This exam is taken in fullscreen</h2>
            <p className="text-body-sm text-body">
              Leaving fullscreen is noted for your teacher. Your time keeps running.
            </p>
            <Button className="justify-self-center" onClick={enterFullscreen}>
              Return to fullscreen
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

/** The exam's state on its assignment page: rules and Start, the clock, or the end. */
export function ExamPanel({
  slug,
  title,
  exam,
  problemCount,
  dueAt,
  phase,
}: {
  slug: string
  title: string
  exam: {
    minutes: number | null
    fullscreen: boolean
    restricted: boolean
    sitting: SittingView
  }
  problemCount: number
  dueAt: string
  phase: "upcoming" | "open" | "late" | "closed"
}) {
  const refresh = useRefreshExam()
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const { sitting } = exam
  const left = useTimeLeft(sitting.status === "in_progress" ? sitting.endsAt : null)

  async function act(path: string) {
    setBusy(true)
    setMessage(null)
    try {
      await api(`/assignments/${slug}/exam${path}`, { method: "POST" })
      await refresh()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Something went wrong.")
    } finally {
      setBusy(false)
    }
  }

  const rules = [
    `${problemCount} ${problemCount === 1 ? "problem" : "problems"}`,
    exam.minutes
      ? `${exam.minutes} minutes from when you start (ends by ${formatDateTime(dueAt)} at the latest)`
      : `until ${formatDateTime(dueAt)}`,
    "one attempt: once started, the clock doesn't stop",
    ...(exam.fullscreen ? ["in fullscreen"] : []),
    ...(exam.restricted ? ["from the lab's network only"] : []),
    "leaving the page, leaving fullscreen and pasting from elsewhere are noted for your teacher",
    "editorials and hints for its problems are hidden until you finish",
  ]

  return (
    <div
      data-testid="exam-panel"
      className="mb-4 grid gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4"
    >
      {sitting.status === "not_started" && (
        <>
          <h2 className="text-title-sm text-ink">Lab exam</h2>
          <ul className="grid list-disc gap-1 pl-5 text-body-sm text-body">
            {rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
          {phase === "open" ? (
            <ConfirmButton
              className="justify-self-start"
              disabled={busy}
              tone="default"
              title={`Start ${title}?`}
              description="Your time starts now and can't be paused or restarted."
              confirmLabel="Start exam"
              onConfirm={() => {
                if (exam.fullscreen) enterFullscreen()
                void act("")
              }}
            >
              Start exam
            </ConfirmButton>
          ) : (
            <p className="text-body-sm text-body">
              {phase === "upcoming"
                ? "You can start once it opens."
                : "The exam has closed."}
            </p>
          )}
        </>
      )}
      {sitting.status === "in_progress" && (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-title-sm text-ink">Exam in progress</h2>
            <span
              className="text-display-sm text-ink tabular-nums"
              data-testid="exam-clock"
            >
              {formatLeft(left)}
            </span>
          </div>
          <p className="text-body-sm text-body">
            Open a problem, solve it and press Submit; your best submission on each counts.
            Finish when you&apos;re done, or the exam ends by itself.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {exam.fullscreen && (
              <Button variant="outline" size="sm" onClick={enterFullscreen}>
                Fullscreen
              </Button>
            )}
            <ConfirmButton
              size="sm"
              disabled={busy}
              title="Finish the exam?"
              description="Nothing you submit afterwards counts. This can't be undone."
              confirmLabel="Finish exam"
              onConfirm={() => {
                void act("/finish").then(() =>
                  document.fullscreenElement
                    ? document.exitFullscreen().catch(() => {})
                    : undefined
                )
              }}
            >
              Finish exam
            </ConfirmButton>
          </div>
        </>
      )}
      {sitting.status === "finished" && (
        <>
          <h2 className="text-title-sm text-ink">Exam over</h2>
          <p className="text-body-sm text-body">
            {sitting.finishedEarly ? "You finished" : "Time ran out"}
            {sitting.endsAt ? ` at ${formatDateTime(sitting.endsAt)}` : ""}.
            Submissions made during the exam count; later ones are practice.
          </p>
        </>
      )}
      {message && <FormMessage message={{ text: message, kind: "err" }} />}
    </div>
  )
}
