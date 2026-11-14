"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { Loading } from "@/features/admin/components/shell"
import type { classPeople } from "@/features/classes/server"
import { GroupPeople } from "@/features/orgs/components/groups"
import { useGroups } from "@/features/orgs/components/manage-shared"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { orgPages } from "@/lib/paths"

/*
 * A class: one group someone teaches, with everything about it in tabs. Teachers see
 * and act on all of it; students see their side of the same tabs.
 */
import { Overview } from "./class-parts"

export function TeacherPeople({
  slug,
  groupId,
  teachers,
}: {
  slug: string
  groupId: string
  teachers: Overview["teachers"]
}) {
  const router = useRouter()
  const { data, error } = useGroups(slug)
  if (!data) return <Loading error={error} />
  return (
    <div className="grid gap-4">
      <Teachers teachers={teachers} />
      <GroupPeople
        inline
        slug={slug}
        groupId={groupId}
        groups={data.groups}
        levels={data.levels}
        onClose={() => {}}
        onOpen={(id) => router.push(orgPages(slug).cls(id, "people"))}
      />
    </div>
  )
}

export function Teachers({ teachers }: { teachers: Overview["teachers"] }) {
  return (
    <section className="grid gap-1.5">
      <h2 className="text-title-sm text-ink">Teachers</h2>
      {teachers.length === 0 ? (
        <p className="text-body-sm text-body">
          Nobody has a teaching role for this class yet.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {teachers.map((t) => (
            <li
              key={t.name}
              className="rounded-md border border-hairline bg-card px-3 py-1.5 text-body-sm text-ink"
            >
              {t.name}
              <span className="ms-1.5 text-caption text-body">
                {t.roles.join(", ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function StudentPeople({
  slug,
  groupId,
}: {
  slug: string
  groupId: string
}) {
  const { data, error } = useQuery({
    queryKey: ["org", slug, "class", groupId, "people"],
    queryFn: () =>
      api<ApiResult<typeof classPeople>>(
        `/orgs/${slug}/classes/${groupId}/people`
      ),
  })
  if (!data) return <Loading error={error} />
  return (
    <div className="grid gap-4">
      <Teachers teachers={data.teachers} />
      <section className="grid gap-1.5">
        <h2 className="text-title-sm text-ink">
          Classmates ({data.students.length})
        </h2>
        <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
          {data.students.map((s, i) => (
            <li
              key={s.handle ?? i}
              className="rounded-md border border-hairline bg-card px-3 py-1.5 text-body-sm text-ink"
            >
              {s.handle ? (
                <Link href={`/u/${s.handle}`} className="hover:underline">
                  {s.name}
                </Link>
              ) : (
                s.name
              )}
              {s.me && (
                <span className="ms-1.5 text-caption text-body">you</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
