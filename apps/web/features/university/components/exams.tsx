"use client"

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

import { ConfirmButton } from "@/components/confirm"
import { Figure, Figures } from "@/components/figures"
import {
  Field,
  FormMessage,
  SelectInput,
  TextArea,
  TextInput,
} from "@/components/form"
import {
  Card,
  Loading,
  PageTitle,
  Pager,
  Table,
} from "@/features/admin/components/shell"
import type {
  importExternalMarks,
  listUniversityExams,
  universityExamSheet,
} from "@/features/university/exams"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { formatDate } from "@/lib/format"
import { orgPages } from "@/lib/paths"
import { useDebounced } from "@/lib/use-debounced"

type List = ApiResult<typeof listUniversityExams>
type Sheet = ApiResult<typeof universityExamSheet>
type Imported = ApiResult<typeof importExternalMarks>

export function ExamState({
  closed,
  published,
}: {
  closed: boolean
  published: boolean
}) {
  return published ? (
    <Badge variant="secondary">Published</Badge>
  ) : closed ? (
    <Badge variant="outline">Internal marks closed</Badge>
  ) : (
    <Badge variant="outline">Internal marks open</Badge>
  )
}

/** A university's Manage › University exams. */
export function UniversityExams({ slug }: { slug: string }) {
  const { data, error } = useQuery({
    queryKey: ["org", slug, "university-exams"],
    queryFn: () => api<List>(`/orgs/${slug}/university-exams`),
  })
  const [creating, setCreating] = useState(false)
  if (!data) return <Loading error={error} />
  return (
    <div className="grid min-w-0 gap-4 *:min-w-0">
      <PageTitle
        action={
          data.can.edit && (
            <Button onClick={() => setCreating(true)}>New exam</Button>
          )
        }
      >
        University exams
      </PageTitle>
      <p className="max-w-[70ch] text-body-sm text-body">
        An exam for a program&apos;s semester reaches every affiliated college
        whose classes follow it. Colleges enter internal marks until you close
        them; you enter the external marks, then publish the results to students
        and their parents.
      </p>
      {data.exams.length === 0 ? (
        <Card>
          <p className="text-body-sm text-body">No exams yet.</p>
        </Card>
      ) : (
        <Table
          headers={[
            "Exam",
            "Program",
            "Semester",
            "Dates",
            "With marks",
            "State",
          ]}
        >
          {data.exams.map((e) => (
            <tr key={e.id} data-testid="university-exam">
              <td>
                <Link
                  className="font-medium text-ink underline-offset-2 hover:underline"
                  href={orgPages(slug).manage(`/university-exams/${e.id}`)}
                >
                  {e.name}
                </Link>
              </td>
              <td>{e.program}</td>
              <td className="tabular-nums">{e.semester}</td>
              <td className="text-caption">
                {e.startsOn ? formatDate(e.startsOn) : "—"}
                {e.endsOn ? ` – ${formatDate(e.endsOn)}` : ""}
              </td>
              <td className="tabular-nums">{e.withMarks}</td>
              <td>
                <ExamState closed={e.internalClosed} published={e.published} />
              </td>
            </tr>
          ))}
        </Table>
      )}
      {creating && (
        <NewExamDialog
          slug={slug}
          data={data}
          onDone={() => setCreating(false)}
        />
      )}
    </div>
  )
}

