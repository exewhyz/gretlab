"use client"

import { XIcon } from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"

import { FormMessage, SelectInput, TextInput } from "@/components/form"
import {
  Card,
  Loading,
  PageTitle,
  Table,
} from "@/features/admin/components/shell"
import type { universitySyllabus } from "@/features/university/syllabus"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { orgPages } from "@/lib/paths"

type Data = ApiResult<typeof universitySyllabus>
type Row = {
  subjectId: string
  internalMax: number
  externalMax: number
  passExternal: number
  passTotal: number
}

const MARKS: [keyof Omit<Row, "subjectId">, string][] = [
  ["internalMax", "Internal"],
  ["externalMax", "External"],
  ["passExternal", "Pass (external)"],
  ["passTotal", "Pass (total)"],
]

/** A university's Manage › Syllabus: each program's semesters, their courses and marks. */
export function UniversitySyllabus({ slug }: { slug: string }) {
  const { data, error } = useQuery({
    queryKey: ["org", slug, "syllabus"],
    queryFn: () => api<Data>(`/orgs/${slug}/syllabus`),
  })
  const [programId, setProgramId] = useState("")
  const [semester, setSemester] = useState(1)
  if (!data) return <Loading error={error} />
  const program =
    data.programs.find((p) => p.id === programId) ?? data.programs[0]
  const used = data.syllabus.filter((r) => r.programId === program?.id)
  const last = Math.max(0, ...used.map((r) => r.semester))
  const semesters = Array.from(
    { length: Math.min(12, Math.max(8, last + 1)) },
    (_, i) => i + 1
  )
  return (
    <div className="grid min-w-0 gap-4 *:min-w-0">
      <PageTitle>Syllabus</PageTitle>
      <p className="max-w-[70ch] text-body-sm text-body">
        Each program&apos;s courses, semester by semester, and how they&apos;re
        marked: internal marks by the college, external by the university.
        Colleges put a class on a semester and it takes these courses, with your
        codes, names and credits.
      </p>
      {data.programs.length === 0 ? (
        <Card>
          <p className="text-body-sm text-body">
            No programs yet. Add them under{" "}
            <Link
              className="text-ink underline underline-offset-2"
              href={orgPages(slug).manage("/groups")}
            >
              Programs
            </Link>
            .
          </p>
        </Card>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <SelectInput
              aria-label="Program"
              className="w-full sm:w-80"
              value={program!.id}
              onChange={(e) => setProgramId(e.target.value)}
            >
              {data.programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.path}
                </option>
              ))}
            </SelectInput>
          </div>
          <div
            role="group"
            aria-label="Semester"
            className="flex flex-wrap gap-1.5"
          >
            {semesters.map((n) => {
              const count = used.filter((r) => r.semester === n).length
              return (
                <Button
                  key={n}
                  size="sm"
                  variant={semester === n ? "secondary" : "outline"}
                  aria-pressed={semester === n}
                  onClick={() => setSemester(n)}
                >
                  Semester {n}
                  {count > 0 && (
                    <span className="ml-1 text-caption">· {count}</span>
                  )}
                </Button>
              )
            })}
          </div>
          <SemesterEditor
            key={`${program!.id}:${semester}`}
            slug={slug}
            data={data}
            programId={program!.id}
            semester={semester}
          />
        </>
      )}
    </div>
  )
}

