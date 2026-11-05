"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"

import { useViewer } from "@/features/account/use-viewer"
import { api } from "@/lib/api/client"
import { formatDateTime } from "@/lib/format"

interface Due {
  slug: string
  title: string
  dueAt: string
  phase: "open" | "late"
}

/** "Part of Week 3, due Tue 10 Nov" under a problem's title. */
export function AssignmentChips({ problemSlug }: { problemSlug: string }) {
  const { data: viewer } = useViewer()
  const enabled = Boolean(viewer?.user && viewer.features.assignments)
  const { data } = useQuery({
    queryKey: ["assignment", "for-problem", problemSlug],
    queryFn: () => api<Due[]>(`/problems/${problemSlug}/assignments`),
    enabled,
  })
  if (!enabled || !data?.length) return null
  return (
    <div className="-mt-2 mb-4 flex flex-wrap gap-1.5">
      {data.map((due) => (
        <Link
          key={due.slug}
          href={`/assignments/${due.slug}`}
          data-testid="assignment-chip"
          className="rounded-full border border-primary/40 bg-primary/5 px-2.5 py-0.5 text-xs text-ink hover:border-primary"
        >
          Part of <b>{due.title}</b>
          {due.phase === "open"
            ? `, due ${formatDateTime(due.dueAt)}`
            : ", past due (late work accepted)"}
        </Link>
      ))}
    </div>
  )
}
