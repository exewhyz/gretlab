"use client"

import Link from "next/link"

import {
  ExamGuard,
  useProblemAssignments,
} from "@/features/exams/components/exam"
import { formatDateTime } from "@/lib/format"

/** "Part of Week 3, due Tue 10 Nov" under a problem's title; during an exam, its clock. */
export function AssignmentChips({ problemSlug }: { problemSlug: string }) {
  const { data } = useProblemAssignments(problemSlug)
  if (!data?.length) return null
  const sitting = data.find((a) => a.exam?.sitting.status === "in_progress")
  return (
    <div className="-mt-2 mb-4 flex flex-wrap gap-1.5">
      {sitting?.exam?.sitting.endsAt && (
        <ExamGuard
          slug={sitting.slug}
          title={sitting.title}
          fullscreen={sitting.exam.fullscreen}
          endsAt={sitting.exam.sitting.endsAt}
        />
      )}
      {data.map((due) => (
        <Link
          key={due.slug}
          href={`/assignments/${due.slug}`}
          data-testid="assignment-chip"
          className="rounded-full border border-primary/40 bg-primary/5 px-2.5 py-0.5 text-xs text-ink hover:border-primary"
        >
          Part of <b>{due.title}</b>
          {due.exam
            ? due.exam.sitting.status === "in_progress"
              ? ", the exam you're taking"
              : due.exam.sitting.status === "finished"
                ? ", an exam you've taken"
                : ", an exam: start it from its page"
            : due.phase === "open"
              ? `, due ${formatDateTime(due.dueAt)}`
              : ", past due (late work accepted)"}
        </Link>
      ))}
    </div>
  )
}
