"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"

import { ConfirmButton } from "@/components/confirm"
import { FormMessage, SelectInput } from "@/components/form"
import { Card, Table } from "@/features/admin/components/shell"
import { GroupPicker } from "@/features/orgs/components/group-picker"
import type { collegePrograms } from "@/features/university/syllabus"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"

type Data = ApiResult<typeof collegePrograms>

/**
 * A college's classes on the university's syllabus: each follows one program's semester and
 * takes its courses. Shown on Manage › University while the college is affiliated, to people
 * who manage subjects across it.
 */
export function ClassPrograms({ slug }: { slug: string }) {
  const client = useQueryClient()
  const key = ["org", slug, "university", "classes"]
  const { data } = useQuery({
    queryKey: key,
    queryFn: () => api<Data>(`/orgs/${slug}/university/classes`),
    throwOnError: false,
    retry: false,
  })
  const [groupId, setGroupId] = useState("")
  const [programId, setProgramId] = useState("")
  const [semester, setSemester] = useState(0)
  const refresh = () => {
    void client.invalidateQueries({ queryKey: key })
    void client.invalidateQueries({ queryKey: ["org", slug, "subjects"] })
  }
  const follow = useMutation({
    mutationFn: () =>
      api<{ added: number }>(`/orgs/${slug}/university/classes`, {
        body: { groupId, programId, semester },
      }),
    onSuccess: () => {
      setGroupId("")
      refresh()
    },
    meta: { quiet: true },
  })
  const stop = useMutation({
    mutationFn: (id: string) =>
      api(`/orgs/${slug}/university/classes/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
    meta: { success: "Done." },
  })
  if (!data?.university) return null
  const program = data.programs.find((p) => p.id === programId)
  return (
    <Card>
      <h2 className="text-title-sm text-ink">
        Classes on the university&apos;s syllabus
      </h2>
      <p className="mb-3 max-w-[65ch] text-body-sm text-body">
        Put a class on a program&apos;s semester and it takes that
        semester&apos;s courses, with the university&apos;s codes, names and
        credits. You still choose who teaches each, under Subjects.
      </p>
      {data.classes.length > 0 && (
        <div className="mb-4">
          <Table headers={["Class", "Program", "Semester", ""]}>
            {data.classes.map((c) => (
              <tr key={c.id} data-testid="class-program">
                <td className="text-ink">{c.group}</td>
                <td>{c.program}</td>
                <td className="tabular-nums">{c.semester}</td>
                <td className="text-right">
                  <ConfirmButton
                    size="sm"
                    variant="ghost"
                    aria-label={`Stop ${c.group} following the university's syllabus`}
                    title={`Stop ${c.group} following the university's syllabus?`}
                    description="Its courses stay on the class; take any off under Subjects."
                    confirmLabel="Stop following"
                    onConfirm={() => stop.mutate(c.id)}
                  >
                    Stop
                  </ConfirmButton>
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}
      {data.programs.length === 0 ? (
        <p className="text-body-sm text-body">
          The university hasn&apos;t set any program&apos;s courses yet.
        </p>
      ) : (
        <form
          className="grid gap-3 sm:grid-cols-[1fr_1fr_10rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault()
            follow.mutate()
          }}
        >
          <GroupPicker
            label="Class"
            groups={data.groups}
            levels={data.levels}
            value={groupId}
            onChange={setGroupId}
            placeholder="Choose a class"
          />
          <SelectInput
            aria-label="Program"
            value={programId}
            onChange={(e) => {
              setProgramId(e.target.value)
              setSemester(0)
            }}
          >
            <option value="">Program…</option>
            {data.programs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.path}
              </option>
            ))}
          </SelectInput>
          <SelectInput
            aria-label="Semester"
            value={String(semester)}
            disabled={!program}
            onChange={(e) => setSemester(Number(e.target.value))}
          >
            <option value="0">Semester…</option>
            {program?.semesters.map((s) => (
              <option key={s.semester} value={s.semester}>
                Semester {s.semester} ({s.courses}{" "}
                {s.courses === 1 ? "course" : "courses"})
              </option>
            ))}
          </SelectInput>
          <Button
            type="submit"
            disabled={!groupId || !programId || !semester || follow.isPending}
          >
            Follow
          </Button>
          {follow.error && (
            <div className="sm:col-span-4">
              <FormMessage
                message={{ text: follow.error.message, kind: "err" }}
              />
            </div>
          )}
          {follow.data && (
            <p
              className="text-body-sm text-body sm:col-span-4"
              data-testid="follow-result"
            >
              The class follows it: {follow.data.added} new{" "}
              {follow.data.added === 1 ? "course" : "courses"} on the class.
            </p>
          )}
        </form>
      )}
    </Card>
  )
}