function NewExamDialog({
  slug,
  data,
  onDone,
}: {
  slug: string
  data: List
  onDone: () => void
}) {
  const client = useQueryClient()
  const [form, setForm] = useState({
    programId: data.programs[0]?.id ?? "",
    semester: "1",
    name: "",
    startsOn: "",
    endsOn: "",
  })
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/university-exams`, {
        body: {
          programId: form.programId,
          semester: Number(form.semester),
          name: form.name,
          startsOn: form.startsOn || null,
          endsOn: form.endsOn || null,
        },
      }),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["org", slug, "university-exams"],
      })
      onDone()
    },
    meta: { success: "Exam set.", quiet: true },
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New university exam</DialogTitle>
          <DialogDescription>
            For one program&apos;s semester, with the courses in its syllabus.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <Field label="Name">
            <TextInput
              value={form.name}
              placeholder="December 2026"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="Program">
            <SelectInput
              value={form.programId}
              onChange={(e) => setForm({ ...form, programId: e.target.value })}
            >
              {data.programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.path}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Semester">
            <SelectInput
              value={form.semester}
              onChange={(e) => setForm({ ...form, semester: e.target.value })}
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  Semester {i + 1}
                </option>
              ))}
            </SelectInput>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts (optional)">
              <TextInput
                type="date"
                value={form.startsOn}
                onChange={(e) => setForm({ ...form, startsOn: e.target.value })}
              />
            </Field>
            <Field label="Ends (optional)">
              <TextInput
                type="date"
                value={form.endsOn}
                onChange={(e) => setForm({ ...form, endsOn: e.target.value })}
              />
            </Field>
          </div>
          {save.error && (
            <FormMessage message={{ text: save.error.message, kind: "err" }} />
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onDone}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!form.name.trim() || !form.programId || save.isPending}
            >
              Set the exam
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type Entry = { external: string; absent: boolean }

/** One university exam: external marks by course, results, closing and publishing. */
export function UniversityExamPage({ slug, id }: { slug: string; id: string }) {
  const client = useQueryClient()
  const [college, setCollege] = useState("")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [courseId, setCourseId] = useState("")
  const [edits, setEdits] = useState<Record<string, Entry>>({})
  const [importing, setImporting] = useState(false)
  const query = useDebounced(q)
  const key = ["org", slug, "university-exam", id]
  const { data, error, isPlaceholderData } = useQuery({
    queryKey: [...key, college, query, page],
    queryFn: () =>
      api<Sheet>(
        `/orgs/${slug}/university-exams/${id}?page=${page}&q=${encodeURIComponent(query)}${college ? `&college=${college}` : ""}`
      ),
    placeholderData: keepPreviousData,
  })
  const refresh = () => client.invalidateQueries({ queryKey: key })
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/university-exams/${id}/marks`, {
        method: "PUT",
        body: {
          subjectId: course!.subjectId,
          marks: Object.entries(edits).map(([studentId, e]) => ({
            studentId,
            absent: e.absent,
            external:
              e.absent || e.external.trim() === "" ? null : Number(e.external),
          })),
        },
      }),
    onSuccess: () => {
      setEdits({})
      void refresh()
    },
    meta: { success: "Marks saved.", quiet: true },
  })
  const close = useMutation({
    mutationFn: (closed: boolean) =>
      api(`/orgs/${slug}/university-exams/${id}/internal-closed`, {
        method: "PUT",
        body: { closed },
      }),
    onSuccess: refresh,
    meta: { success: "Done." },
  })
  const publish = useMutation({
    mutationFn: (body: { publish: boolean; force?: boolean }) =>
      api<{ published: boolean; missing: number; told: number }>(
        `/orgs/${slug}/university-exams/${id}/publish`,
        { body }
      ),
    onSuccess: refresh,
    meta: { quiet: true },
  })
  if (!data) return <Loading error={error} />
  const course =
    data.courses.find((c) => c.subjectId === courseId) ?? data.courses[0]
  const incomplete =
    publish.error && (publish.error as { code?: string }).code === "incomplete"
  const passed = data.students.filter(
    (s) => s.result.complete && s.result.backlogs === 0
  ).length
  const complete = data.students.filter((s) => s.result.complete).length
  return (
    <div className="grid min-w-0 gap-4 *:min-w-0">
      <PageTitle>{data.exam.name}</PageTitle>
      <div className="flex flex-wrap items-center gap-2 text-body-sm text-body">
        <span>
          {data.exam.program} · Semester {data.exam.semester}
        </span>
        <ExamState
          closed={data.exam.internalClosed}
          published={data.exam.published}
        />
      </div>
      <Figures>
        <Figure label="Sitting" value={data.total} />
        <Figure label="With every result (this page)" value={complete} />
        <Figure label="Passed every course (this page)" value={passed} />
      </Figures>
      {data.can.edit && (
        <div className="flex flex-wrap gap-2">
          {!data.exam.published &&
            (data.exam.internalClosed ? (
              <Button variant="outline" onClick={() => close.mutate(false)}>
                Reopen internal marks
              </Button>
            ) : (
              <ConfirmButton
                variant="outline"
                title="Close internal marks?"
                description="Colleges can't change internal marks after this. You can reopen them until the results are published."
                confirmLabel="Close internal marks"
                onConfirm={() => close.mutate(true)}
              >
                Close internal marks
              </ConfirmButton>
            ))}
          <Button variant="outline" onClick={() => setImporting(true)}>
            Import external marks
          </Button>
          {data.exam.published ? (
            <ConfirmButton
              variant="outline"
              title="Take the results back?"
              description="Students and colleges stop seeing them until you publish again."
              confirmLabel="Take back"
              onConfirm={() => publish.mutate({ publish: false })}
            >
              Take back results
            </ConfirmButton>
          ) : (
            <Button
              onClick={() => publish.mutate({ publish: true })}
              disabled={publish.isPending}
            >
              Publish results
            </Button>
          )}
        </div>
      )}
      {publish.error && (
        <div className="flex flex-wrap items-center gap-3">
          <FormMessage message={{ text: publish.error.message, kind: "err" }} />
          {incomplete && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => publish.mutate({ publish: true, force: true })}
            >
              Publish anyway
            </Button>
          )}
        </div>
      )}
      {publish.data?.published && (
        <p className="text-body-sm text-body" data-testid="published-result">
          Published. {publish.data.told} students told.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
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
              {c.name}
            </option>
          ))}
        </SelectInput>
        <SelectInput
          aria-label="College"
          className="w-full sm:w-64"
          value={college}
          onChange={(e) => {
            setCollege(e.target.value)
            setPage(1)
          }}
        >
          <option value="">Every college</option>
          {data.colleges.map((c) => (
            <option key={c.id} value={c.id}>
              {c.code ? `${c.code} · ` : ""}
              {c.name}
            </option>
          ))}
        </SelectInput>
        <div className="w-full sm:w-60">
          <TextInput
            aria-label="Search students"
            placeholder="Name or registration number"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
          />
        </div>
      </div>
      {course && (
        <p className="text-caption">
          {course.name}: internal out of {course.internalMax}, external out of{" "}
          {course.externalMax}; pass with {course.passExternal} in the external
          and {course.passTotal} in all.
        </p>
      )}
      {data.students.length === 0 ? (
        <p className="text-body-sm text-body">
          Nobody sits this exam yet: students need an approved registration and
          a class on this semester.
        </p>
      ) : (
        <div className={isPlaceholderData ? "opacity-60" : undefined}>
          <Table
            headers={[
              "Registration",
              "Student",
              "College",
              "Internal",
              "External",
              "Absent",
              "Grade",
              "SGPA",
            ]}
          >
            {data.students.map((s) => {
              const m = s.courses.find((c) => c.subjectId === course?.subjectId)
              const edit = edits[s.studentId] ?? {
                external: m?.external == null ? "" : String(m.external),
                absent: m?.absent ?? false,
              }
              const set = (e: Entry) => setEdits({ ...edits, [s.studentId]: e })
              return (
                <tr key={s.studentId} data-testid="exam-student">
                  <td className="font-mono text-ink">{s.regNo ?? "—"}</td>
                  <td className="text-ink">{s.name}</td>
                  <td>{s.college}</td>
                  <td className="tabular-nums">
                    {course?.internalMax === 0 ? "—" : (m?.internal ?? "—")}
                  </td>
                  <td>
                    <TextInput
                      type="number"
                      min={0}
                      step="0.5"
                      className="w-20 tabular-nums"
                      aria-label={`External marks for ${s.name}`}
                      disabled={!data.can.edit || edit.absent}
                      value={edit.absent ? "" : edit.external}
                      onChange={(e) =>
                        set({ ...edit, external: e.target.value })
                      }
                    />
                  </td>
                  <td>
                    <Checkbox
                      aria-label={`${s.name} was absent`}
                      disabled={!data.can.edit}
                      checked={edit.absent}
                      onCheckedChange={(checked) =>
                        set({ ...edit, absent: checked === true })
                      }
                    />
                  </td>
                  <td
                    className={
                      m?.points === 0
                        ? "font-medium text-destructive"
                        : "font-medium"
                    }
                  >
                    {m?.grade ?? "—"}
                  </td>
                  <td className="tabular-nums">
                    {s.result.sgpa == null ? "—" : s.result.sgpa.toFixed(2)}
                  </td>
                </tr>
              )
            })}
          </Table>
          <Pager
            page={data.page}
            pages={data.pages}
            total={data.total}
            perPage={data.perPage}
            onPage={setPage}
          />
        </div>
      )}
      {data.can.edit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={Object.keys(edits).length === 0 || save.isPending}
            onClick={() => save.mutate()}
          >
            Save {course?.name} marks
          </Button>
          {data.exam.published && (
            <span className="text-caption">
              Results are published: changes are logged as corrections.
            </span>
          )}
          {save.error && (
            <FormMessage message={{ text: save.error.message, kind: "err" }} />
          )}
        </div>
      )}
      {importing && (
        <ImportDialog
          slug={slug}
          id={id}
          onDone={() => {
            setImporting(false)
            void refresh()
          }}
        />
      )}
    </div>
  )
}

