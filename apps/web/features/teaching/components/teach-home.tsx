"use client"

import { CaretDownIcon, CaretRightIcon } from "@phosphor-icons/react"
import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useState, type ReactNode } from "react"

import { Button, buttonVariants } from "@workspace/ui/components/button"

import { TextInput } from "@/components/form"
import { useContentScope } from "@/features/account/scope"
import { ScopeNote } from "@/features/account/scope-switcher"
import { Card, Loading } from "@/features/admin/components/shell"
import type { teacherHome } from "@/features/teaching/server"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { formatDateTime } from "@/lib/format"
import { orgPages } from "@/lib/paths"
import { ProgressBar } from "./teaching-parts"

export type Home = ApiResult<typeof teacherHome>

export function TeacherHome() {
  const { data, error } = useQuery({
    queryKey: ["teach"],
    queryFn: () => api<Home>("/teach"),
  })
  const { shows, orgs: mine } = useContentScope()
  if (!data) return <Loading error={error} />
  const orgs = data.orgs.filter((org) => shows(org.slug))
  const manages = (slug: string) =>
    mine.some((o) => o.slug === slug && o.canManage)
  const dueSoon = orgs.flatMap((org) => org.dueSoon.map((a) => ({ ...a, org })))
  const behind = orgs.flatMap((org) =>
    org.groups
      .filter((g) => g.progress.behind.length > 0)
      .map((g) => ({ ...g, org }))
  )

  return (
    <>
      <h1 className="mb-1 text-display-lg text-ink">My classes</h1>
      <p className="mb-5 text-body-sm text-body">
        Every class you teach, in every organization. Open one for its stream,
        classwork, people, grades and log.
      </p>
      <ScopeNote hidden={data.orgs.length - orgs.length} />
      {data.orgs.length === 0 && (
        <p className="text-body-sm text-body">
          You don&apos;t teach any groups yet. An organization gives you a
          teaching role from its Members page.
        </p>
      )}
      {(dueSoon.length > 0 || behind.length > 0) && (
        <section
          data-testid="today"
          className="mb-6 grid gap-3 min-[901px]:grid-cols-2"
        >
          <Card className="grid content-start gap-2">
            <h2 className="text-title-sm text-ink">Due this week</h2>
            {dueSoon.length === 0 && (
              <p className="text-caption text-body">Nothing due.</p>
            )}
            {dueSoon.slice(0, 6).map((a) => (
              <Link
                key={a.id}
                href={orgPages(a.org.slug).manage(
                  `/assignments/${a.id}/grades`
                )}
                className="flex items-baseline justify-between gap-3 text-body-sm hover:underline"
              >
                <span className="truncate text-ink">{a.title}</span>
                <span className="shrink-0 text-caption text-body">
                  {formatDateTime(a.dueAt)}
                </span>
              </Link>
            ))}
          </Card>
          <Card className="grid content-start gap-2">
            <h2 className="text-title-sm text-ink">Behind the syllabus</h2>
            {behind.length === 0 && (
              <p className="text-caption text-body">Every class is on plan.</p>
            )}
            {behind.slice(0, 6).map((g) => (
              <Link
                key={g.id}
                href={orgPages(g.org.slug).cls(g.id, "classes")}
                className="flex items-baseline justify-between gap-3 text-body-sm hover:underline"
              >
                <span className="truncate text-ink">{g.path}</span>
                <span className="shrink-0 text-caption text-primary">
                  {g.progress.behind.length} behind
                </span>
              </Link>
            ))}
          </Card>
        </section>
      )}
      {orgs.map((org) => {
        const base = `/orgs/${org.slug}/manage`
        return (
          <section
            key={org.slug}
            data-testid="teach-org"
            className="mb-8 grid gap-3"
          >
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-title-md text-ink">{org.name}</h2>
                <p className="text-caption text-body">
                  {org.groups.length}{" "}
                  {org.groups.length === 1 ? "class" : "classes"} ·{" "}
                  {org.myClassesThisWeek}{" "}
                  {org.myClassesThisWeek === 1 ? "class" : "classes"} logged by
                  you this week
                </p>
              </div>
              <div className="flex flex-wrap gap-1">
                {manages(org.slug) && (
                  <Link
                    href={orgPages(org.slug).home}
                    className={buttonVariants({
                      variant: "outline",
                      size: "sm",
                    })}
                  >
                    Manage organization
                  </Link>
                )}
                {org.can.assignments && (
                  <Link
                    href={`${base}/assignments`}
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                  >
                    All assignments
                  </Link>
                )}
                {org.can.contests && (
                  <Link
                    href={`${base}/contests`}
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                  >
                    Contests
                  </Link>
                )}
                {org.can.reports && (
                  <Link
                    href={`${base}/reports`}
                    className={buttonVariants({ variant: "ghost", size: "sm" })}
                  >
                    Reports
                  </Link>
                )}
              </div>
            </div>
            {org.groups.length === 0 ? (
              <p className="text-body-sm text-body">
                No classes assigned to you here.
              </p>
            ) : (
              <ClassTree slug={org.slug} groups={org.groups} />
            )}
          </section>
        )
      })}
    </>
  )
}

