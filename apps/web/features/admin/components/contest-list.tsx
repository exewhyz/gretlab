"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"

import { buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { useOwner } from "@/features/admin/owner"
import { PhaseBadge } from "@/features/contests/components/contest-list"
import { api } from "@/lib/api/client"
import { formatDateTime } from "@/lib/format"

import type { orgContests } from "@/features/orgs/content"
import type { ApiResult } from "@/lib/api/types"
import { Loading, PageTitle, Table } from "./shell"

export type ContestRow = ApiResult<typeof orgContests>[number]

export function AdminContests() {
  const owner = useOwner()
  const { data, error } = useQuery({
    queryKey: owner.key("contests"),
    queryFn: () => api<ContestRow[]>(owner.api("/contests")),
  })
  if (!data) return <Loading error={error} />
  return (
    <>
      <PageTitle
        action={
          owner.can("contests.create", "platform.work.create") && (
            <Link
              href={owner.page("/contests/new")}
              className={cn(buttonVariants({ size: "sm" }))}
            >
              New contest
            </Link>
          )
        }
      >
        Contests
      </PageTitle>
      {data.length === 0 ? (
        <p className="text-body-sm text-body">
          No contests yet. Create one to get started.
        </p>
      ) : (
        <Table
          headers={[
            "Title",
            "Status",
            "Starts",
            "Ends",
            "Scoring",
            "Registered",
            "",
          ]}
        >
          {data.map((contest) => (
            <tr key={contest.id}>
              <td>
                <Link
                  href={owner.page(`/contests/${contest.id}`)}
                  className="underline-offset-2 hover:underline"
                >
                  {contest.title}
                </Link>
              </td>
              <td>
                <PhaseBadge
                  phase={contest.phase}
                  published={contest.published}
                />
              </td>
              <td className="whitespace-nowrap">
                {formatDateTime(contest.startsAt)}
              </td>
              <td className="whitespace-nowrap">
                {formatDateTime(contest.endsAt)}
              </td>
              <td className="uppercase">{contest.scoring}</td>
              <td className="tabular-nums">{contest.participants}</td>
              <td>
                <Link
                  href={`/contests/${contest.slug}`}
                  className="underline underline-offset-2"
                >
                  View
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </>
  )
}
