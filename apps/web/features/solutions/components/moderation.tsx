"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Tabs, TabsList, TabsTrigger } from "@workspace/ui/components/tabs"

import { Loading, PageTitle, Table } from "@/features/admin/components/shell"
import type { moderationList } from "@/features/solutions/server"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { formatDate } from "@/lib/format"

type Rows = ApiResult<typeof moderationList>
type Filter = "reported" | "hidden" | "recent"

/** Dashboard › Solution posts: reported posts first; hide or show them again (logged). */
export function SolutionModeration() {
  const client = useQueryClient()
  const [filter, setFilter] = useState<Filter>("reported")
  const rows = useQuery({
    queryKey: ["admin", "solutions", filter],
    queryFn: () => api<Rows>(`/admin/solutions?filter=${filter}`),
  })
  const toggle = useMutation({
    mutationFn: (input: { id: string; hidden: boolean }) =>
      api("/admin/solutions", { body: { kind: "post", ...input } }),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["admin", "solutions"] }),
  })
  return (
    <div className="grid gap-4" data-testid="solution-moderation">
      <PageTitle>Solution posts</PageTitle>
      <p className="max-w-3xl text-body-sm text-body">
        Students share their accepted code on library problems. Readers report
        posts that break the rules; hide them here. Hidden posts stay visible to
        their author and to moderators, and every change is logged.
      </p>
      <Tabs value={filter} onValueChange={(v) => setFilter(v as Filter)}>
        <TabsList variant="line">
          <TabsTrigger value="reported">Reported</TabsTrigger>
          <TabsTrigger value="hidden">Hidden</TabsTrigger>
          <TabsTrigger value="recent">Recent</TabsTrigger>
        </TabsList>
      </Tabs>
      {!rows.data ? (
        <Loading error={rows.error} />
      ) : rows.data.length === 0 ? (
        <p className="text-body-sm text-body">Nothing here.</p>
      ) : (
        <Table
          headers={[
            "Post",
            "Problem",
            "Author",
            "Reports",
            "Votes",
            "Posted",
            "",
          ]}
        >
          {rows.data.map((r) => (
            <tr key={r.id}>
              <td data-wrap>
                {r.title}
                {r.hidden && (
                  <span className="ml-2 text-caption text-destructive">
                    Hidden
                  </span>
                )}
              </td>
              <td>
                <Link
                  className="hover:underline"
                  href={`/problems/${r.problemSlug}?tab=solutions&post=${r.id}`}
                >
                  {r.problem}
                </Link>
              </td>
              <td>{r.author ?? r.email}</td>
              <td className="tabular-nums">{r.reports}</td>
              <td className="tabular-nums">{r.votes}</td>
              <td>{formatDate(r.createdAt)}</td>
              <td>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate({ id: r.id, hidden: !r.hidden })}
                >
                  {r.hidden ? "Show again" : "Hide"}
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  )
}
