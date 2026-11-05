import type { SourceFile, Verdict } from "@workspace/judge"

import type { TestOutcome } from "@/features/lab/hooks/use-question-session"

export interface SubmissionRow {
  id: string
  kind: "run" | "submit"
  language: string
  status: "queued" | "running" | "done"
  verdict: Verdict | null
  score: number | null
  maxScore: number | null
  runtimeMs: number | null
  memoryKb: number | null
  passedTests: number | null
  totalTests: number | null
  createdAt: string
  problem: string | null
  problemSlug?: string | null
  contest: string | null
  contestSlug?: string | null
  email?: string
  name?: string | null
}

export interface SubmissionDetail extends SubmissionRow {
  entry: string
  files: SourceFile[]
  compileOutput: string | null
  timeLimitMs: number
  memoryLimitMb: number
  results: (TestOutcome & { number: number })[]
  author: { name: string | null; email: string } | null
  problem: never
  contest: never
}

export type SubmissionView = Omit<SubmissionDetail, "problem" | "contest"> & {
  problem: { slug: string; title: string } | null
  contest: { slug: string; title: string; scoring: "icpc" | "ioi" } | null
}
