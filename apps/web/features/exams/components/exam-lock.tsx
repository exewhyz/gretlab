"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { createContext, useContext, useEffect, type ReactNode } from "react"

import { useViewer } from "@/features/account/use-viewer"
import { Brand } from "@/features/lab/components/brand"
import { api } from "@/lib/api/client"

import { ExamGuard, formatLeft, useRefreshExam, useTimeLeft } from "./exam"

export interface ActiveExam {
  slug: string
  title: string
  fullscreen: boolean
  endsAt: string
  now: string
  problems: number
}

const ExamLockContext = createContext<ActiveExam | null>(null)

/** The exam the signed-in student is sitting, or null. */
export const useExamLock = () => useContext(ExamLockContext)

/** Where a student sitting an exam may be: its page and its problems. */
export const insideExam = (pathname: string, slug: string) =>
  pathname === `/assignments/${slug}` ||
  pathname.startsWith(`/assignments/${slug}/problems/`)

/**
 * While a student is sitting an exam, the whole site locks to it: any other page sends
 * them back to the exam, the header shrinks to the exam's clock, ads go, and leaving the
 * tab, fullscreen or pasting is noted on every page. The server enforces the same limits
 * (features/exams/server.ts); this is what the student sees.
 */
export function ExamLockProvider({ children }: { children: ReactNode }) {
  const { data: viewer } = useViewer()
  const { data } = useQuery({
    queryKey: ["exam", "active"],
    queryFn: () =>
      api<{ exam: ActiveExam | null }>("/me/exam").then((r) => r.exam),
    enabled: Boolean(viewer?.user),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
  const active = viewer?.user && data?.slug ? data : null
  const pathname = usePathname()
  const router = useRouter()
  const outside = active !== null && !insideExam(pathname, active.slug)

  useEffect(() => {
    if (active && outside) router.replace(`/assignments/${active.slug}`)
  }, [active, outside, router])

  return (
    <ExamLockContext.Provider value={active}>
      {outside ? (
        <div className="grid min-h-dvh place-items-center p-4 text-body-sm text-body">
          Taking you back to your exam…
        </div>
      ) : (
        children
      )}
      {active && <ExamGuard slug={active.slug} fullscreen={active.fullscreen} />}
    </ExamLockContext.Provider>
  )
}

/** The header during an exam: the exam, its clock, and nothing that leads elsewhere. */
export function ExamHeader({ exam }: { exam: ActiveExam }) {
  const refresh = useRefreshExam()
  const left = useTimeLeft(exam.endsAt, refresh, exam.now)
  const low = left < 5 * 60_000
  return (
    <header
      data-testid="exam-header"
      className="sticky top-0 z-30 flex h-14 flex-none items-center gap-3 border-b border-hairline bg-canvas px-4"
    >
      <Brand title="Exam" />
      <Link
        href={`/assignments/${exam.slug}`}
        className="min-w-0 truncate text-body-sm font-medium text-ink hover:underline"
      >
        {exam.title}
      </Link>
      <span className="flex-1" />
      <span
        data-testid="exam-timer"
        role="timer"
        aria-label="Time left"
        className={
          "rounded-full border px-3 py-1 text-body-sm font-medium tabular-nums " +
          (low
            ? "border-destructive bg-destructive text-white"
            : "border-hairline bg-card text-ink")
        }
      >
        {formatLeft(left)} left
      </span>
    </header>
  )
}
