export type { ProblemDetail, ProblemSummary } from "@/features/problems/server"

export type StatementBlock = string | string[][]

export interface RunResult {
  out: string
  err: string
  timeout?: boolean
  /** The program failed (an exception, a non-zero exit); stderr alone isn't failure. */
  failed?: boolean
}

export type QuestionStatus = "solved" | "tried"
