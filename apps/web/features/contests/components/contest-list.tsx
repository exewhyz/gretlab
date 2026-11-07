"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"

import { cn } from "@workspace/ui/lib/utils"

import { PageHeader } from "@/components/page-header"
import { Card, Loading } from "@/features/admin/components/shell"
import { useContentScope } from "@/features/account/scope"
import { ScopeNote } from "@/features/account/scope-switcher"
import { api } from "@/lib/api/client"
import { formatDateTime } from "@/lib/format"

import { Countdown } from "./countdown"

type Phase = "upcoming" | "live" | "ended"

interface ContestRow {
  org: { name: string; slug: string | null } | null
  id: string
  slug: string
  title: string
  startsAt: string
  endsAt: string
  scoring: string
  published: boolean
  phase: Phase
  participants: number
}

const SECTIONS: [Phase, string][] = [
  ["live", "Live now"],
  ["upcoming", "Upcoming"],
  ["ended", "Past"],
]

export function PhaseBadge({
  phase,
  published = true,
}: {
  phase: Phase
  published?: boolean
}) {
  return (
    <span
      className={cn(
        "rounded-full bg-muted px-2.5 py-1 text-caption-upper uppercase",
        published && phase === "live" && "text-success",
        !published && "text-destructive"
      )}
    >
      {published ? phase : "Draft"}
    </span>
  )
}

export function ContestList() {
  const { data: all, error } = useQuery({
    queryKey: ["contests"],
    queryFn: () => api<ContestRow[]>("/contests"),
  })
  const { shows } = useContentScope()
  const data = all?.filter((contest) => shows(contest.org?.slug))
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <main className="mx-auto grid max-w-5xl gap-3 p-4">
        <h1 className="mb-1 text-display-lg text-ink">Contests</h1>
        {all && data && <ScopeNote hidden={all.length - data.length} />}
        {!data && <Loading error={error} />}
        {data?.length === 0 && all?.length === 0 && (
          <p className="text-body-sm text-body">
            No contests yet. Teachers can create one in the dashboard, and it
            appears here once published.
          </p>
        )}
        {SECTIONS.map(([phase, heading]) => {
          const rows = data?.filter((contest) => contest.phase === phase) ?? []
          if (!rows.length) return null
          return (
            <section key={phase} className="grid gap-2">
              <h2 className="mt-2 text-title-sm text-ink">{heading}</h2>
              {rows.map((contest) => (
                <Link key={contest.id} href={`/contests/${contest.slug}`}>
                  <Card className="hover:border-hairline-strong">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-title-md text-ink">
                        {contest.title}
                        {contest.org && (
                          <span className="ml-2 text-caption text-body">
                            · {contest.org.name}
                          </span>
                        )}
                      </h3>
                      <PhaseBadge
                        phase={contest.phase}
                        published={contest.published}
                      />
                    </div>
                    <div className="mt-1 text-caption">
                      {formatDateTime(contest.startsAt)} ·{" "}
                      {contest.scoring.toUpperCase()} · {contest.participants}{" "}
                      registered
                      {contest.phase === "live" && (
                        <>
                          {" · ends in "}
                          <Countdown to={contest.endsAt} />
                        </>
                      )}
                      {contest.phase === "upcoming" && (
                        <>
                          {" · starts in "}
                          <Countdown to={contest.startsAt} />
                        </>
                      )}
                    </div>
                  </Card>
                </Link>
              ))}
            </section>
          )
        })}
      </main>
    </div>
  )
}
