export type { ProblemDetail, ProblemSummary } from "@/features/problems/server"

export type StatementBlock = string | string[][]

export interface RunResult {
  out: string
  err: string
  timeout?: boolean
}

export type QuestionStatus = "solved" | "tried"
