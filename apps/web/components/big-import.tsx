"use client"

import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Progress } from "@workspace/ui/components/progress"

import { FormMessage } from "@/components/form"
import { JobProgress } from "@/components/job-progress"
import { api } from "@/lib/api/client"

/** Rows per upload request (features/jobs/imports' IMPORT_PART_ROWS). */
const PART = 5_000

/**
 * An import too big for one request (features/jobs/imports): the rows go up in parts, a
 * background job checks the whole file and reports, then, when asked, adds it. Leaving the page
 * doesn't stop either; the report stays downloadable for a day.
 */
export function BigImport({
  kind,
  slug,
  rows,
  createGroups = false,
  noun,
  onAdded,
}: {
  kind: "members.import" | "students.import"
  slug: string
  /** Reads the file's rows when asked (it can be large). */
  rows: () => Record<string, unknown>[]
  createGroups?: boolean
  /** "people", "students". */
  noun: string
  onAdded?: () => void
}) {
  const queryClient = useQueryClient()
  const [job, setJob] = useState<string | null>(null)
  const [phase, setPhase] = useState<
    "idle" | "uploading" | "checking" | "checked" | "adding" | "added"
  >("idle")
  const [sent, setSent] = useState({ done: 0, total: 0 })
  const [problem, setProblem] = useState<string | null>(null)

  async function check() {
    setProblem(null)
    try {
      const all = rows()
      setPhase("uploading")
      setSent({ done: 0, total: all.length })
      const begun = await api<{ job: string }>("/imports", {
        body: { kind, slug, total: all.length, createGroups },
      })
      for (let seq = 0; seq * PART < all.length; seq++) {
        await api(`/imports/${begun.job}/rows`, {
          body: { seq, rows: all.slice(seq * PART, (seq + 1) * PART) },
        })
        setSent({
          done: Math.min(all.length, (seq + 1) * PART),
          total: all.length,
        })
      }
      await api(`/imports/${begun.job}/run`, { body: { commit: false } })
      setJob(begun.job)
      setPhase("checking")
    } catch (e) {
      setPhase("idle")
      setProblem((e as Error).message)
    }
  }

  async function add() {
    if (!job) return
    setProblem(null)
    try {
      await api(`/imports/${job}/run`, { body: { commit: true } })
      await queryClient.invalidateQueries({ queryKey: ["job", job] })
      setPhase("adding")
    } catch (e) {
      setProblem((e as Error).message)
    }
  }

  return (
    <div className="grid gap-3" data-testid="big-import">
      <p className="text-body-sm text-body">
        A big file: it&apos;s sent in parts, then checked and added in the
        background, so you can leave this page while it runs.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {(phase === "idle" || phase === "uploading") && (
          <Button
            variant="outline"
            disabled={phase === "uploading"}
            onClick={check}
          >
            Check
          </Button>
        )}
        {phase === "checked" && <Button onClick={add}>Add these {noun}</Button>}
        {problem && <FormMessage message={{ text: problem, kind: "err" }} />}
      </div>
      {phase === "uploading" && (
        <div className="grid max-w-md gap-1">
          <span className="text-caption text-muted-foreground tabular-nums">
            Sending {sent.done.toLocaleString()} of{" "}
            {sent.total.toLocaleString()} rows
          </span>
          <Progress
            value={sent.total ? (100 * sent.done) / sent.total : 0}
            aria-label="Sending the file"
          />
        </div>
      )}
      {job && phase !== "idle" && phase !== "uploading" && (
        <div className="max-w-xl">
          <JobProgress
            key={`${job}-${phase === "checking" || phase === "checked" ? "check" : "add"}`}
            id={job}
            label={
              phase === "checking" || phase === "checked"
                ? "Checking the file"
                : `Adding the ${noun}`
            }
            autoDownload={false}
            onFinished={(j) => {
              if (j.status !== "done") return
              if (phase === "checking") setPhase("checked")
              if (phase === "adding" && j.commit) {
                setPhase("added")
                onAdded?.()
              }
            }}
          />
        </div>
      )}
    </div>
  )
}
