"use client"

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
import type {
  collegeUniversityExams,
  internalSheet,
} from "@/features/university/exams"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { orgPages } from "@/lib/paths"

import { ExamState } from "./exams"

type Exams = ApiResult<typeof collegeUniversityExams>
type Sheet = ApiResult<typeof internalSheet>

/** On a college's Manage › University: the university exams its classes sit. */
export function CollegeUniversityExams({ slug }: { slug: string }) {
  const { data } = useQuery({
    queryKey: ["org", slug, "university", "exams"],
    queryFn: () => api<Exams>(`/orgs/${slug}/university/exams`),
    throwOnError: false,
    retry: false,
  })
  if (!data || data.exams.length === 0) return null
  return (
    <Card>
      <h2 className="text-title-sm text-ink">University exams</h2>
      <p className="mb-3 max-w-[65ch] text-body-sm text-body">
        Enter internal marks for your students until the university closes them.
        Results show on students&apos; report cards once the university
        publishes them.
      </p>
      <Table headers={["Exam", "Program", "Semester", "State"]}>
        {data.exams.map((e) => (
          <tr key={e.id} data-testid="college-university-exam">
            <td>
              <Link
                className="font-medium text-ink underline-offset-2 hover:underline"
                href={orgPages(slug).manage(`/university/exams/${e.id}`)}
              >
                {e.name}
              </Link>
            </td>
            <td>{e.program}</td>
            <td className="tabular-nums">{e.semester}</td>
            <td>
              <ExamState closed={e.internalClosed} published={e.published} />
            </td>
          </tr>
        ))}
      </Table>
    </Card>
  )
}

/** A college's internal marks for one university exam, a course at a time. */
export function InternalMarks({ slug, id }: { slug: string; id: string }) {
  const client = useQueryClient()
  const key = ["org", slug, "university", "exams", id]
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<Sheet>(`/orgs/${slug}/university/exams/${id}`),
  })
  const [courseId, setCourseId] = useState("")
  const [edits, setEdits] = useState<Record<string, string>>({})
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/university/exams/${id}`, {
        method: "PUT",
        body: {
          subjectId: course!.subjectId,
          marks: Object.entries(edits).map(([studentId, v]) => ({
            studentId,
            internal: v.trim() === "" ? null : Number(v),
          })),
        },
      }),
    onSuccess: () => {
      setEdits({})
      void client.invalidateQueries({ queryKey: key })
    },
    meta: { success: "Internal marks saved.", quiet: true },
  })
  if (!data) return <Loading error={error} />
  const course =
    data.courses.find((c) => c.subjectId === courseId) ?? data.courses[0]
  const locked = data.exam.internalClosed || data.exam.published
  return (
    <div className="grid min-w-0 gap-4 *:min-w-0">
      <PageTitle>{data.exam.name}: internal marks</PageTitle>
      <div className="flex flex-wrap items-center gap-2 text-body-sm text-body">
        <span>Semester {data.exam.semester}</span>
        <ExamState
          closed={data.exam.internalClosed}
          published={data.exam.published}
        />
      </div>
      {locked && (
        <p className="text-body-sm text-body">
          The university has closed internal marks for this exam; they
          can&apos;t be changed here.
        </p>
      )}
      {data.courses.length === 0 ? (
        <p className="text-body-sm text-body">
          None of this exam&apos;s courses has internal marks.
        </p>
      ) : (
        <>
          <SelectInput
            aria-label="Course"
            className="w-full sm:w-96"
            value={course?.subjectId ?? ""}
            onChange={(e) => {
              setCourseId(e.target.value)
              setEdits({})
            }}
          >
            {data.courses.map((c) => (
              <option key={c.subjectId} value={c.subjectId}>
                {c.code ? `${c.code} · ` : ""}
                {c.name} (out of {c.internalMax})
              </option>
            ))}
          </SelectInput>
          {data.students.length === 0 ? (
            <p className="text-body-sm text-body">
              None of your students sits this exam yet: they need an approved
              registration and a class on this semester.
            </p>
          ) : (
            <Table
              headers={[
                "Registration",
                "Student",
                "Class",
                `Internal (out of ${course?.internalMax})`,
              ]}
            >
              {data.students.map((s) => {
                const saved = course ? s.internal[course.subjectId] : null
                const value =
                  edits[s.studentId] ?? (saved == null ? "" : String(saved))
                return (
                  <tr key={s.studentId} data-testid="internal-student">
                    <td className="font-mono text-ink">{s.regNo ?? "—"}</td>
                    <td className="text-ink">{s.name}</td>
                    <td>{s.className}</td>
                    <td>
                      <TextInput
                        type="number"
                        min={0}
                        step="0.5"
                        className="w-24 tabular-nums"
                        aria-label={`Internal marks for ${s.name}`}
                        disabled={locked}
                        value={value}
                        onChange={(e) =>
                          setEdits({ ...edits, [s.studentId]: e.target.value })
                        }
                      />
                    </td>
                  </tr>
                )
              })}
            </Table>
          )}
          {!locked && (
            <div className="flex flex-wrap items-center gap-3">
              <Button
                disabled={Object.keys(edits).length === 0 || save.isPending}
                onClick={() => save.mutate()}
              >
                Save {course?.name} marks
              </Button>
              {save.error && (
                <FormMessage
                  message={{ text: save.error.message, kind: "err" }}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