function ImportDialog({
  slug,
  id,
  onDone,
}: {
  slug: string
  id: string
  onDone: () => void
}) {
  const [csv, setCsv] = useState("")
  const run = useMutation({
    mutationFn: () =>
      api<Imported>(`/orgs/${slug}/university-exams/${id}/import`, {
        body: { csv },
      }),
    onSuccess: (r) => {
      if (r.problems.length === 0) onDone()
    },
    meta: { quiet: true },
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import external marks</DialogTitle>
          <DialogDescription>
            One line per student and course: registration number, course code,
            marks (or AB for absent). Nothing is saved unless every line is
            right.
          </DialogDescription>
        </DialogHeader>
        <TextArea
          rows={8}
          aria-label="Marks"
          className="font-mono"
          placeholder={
            "Registration number,Course code,Marks\nFC120260001,DS301,48\nFC120260002,DS301,AB"
          }
          value={csv}
          onChange={(e) => setCsv(e.target.value)}
        />
        {run.error && (
          <FormMessage message={{ text: run.error.message, kind: "err" }} />
        )}
        {run.data && run.data.problems.length > 0 && (
          <ul
            className="max-h-40 overflow-auto text-body-sm text-destructive"
            data-testid="import-problems"
          >
            {run.data.problems.map((p) => (
              <li key={`${p.line}${p.problem}`}>
                Line {p.line}: {p.problem}
              </li>
            ))}
          </ul>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button
            disabled={!csv.trim() || run.isPending}
            onClick={() => run.mutate()}
          >
            Import
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
