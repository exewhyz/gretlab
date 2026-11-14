"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"

import { buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { PhaseBadge } from "@/features/assignments/components/assignments"
import { api } from "@/lib/api/client"
import { formatDateTime } from "@/lib/format"
import { useOwner } from "@/features/admin/owner"

import { Card, Loading, PageTitle, Table } from "./shell"
import type { ApiResult } from "@/lib/api/types"
import type { orgAssignments } from "@/features/orgs/content"

export type AssignmentRow = ApiResult<typeof orgAssignments>[number]

export function AdminAssignments() {
  const owner = useOwner()
  const { data, error } = useQuery({
    queryKey: owner.key("assignments"),
    queryFn: () => api<AssignmentRow[]>(owner.api("/assignments")),
  })
  if (!data) return <Loading error={error} />

  return (
    <>
      <PageTitle
        action={
          owner.can("assignments.create", "platform.work.create") && (
            <Link
              href={owner.page("/assignments/new")}
              className={cn(buttonVariants({ size: "sm" }))}
            >
              New assignment
            </Link>
          )
        }
      >
        Assignments
      </PageTitle>
      {data.length === 0 ? (
        <Card>
          No assignments yet. An assignment is a set of problems with a due
          date; marks are worked out from submissions and collected in a
          gradebook you can download.
        </Card>
      ) : (
        <Table headers={["Title", "Status", "Due", "Problems", "Points", ""]}>
          {data.map((a) => (
            <tr key={a.id}>
              <td>
                <Link
                  href={owner.page(
                    a.canEdit
                      ? `/assignments/${a.id}`
                      : `/assignments/${a.id}/grades`
                  )}
                  className="font-medium text-ink underline-offset-2 hover:underline"
                >
                  {a.title}
                </Link>
                {!a.published && <span className="ml-2 text-xs">Draft</span>}
              </td>
              <td>
                <PhaseBadge phase={a.phase} />
              </td>
              <td>{formatDateTime(a.dueAt)}</td>
              <td className="tabular-nums">{a.problemCount}</td>
              <td className="tabular-nums">{a.totalPoints}</td>
              <td className="text-right">
                <Link
                  href={owner.page(`/assignments/${a.id}/grades`)}
                  className="underline underline-offset-2"
                >
                  Gradebook
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </>
  )
}