/** A teacher's classes in one organization, as the group tree: folded, searchable. */
export function ClassTree({
  slug,
  groups,
}: {
  slug: string
  groups: Home["orgs"][number]["groups"]
}) {
  const ids = new Set(groups.map((g) => g.id))
  const roots = groups.filter((g) => !g.parentId || !ids.has(g.parentId))
  const childrenOf = (id: string) => groups.filter((g) => g.parentId === id)
  const [open, setOpen] = useState<Set<string>>(
    () =>
      new Set(
        groups.length <= 15 ? groups.map((g) => g.id) : roots.map((g) => g.id)
      )
  )
  const [query, setQuery] = useState("")
  const q = query.trim().toLowerCase()
  const matches = q
    ? groups.filter((g) => g.path.toLowerCase().includes(q))
    : []

  const row = (g: (typeof groups)[number], depth: number): ReactNode => {
    const kids = childrenOf(g.id)
    const expanded = open.has(g.id)
    return (
      <div key={g.id}>
        <div
          data-testid="class-row"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-hairline px-2 py-2 last:border-0 hover:bg-muted/50"
          style={{ paddingInlineStart: 8 + depth * 22 }}
        >
          {kids.length > 0 && !q ? (
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`${expanded ? "Collapse" : "Expand"} ${g.name}`}
              onClick={() =>
                setOpen((cur) => {
                  const next = new Set(cur)
                  if (expanded) next.delete(g.id)
                  else next.add(g.id)
                  return next
                })
              }
            >
              {expanded ? <CaretDownIcon /> : <CaretRightIcon />}
            </Button>
          ) : (
            <span aria-hidden className="w-6" />
          )}
          <Link
            href={orgPages(slug).cls(g.id)}
            className="min-w-32 text-body-sm text-ink hover:underline"
          >
            {q ? g.path : g.name}
          </Link>
          {g.level && (
            <span className="rounded-full bg-muted px-1.5 py-px text-xs text-body">
              {g.level}
            </span>
          )}
          <span className="text-xs text-body">
            {g.members} {g.members === 1 ? "student" : "students"}
          </span>
          <span className="flex-1" />
          <ProgressBar progress={g.progress} />
          <Link
            href={orgPages(slug).cls(g.id, "classes")}
            className="w-28 text-end text-xs text-body hover:underline"
          >
            {g.classesThisWeek} {g.classesThisWeek === 1 ? "class" : "classes"}{" "}
            this week
          </Link>
        </div>
        {!q && expanded && kids.map((k) => row(k, depth + 1))}
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      {groups.length > 8 && (
        <TextInput
          aria-label={`Find a class`}
          placeholder={`Search ${groups.length} classes`}
          className="max-w-72"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <Card className="p-0">
        {q ? matches.map((g) => row(g, 0)) : roots.map((g) => row(g, 0))}
        {q && matches.length === 0 && (
          <p className="p-3 text-body-sm text-body">No class matches.</p>
        )}
      </Card>
    </div>
  )
}
