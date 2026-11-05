"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { ReactNode } from "react"

import { useViewer } from "@/features/account/use-viewer"
import { Loading } from "@/features/admin/components/shell"
import { ProblemView } from "@/features/lab/components/problem-view"
import { Workbench } from "@/features/lab/components/workbench"
import type {
  ProblemDetail,
  ProblemSummary,
  QuestionStatus,
} from "@/features/lab/types"
import { api } from "@/lib/api/client"

import { Countdown } from "./countdown"

interface ContestProblem {
  contest: {
    title: string
    phase: "upcoming" | "live" | "ended"
    slug: string
    endsAt: string
  }
  summaries: ProblemSummary[]
  problem: ProblemDetail
  published: boolean
  status: Record<string, QuestionStatus>
  registered: boolean
}

export function ContestWorkbench({
  slug,
  label,
}: {
  slug: string
  label: string
}) {
  const router = useRouter()
  const { data: viewer } = useViewer()
  const { data, error, refetch } = useQuery({
    queryKey: ["contest-problem", slug, label],
    queryFn: () => api<ContestProblem>(`/contests/${slug}/problems/${label}`),
  })
  if (!data) {
    return (
      <div className="p-6">
        <Loading error={error} />
      </div>
    )
  }

  const { contest, registered, published } = data
  const labelOf = (id: string) =>
    data.summaries.find((summary) => summary.id === id)?.label ?? label
  const hrefFor = (id: string) => `/contests/${slug}/problems/${labelOf(id)}`
  const staff =
    viewer?.user?.role === "teacher" || viewer?.user?.role === "admin"

  const live = contest.phase === "live"
  const counts = live && registered
  // Staff can always try a problem out, and so can anyone once it's public practice.
  const canPractice = Boolean(viewer?.user) && (staff || (!live && published))
  const contestPage = (
    <Link
      href={`/contests/${slug}`}
      className="font-semibold underline underline-offset-2"
    >
      contest page
    </Link>
  )
  let blockedReason: ReactNode
  if (!counts && !canPractice) {
    if (!viewer?.user) {
      blockedReason = <>Sign in and register on the {contestPage} to submit.</>
    } else if (live) {
      blockedReason = <>Register on the {contestPage} to run and submit code.</>
    } else {
      blockedReason = (
        <>This contest has ended, so this problem can&apos;t be run.</>
      )
    }
  }

  return (
    <Workbench
      listTitle="Contest problems"
      questions={data.summaries}
      notices={[]}
      activeId={data.problem.id}
      detail={data.problem}
      contestSlug={counts ? slug : undefined}
      blockedReason={blockedReason}
      statusOverride={data.status}
      hrefFor={hrefFor}
      onNavigate={(id) => router.push(hrefFor(id))}
      banner={
        <div className="flex flex-none flex-wrap items-center gap-x-3 bg-ink px-4 py-2 text-caption text-canvas">
          <span className="font-semibold">{contest.title}</span>
          {counts && "Your submissions here count toward the contest."}
          {!counts &&
            canPractice &&
            (live
              ? "You aren't registered, so these runs don't count."
              : "The contest has ended, so these runs don't count.")}
          {!counts && !canPractice && "Read only."}
          {live && (
            <span>
              Ends in{" "}
              <Countdown to={contest.endsAt} onFinish={() => void refetch()} />
            </span>
          )}
          <Link
            href={`/contests/${slug}`}
            className="ml-auto font-semibold underline underline-offset-2"
          >
            Contest page
          </Link>
        </div>
      }
    >
      <ProblemView question={data.problem} />
    </Workbench>
  )
}
