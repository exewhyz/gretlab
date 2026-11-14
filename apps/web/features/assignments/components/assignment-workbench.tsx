"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { Loading } from "@/features/admin/components/shell"
import type { SittingView } from "@/features/exams/components/exam"
import { ProblemView } from "@/features/lab/components/problem-view"
import { Workbench } from "@/features/lab/components/workbench"
import type {
  ProblemDetail,
  ProblemSummary,
  QuestionStatus,
} from "@/features/lab/types"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import type { getAssignmentProblem } from "@/features/assignments/server"

type AssignmentProblem = ApiResult<typeof getAssignmentProblem>

/**
 * Solving an assignment's problems on its own pages: numbered Q1, Q2 by the assignment,
 * with only its problems in the list and no ads. Exams are taken here.
 */
export function AssignmentWorkbench({
  slug,
  number,
}: {
  slug: string
  number: string
}) {
  const router = useRouter()
  const { data, error } = useQuery({
    queryKey: ["assignment", slug, "problem", number],
    queryFn: () =>
      api<AssignmentProblem>(`/assignments/${slug}/problems/${number}`),
  })
  if (!data) {
    return (
      <div className="p-6">
        <Loading error={error} />
        {error && (
          <Link
            href={`/assignments/${slug}`}
            className="text-caption underline"
          >
            Back to the assignment
          </Link>
        )}
      </div>
    )
  }
  const { assignment } = data
  const numberOf = (id: string) =>
    data.summaries.findIndex((summary) => summary.id === id) + 1
  const hrefFor = (id: string) =>
    `/assignments/${slug}/problems/${numberOf(id)}`
  const exam = assignment.exam
  const sitting = exam?.sitting.status
  const examMode = sitting === "in_progress"

  return (
    <Workbench
      listTitle={exam ? "Exam problems" : "Assignment problems"}
      questions={data.summaries}
      notices={[]}
      activeId={data.problem.id}
      detail={data.problem}
      statusOverride={data.status}
      hrefFor={hrefFor}
      onNavigate={(id) => router.push(hrefFor(id))}
      examMode={examMode}
      banner={
        <div className="flex flex-none flex-wrap items-center gap-x-3 bg-ink px-4 py-2 text-caption text-canvas">
          <span className="font-semibold">{assignment.title}</span>
          {examMode && "Only submissions made during your exam count."}
          {exam &&
            sitting === "finished" &&
            "Your exam is over: new submissions here don't count."}
          <Link
            href={`/assignments/${slug}`}
            className="ml-auto font-semibold underline underline-offset-2"
          >
            {exam ? "Exam page" : "Assignment page"}
          </Link>
        </div>
      }
    >
      <ProblemView question={data.problem} />
    </Workbench>
  )
}