function SemesterEditor({
  slug,
  data,
  programId,
  semester,
}: {
  slug: string
  data: Data
  programId: string
  semester: number
}) {
  const client = useQueryClient()
  const start: Row[] = data.syllabus
    .filter((r) => r.programId === programId && r.semester === semester)
    .map(
      ({ subjectId, internalMax, externalMax, passExternal, passTotal }) => ({
        subjectId,
        internalMax,
        externalMax,
        passExternal,
        passTotal,
      })
    )
  const [rows, setRows] = useState<Row[]>(start)
  const changed = JSON.stringify(rows) !== JSON.stringify(start)
  const save = useMutation({
    mutationFn: () =>
      api<{ courses: number; classes: number }>(
        `/orgs/${slug}/syllabus/${programId}/${semester}`,
        { method: "PUT", body: { courses: rows } }
      ),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["org", slug, "syllabus"] }),
    meta: { success: "Saved.", quiet: true },
  })
  const course = (id: string) => data.courses.find((c) => c.id === id)
  const free = data.courses.filter(
    (c) => !rows.some((r) => r.subjectId === c.id)
  )
  const set = (i: number, key: keyof Omit<Row, "subjectId">, value: string) =>
    setRows(
      rows.map((r, j) =>
        j === i ? { ...r, [key]: value === "" ? 0 : Number(value) } : r
      )
    )
  const credits = rows.reduce(
    (sum, r) => sum + (course(r.subjectId)?.credits ?? 0),
    0
  )
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-title-sm text-ink">Semester {semester}</h2>
        <span className="text-caption" data-testid="semester-credits">
          {rows.length} {rows.length === 1 ? "course" : "courses"} · {credits}{" "}
          credits
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="mb-3 text-body-sm text-body">
          No courses in this semester yet.
        </p>
      ) : (
        <Table headers={["Course", "Credits", ...MARKS.map(([, l]) => l), ""]}>
          {rows.map((r, i) => {
            const c = course(r.subjectId)
            return (
              <tr key={r.subjectId} data-testid="syllabus-course">
                <td>
                  <span className="text-ink">{c?.name}</span>
                  {c?.code && (
                    <span className="ml-2 font-mono text-caption">
                      {c.code}
                    </span>
                  )}
                </td>
                <td className="tabular-nums">{c?.credits ?? "—"}</td>
                {MARKS.map(([key, label]) => (
                  <td key={key}>
                    <TextInput
                      type="number"
                      min={0}
                      className="w-20 tabular-nums"
                      aria-label={`${label} marks for ${c?.name}`}
                      disabled={!data.can.edit}
                      value={String(r[key])}
                      onChange={(e) => set(i, key, e.target.value)}
                    />
                  </td>
                ))}
                <td className="text-right">
                  {data.can.edit && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Take ${c?.name} out of semester ${semester}`}
                      onClick={() => setRows(rows.filter((_, j) => j !== i))}
                    >
                      <XIcon />
                    </Button>
                  )}
                </td>
              </tr>
            )
          })}
        </Table>
      )}
      {data.can.edit && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {free.length > 0 ? (
            <SelectInput
              aria-label="Add a course"
              className="w-full sm:w-72"
              value=""
              onChange={(e) =>
                e.target.value &&
                setRows([
                  ...rows,
                  {
                    subjectId: e.target.value,
                    internalMax: 30,
                    externalMax: 70,
                    passExternal: 28,
                    passTotal: 40,
                  },
                ])
              }
            >
              <option value="">Add a course…</option>
              {free.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code ? `${c.code} · ` : ""}
                  {c.name}
                  {c.credits === null ? " (no credits yet)" : ""}
                </option>
              ))}
            </SelectInput>
          ) : (
            <span className="text-caption">
              Every course is in this semester. Add courses under{" "}
              <Link
                className="text-ink underline underline-offset-2"
                href={orgPages(slug).manage("/subjects")}
              >
                Subjects
              </Link>
              .
            </span>
          )}
          <Button
            className="sm:ml-auto"
            disabled={!changed || save.isPending}
            onClick={() => save.mutate()}
          >
            Save semester {semester}
          </Button>
        </div>
      )}
      {save.error && (
        <div className="mt-3">
          <FormMessage message={{ text: save.error.message, kind: "err" }} />
        </div>
      )}
      {save.data && !save.error && !changed && (
        <p className="mt-3 text-body-sm text-body" data-testid="syllabus-saved">
          Saved.{" "}
          {save.data.classes > 0
            ? `${save.data.classes} ${save.data.classes === 1 ? "class" : "classes"} in affiliated colleges follow this semester.`
            : "No college's class follows this semester yet."}
        </p>
      )}
    </Card>
  )
}
