"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { SelectInput } from "@/components/form"
import { api } from "@/lib/api/client"

import type { StaffProblemList } from "./problems"
import { Loading, PageTitle, Table } from "./shell"

interface Day {
  day: string
  scheduled: { slug: string; title: string } | null
  automatic: { slug: string; title: string } | null
}

export function AdminDaily() {
  const queryClient = useQueryClient()
  const { data, error } = useQuery({
    queryKey: ["admin", "daily"],
    queryFn: () => api<Day[]>("/admin/daily"),
  })
  const problems = useQuery({
    queryKey: ["admin", "problems"],
    queryFn: () => api<StaffProblemList>("/admin/problems"),
  })
  const save = useMutation({
    mutationFn: (body: { day: string; problemSlug: string | null }) =>
      api("/admin/daily", { method: "PUT", body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin", "daily"] })
      void queryClient.invalidateQueries({ queryKey: ["daily"] })
    },
  })
  if (!data || !problems.data)
    return <Loading error={error ?? problems.error} />
  const published = problems.data.problems.filter(
    (problem) => problem.published
  )
  return (
    <>
      <PageTitle>Daily challenge</PageTitle>
      <p className="mb-3 text-body-sm text-body">
        Choose a problem for any day. Days left on automatic get a different
        published problem each day. Days follow the timezone in Settings.
      </p>
      {save.error && (
        <p role="alert" className="mb-2 text-body-sm text-destructive">
          {save.error.message}
        </p>
      )}
      <Table headers={["Day", "Problem"]}>
        {data.map((row) => (
          <tr key={row.day}>
            <td className="w-36 whitespace-nowrap tabular-nums">{row.day}</td>
            <td>
              <SelectInput
                aria-label={`Problem for ${row.day}`}
                className="max-w-md py-1"
                value={row.scheduled?.slug ?? ""}
                onChange={(event) =>
                  save.mutate({
                    day: row.day,
                    problemSlug: event.target.value || null,
                  })
                }
              >
                <option value="">
                  Automatic{row.automatic ? `: ${row.automatic.title}` : ""}
                </option>
                {published.map((problem) => (
                  <option key={problem.slug} value={problem.slug}>
                    {problem.title}
                  </option>
                ))}
              </SelectInput>
            </td>
          </tr>
        ))}
      </Table>
    </>
  )
}
