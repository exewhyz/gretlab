"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"

import { buttonVariants } from "@workspace/ui/components/button"

import { Loading } from "@/features/admin/components/shell"
import type { classwork } from "@/features/classes/server"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { formatDateTime } from "@/lib/format"

/*
 * A class: one group someone teaches, with everything about it in tabs. Teachers see
 * and act on all of it; students see their side of the same tabs.
 */
import { Overview, ReachChip } from "./class-parts"

export type Work = ApiResult<typeof classwork>

export function useClasswork(slug: string, groupId: string) {
  return useQuery({
    queryKey: ["org", slug, "class", groupId, "classwork"],
    queryFn: () => api<Work>(`/orgs/${slug}/classes/${groupId}/classwork`),
  })
}

export const PHASE_LABEL: Record<string, string> = {
  upcoming: "Opens soon",
  open: "Open",
  late: "Late work allowed",
  closed: "Closed",
  live: "Live now",
  ended: "Ended",
  frozen: "Live (board frozen)",
}

export function Classwork({
  slug,
  groupId,
  teacher,
  can,
}: {
  slug: string
  groupId: string
  teacher: boolean
  can: Overview["can"]
}) {
  const { data, error } = useClasswork(slug, groupId)
  if (!data) return <Loading error={error} />
  const manage = `/orgs/${slug}/manage`
  return (
    <div className="grid gap-6">
      <section className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-title-sm text-ink">Assignments</h2>
          {teacher && can.assignments && (
            <Link
              href={`${manage}/assignments/new?for=${groupId}`}
              className={buttonVariants({ variant: "outline", size: "xs" })}
            >
              New assignment
            </Link>
          )}
        </div>
        {data.assignments.length === 0 && (
          <p className="text-body-sm text-body">
            No assignments for this class yet.
          </p>
        )}
        {data.assignments.map((a) => (
          <div
            key={a.id}
            data-testid="class-assignment"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-hairline bg-card p-3.5"
          >
            <div className="grid min-w-0 flex-1 gap-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/assignments/${a.slug}`}
                  className="text-body-sm text-ink hover:underline"
                >
                  {a.title}
                </Link>
                {!a.published && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-body">
                    Draft
                  </span>
                )}
                <ReachChip reach={a.reach} />
              </div>
              <div className="text-caption text-body">
                {PHASE_LABEL[a.phase] ?? a.phase} · due{" "}
                {formatDateTime(a.dueAt)} · {a.problemCount}{" "}
                {a.problemCount === 1 ? "problem" : "problems"}
                {!teacher && ` · ${a.earned} / ${a.total} points`}
              </div>
            </div>
            {a.canManage && (
              <span className="flex gap-1">
                <Link
                  href={`${manage}/assignments/${a.id}/grades`}
                  className={buttonVariants({ variant: "ghost", size: "xs" })}
                >
                  Grades
                </Link>
                <Link
                  href={`${manage}/assignments/${a.id}`}
                  className={buttonVariants({ variant: "ghost", size: "xs" })}
                >
                  Edit
                </Link>
              </span>
            )}
          </div>
        ))}
      </section>

      <section className="grid gap-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-title-sm text-ink">Contests</h2>
          {teacher && can.contests && (
            <Link
              href={`${manage}/contests/new?for=${groupId}`}
              className={buttonVariants({ variant: "outline", size: "xs" })}
            >
              New contest
            </Link>
          )}
        </div>
        {data.contests.length === 0 && (
          <p className="text-body-sm text-body">
            No contests for this class yet.
          </p>
        )}
        {data.contests.map((c) => (
          <div
            key={c.id}
            data-testid="class-contest"
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-hairline bg-card p-3.5"
          >
            <div className="grid min-w-0 flex-1 gap-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/contests/${c.slug}`}
                  className="text-body-sm text-ink hover:underline"
                >
                  {c.title}
                </Link>
                {!c.published && (
                  <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-body">
                    Draft
                  </span>
                )}
                <ReachChip reach={c.reach} />
              </div>
              <div className="text-caption text-body">
                {PHASE_LABEL[c.phase] ?? c.phase} · {formatDateTime(c.startsAt)}
              </div>
            </div>
            {c.canManage && (
              <Link
                href={`${manage}/contests/${c.id}`}
                className={buttonVariants({ variant: "ghost", size: "xs" })}
              >
                Edit
              </Link>
            )}
          </div>
        ))}
      </section>

      <section className="grid gap-2">
        <h2 className="text-title-sm text-ink">Syllabus</h2>
        {data.topics.length === 0 ? (
          <p className="text-body-sm text-body">
            No syllabus yet.
            {teacher && " Add topics under Syllabus and log."}
          </p>
        ) : (
          <ol className="grid gap-1 rounded-lg border border-hairline bg-card p-3.5 text-body-sm">
            {data.topics.map((t, i) => (
              <li key={t.id} className="flex justify-between gap-3">
                <span className="text-ink">
                  {i + 1}. {t.title}
                </span>
                {t.plannedFor && (
                  <span className="text-caption text-body">{t.plannedFor}</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
