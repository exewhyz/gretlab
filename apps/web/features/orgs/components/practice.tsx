"use client"

import { useQuery } from "@tanstack/react-query"
import { useRouter } from "next/navigation"

import { Loading } from "@/features/admin/components/shell"
import { ProblemView } from "@/features/lab/components/problem-view"
import { Workbench } from "@/features/lab/components/workbench"
import type { ProblemDetail, ProblemSummary } from "@/features/lab/types"
import { api } from "@/lib/api/client"

/** An organization's problems, solved by its members away from the public pages. */
export function OrgPracticeWorkbench({
  slug,
  problem,
}: {
  slug: string
  problem: string
}) {
  const router = useRouter()
  const { data, error } = useQuery({
    queryKey: ["org", slug, "practice", problem],
    queryFn: () =>
      api<{ org: string; summaries: ProblemSummary[]; problem: ProblemDetail }>(
        `/orgs/${slug}/practice/${problem}`
      ),
  })
  if (!data) {
    return (
      <div className="p-6">
        <Loading error={error} />
      </div>
    )
  }
  const hrefFor = (id: string) => `/orgs/${slug}/practice/${id}`
  return (
    <Workbench
      listTitle={`${data.org} problems`}
      questions={data.summaries}
      notices={[]}
      activeId={data.problem.id}
      detail={data.problem}
      hrefFor={hrefFor}
      onNavigate={(id) => router.push(hrefFor(id))}
    >
      <ProblemView question={data.problem} />
    </Workbench>
  )
}
