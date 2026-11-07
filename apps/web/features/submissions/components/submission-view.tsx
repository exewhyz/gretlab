"use client"

import { useQuery } from "@tanstack/react-query"
import { LANGUAGES, isLanguageId, verdictLabel } from "@workspace/judge"
import Link from "next/link"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { CommentedCode } from "@/features/feedback/components/commented-code"
import { OutcomeBrowser } from "@/features/lab/components/test-results"
import styles from "@/features/lab/components/workbench.module.scss"
import { api } from "@/lib/api/client"
import { formatDateTime } from "@/lib/format"

import type { SubmissionView as Submission } from "../types"
import { formatMemory, formatRuntime, verdictTone } from "./verdict-badge"

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-hairline bg-canvas-soft px-3 py-2">
      <div className="text-caption-upper text-body uppercase">{label}</div>
      <div className="text-title-sm text-ink tabular-nums">{value}</div>
    </div>
  )
}

function CodeBlock({ submission }: { submission: Submission }) {
  const [path, setPath] = useState(submission.entry)
  const file =
    submission.files.find((item) => item.path === path) ?? submission.files[0]
  if (!file) return null
  return (
    <div className="overflow-hidden rounded-md border border-hairline">
      {submission.files.length > 1 && (
        <div className={styles.fileTabs} role="tablist" aria-label="Files">
          {submission.files.map((item) => (
            <Button
              key={item.path}
              type="button"
              variant="ghost"
              role="tab"
              aria-selected={item.path === file.path}
              className={cn(styles.fileTab, "h-auto")}
              onClick={() => setPath(item.path)}
            >
              {item.path}
            </Button>
          ))}
        </div>
      )}
      <CommentedCode
        content={file.content}
        comments={(submission.comments ?? []).filter((c) => c.path === file.path)}
      />
    </div>
  )
}

/** One submission in full: used by the Submissions tab and the submission's own page. */
export function SubmissionDetailView({
  id,
  onRestore,
}: {
  id: string
  onRestore?: (submission: Submission) => void
}) {
  const { data: submission, error } = useQuery({
    queryKey: ["submissions", "detail", id],
    queryFn: () => api<Submission>(`/submissions/${id}`),
    refetchInterval: (query) =>
      query.state.data && query.state.data.status !== "done" ? 1500 : false,
  })
  const [restored, setRestored] = useState(false)

  if (!submission) {
    return error ? (
      <p role="alert" className="text-body-sm text-destructive">
        {error.message}
      </p>
    ) : (
      <p className="text-body-sm text-body">Loading…</p>
    )
  }

  const { verdict, status, results } = submission
  const language = isLanguageId(submission.language)
    ? LANGUAGES[submission.language].label
    : submission.language

  return (
    <div className="grid gap-4 text-body-sm text-body">
      <div>
        <div
          data-testid="submission-verdict"
          className={cn("text-display-sm", verdictTone(verdict))}
        >
          {status === "done"
            ? verdict
              ? verdictLabel(verdict, submission.kind)
              : "Unknown"
            : "Still running…"}
        </div>
        <div className="mt-1 text-caption">
          {formatDateTime(submission.createdAt)} · {language}
          {submission.problem && (
            <>
              {" · "}
              <Link
                className="underline underline-offset-2 hover:text-ink"
                href={`/problems/${submission.problem.slug}`}
              >
                {submission.problem.title}
              </Link>
            </>
          )}
          {submission.contest && (
            <>
              {" · "}
              <Link
                className="underline underline-offset-2 hover:text-ink"
                href={`/contests/${submission.contest.slug}`}
              >
                {submission.contest.title}
              </Link>
            </>
          )}
        </div>
        {submission.author && (
          <div className="mt-0.5 text-caption">
            By {submission.author.name ?? submission.author.email} (
            {submission.author.email})
          </div>
        )}
      </div>

      {submission.kind === "run" && (
        <p className="rounded-md border border-hairline bg-canvas-soft px-3 py-2 text-caption">
          This is a Run, not a graded submission. It only tried the code on the
          cases below.
        </p>
      )}

      {status === "done" && (
        <div className="grid grid-cols-2 gap-2 min-[901px]:grid-cols-4">
          <Stat
            label="Tests passed"
            value={
              submission.totalTests === null
                ? "—"
                : `${submission.passedTests ?? 0} / ${submission.totalTests}`
            }
          />
          <Stat label="Runtime" value={formatRuntime(submission.runtimeMs)} />
          <Stat label="Memory" value={formatMemory(submission.memoryKb)} />
          {submission.contest?.scoring === "ioi" ? (
            <Stat
              label="Score"
              value={`${submission.score ?? 0} / ${submission.maxScore ?? 0}`}
            />
          ) : (
            <Stat
              label="Limits"
              value={`${submission.timeLimitMs / 1000} s, ${submission.memoryLimitMb} MB`}
            />
          )}
        </div>
      )}

      {verdict === "CE" && submission.compileOutput && (
        <div>
          <h3 className="mb-1 text-title-sm text-ink">Compiler output</h3>
          <pre className={cn(styles.output, styles.outputError)}>
            {submission.compileOutput}
          </pre>
        </div>
      )}

      {results.length > 0 && (
        <div>
          <h3 className="mb-2 text-title-sm text-ink">Tests</h3>
          <OutcomeBrowser outcomes={results} />
        </div>
      )}

      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-title-sm text-ink">Code</h3>
          {onRestore && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onRestore(submission)
                setRestored(true)
              }}
            >
              {restored ? "Loaded into the editor" : "Load into the editor"}
            </Button>
          )}
        </div>
        <CodeBlock submission={submission} />
      </div>
    </div>
  )
}
