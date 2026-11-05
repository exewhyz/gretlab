"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button, buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { Checkbox } from "@workspace/ui/components/checkbox"

import { ConfirmButton } from "@/components/confirm"
import { Field, FormMessage, TextArea, TextInput } from "@/components/form"
import {
  PhaseBadge,
  STATUS,
  type AssignmentPhase,
  type GradeStatus,
} from "@/features/assignments/components/assignments"
import { assignmentInputSchema, slugify } from "@/features/problems/schemas"
import { api, ApiRequestError } from "@/lib/api/client"
import { formatDateTime } from "@/lib/format"
import { useOwner } from "@/features/admin/owner"
import { AudiencePicker } from "./audience"

import { FieldError, ProblemPicker, toLocalInput } from "./contests"
import type { StaffProblemList } from "./problems"
import { Card, Loading, PageTitle, Table } from "./shell"

interface AssignmentRow {
  id: string
  slug: string
  title: string
  opensAt: string
  dueAt: string
  published: boolean
  phase: AssignmentPhase
  problemCount: number
  totalPoints: number
}

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
          <Link
            href={owner.page("/assignments/new")}
            className={cn(buttonVariants({ size: "sm" }))}
          >
            New assignment
          </Link>
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
                  href={owner.page(`/assignments/${a.id}`)}
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

interface AssignmentForm {
  slug: string
  title: string
  description: string
  opensAt: string
  dueAt: string
  allowLate: boolean
  /** Text while editing, so a field can be cleared without turning into 0. */
  latePenaltyPercent: string
  published: boolean
  problemIds: string[]
  points: Record<string, string>
  audience: string[][]
}

interface StoredAssignment {
  slug: string
  title: string
  description: string
  opensAt: string
  dueAt: string
  allowLate: boolean
  latePenaltyPercent: number
  published: boolean
  audience: string[][]
  problems: { problemId: string; points: number }[]
}

function blankForm(): AssignmentForm {
  const due = new Date(Date.now() + 7 * 24 * 60 * 60_000)
  due.setHours(23, 59, 0, 0)
  return {
    slug: "",
    title: "",
    description: "",
    opensAt: toLocalInput(new Date()),
    dueAt: toLocalInput(due),
    allowLate: false,
    latePenaltyPercent: "0",
    published: false,
    problemIds: [],
    audience: [],
    points: {},
  }
}

export function AssignmentEditorPage({ id }: { id: string | null }) {
  const owner = useOwner()
  const { data, error } = useQuery({
    queryKey: owner.key("assignment", id),
    queryFn: () => api<StoredAssignment>(owner.api(`/assignments/${id}`)),
    enabled: id !== null,
  })
  const problems = useQuery({
    queryKey: owner.key("problems", "picker"),
    queryFn: () =>
      api<StaffProblemList>(`${owner.api("/problems")}?for=picker`),
  })
  if ((id && !data) || !problems.data) {
    return <Loading error={error ?? problems.error} />
  }
  const initial: AssignmentForm = data
    ? {
        ...data,
        opensAt: toLocalInput(data.opensAt),
        dueAt: toLocalInput(data.dueAt),
        latePenaltyPercent: String(data.latePenaltyPercent),
        problemIds: data.problems.map((p) => p.problemId),
        points: Object.fromEntries(
          data.problems.map((p) => [p.problemId, String(p.points)])
        ),
      }
    : blankForm()
  return (
    <AssignmentEditor
      key={id ?? "new"}
      id={id}
      initial={initial}
      // Students reach problems through the practice pages, so drafts can't be assigned.
      problems={problems.data.problems.filter((p) => p.published)}
    />
  )
}

type FieldErrors = Partial<Record<keyof AssignmentForm | "problems", string>>

function AssignmentEditor({
  id,
  initial,
  problems,
}: {
  id: string | null
  initial: AssignmentForm
  problems: StaffProblemList["problems"]
}) {
  const owner = useOwner()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [form, setForm] = useState(initial)
  const [slugTouched, setSlugTouched] = useState(Boolean(id))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [message, setMessage] = useState<{
    text: string
    kind?: "ok" | "err"
  } | null>(null)

  const set = <K extends keyof AssignmentForm>(
    key: K,
    value: AssignmentForm[K]
  ) => {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
    setMessage(null)
  }
  const pointsOf = (problemId: string) => form.points[problemId] ?? "100"
  const totalPoints = form.problemIds.reduce(
    (sum, problemId) => sum + (Number(pointsOf(problemId)) || 0),
    0
  )

  /** Checks with the same rules as the server, to show errors beside their fields. */
  function validated(published: boolean) {
    const parsed = assignmentInputSchema.safeParse({
      title: form.title,
      slug: form.slug,
      description: form.description,
      allowLate: form.allowLate,
      published,
      latePenaltyPercent:
        form.latePenaltyPercent.trim() === ""
          ? NaN
          : Number(form.latePenaltyPercent),
      opensAt: form.opensAt ? new Date(form.opensAt) : undefined,
      dueAt: form.dueAt ? new Date(form.dueAt) : undefined,
      audience: form.audience.filter((c) => c.length > 0),
      problems: form.problemIds.map((problemId) => ({
        problemId,
        points:
          pointsOf(problemId).trim() === "" ? NaN : Number(pointsOf(problemId)),
      })),
    })
    if (parsed.success) {
      setErrors({})
      return parsed.data
    }
    const found: FieldErrors = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof FieldErrors
      found[key] ??= issue.message
    }
    setErrors(found)
    setMessage({ text: "Fix the highlighted fields.", kind: "err" })
    return null
  }

  const save = useMutation({
    mutationFn: (body: NonNullable<ReturnType<typeof validated>>) =>
      id
        ? api<{ id: string }>(owner.api(`/assignments/${id}`), {
            method: "PUT",
            body,
          })
        : api<{ id: string }>(owner.api("/assignments"), { body }),
    onSuccess: (saved, body) => {
      void queryClient.invalidateQueries({ queryKey: ["admin"] })
      void queryClient.invalidateQueries({ queryKey: ["assignments"] })
      void queryClient.invalidateQueries({ queryKey: ["assignment"] })
      setForm((current) => ({ ...current, published: body.published }))
      setMessage({
        text: body.published
          ? "Published. Students can see it under Assignments."
          : "Saved as a draft. Only staff can see it.",
        kind: "ok",
      })
      if (!id) router.push(owner.page(`/assignments/${saved.id}`))
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.code === "conflict") {
        setErrors({ slug: "Another assignment already uses this address." })
      }
      setMessage({ text: error.message, kind: "err" })
    },
  })
  const submit = (published: boolean) => {
    const body = validated(published)
    if (body) save.mutate(body)
  }

  const remove = useMutation({
    mutationFn: () =>
      api(owner.api(`/assignments/${id}`), { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin"] })
      router.push(owner.page("/assignments"))
    },
    onError: (error) => setMessage({ text: error.message, kind: "err" }),
  })

  return (
    <>
      <PageTitle
        action={
          id && (
            <Link
              href={owner.page(`/assignments/${id}/grades`)}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              Gradebook
            </Link>
          )
        }
      >
        {id ? "Edit assignment" : "New assignment"}
      </PageTitle>
      <Card className="grid gap-5">
        <div className="grid gap-3 min-[901px]:grid-cols-2">
          <div className="grid content-start gap-1.5">
            <Field label="Title">
              <TextInput
                value={form.title}
                aria-invalid={Boolean(errors.title)}
                onChange={(event) => {
                  set("title", event.target.value)
                  if (!slugTouched) set("slug", slugify(event.target.value))
                }}
              />
            </Field>
            <FieldError message={errors.title} />
          </div>
          <div className="grid content-start gap-1.5">
            <Field
              label="Address"
              help={`Its page will be /assignments/${form.slug || "your-address"}`}
            >
              <TextInput
                value={form.slug}
                placeholder="week-3-loops"
                aria-invalid={Boolean(errors.slug)}
                onChange={(event) => {
                  setSlugTouched(true)
                  set("slug", event.target.value)
                }}
              />
            </Field>
            <FieldError message={errors.slug} />
          </div>
        </div>

        <Field
          label="Instructions"
          help="Optional. Students see them above the problems."
        >
          <TextArea
            rows={3}
            value={form.description}
            onChange={(event) => set("description", event.target.value)}
          />
        </Field>

        <div className="grid gap-1.5">
          <div className="grid gap-3 min-[901px]:grid-cols-2">
            <div className="grid content-start gap-1.5">
              <Field
                label="Opens"
                help="Submissions from before this don't count."
              >
                <TextInput
                  type="datetime-local"
                  value={form.opensAt}
                  aria-invalid={Boolean(errors.opensAt)}
                  onChange={(event) => set("opensAt", event.target.value)}
                />
              </Field>
              <FieldError message={errors.opensAt} />
            </div>
            <div className="grid content-start gap-1.5">
              <Field label="Due">
                <TextInput
                  type="datetime-local"
                  value={form.dueAt}
                  aria-invalid={Boolean(errors.dueAt)}
                  onChange={(event) => set("dueAt", event.target.value)}
                />
              </Field>
              <FieldError message={errors.dueAt} />
            </div>
          </div>
          <p className="text-xs">
            Your timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </p>
        </div>

        {owner.orgSlug && (
          <AudiencePicker
            orgSlug={owner.orgSlug}
            value={form.audience}
            onChange={(ids) => set("audience", ids)}
          />
        )}

        <ProblemPicker
          problems={problems}
          selected={form.problemIds}
          onChange={(ids) => set("problemIds", ids)}
          error={errors.problems ?? errors.problemIds}
          orderLabel={`In the assignment · ${totalPoints} points in total`}
          marker={(index) => String(index + 1)}
          extra={(problemId) => (
            <label className="flex items-center gap-1 text-xs">
              <TextInput
                type="number"
                min={1}
                aria-label="Points"
                className="w-16 py-0.5"
                value={pointsOf(problemId)}
                onChange={(event) =>
                  set("points", {
                    ...form.points,
                    [problemId]: event.target.value,
                  })
                }
              />
              pts
            </label>
          )}
        />

        <div className="grid gap-3 min-[901px]:grid-cols-2">
          <label className="inline-flex items-center gap-2 self-start text-ink">
            <Checkbox
              checked={form.allowLate}
              onCheckedChange={(checked) => set("allowLate", checked)}
            />
            Accept late submissions
          </label>
          {form.allowLate && (
            <div className="grid content-start gap-1.5">
              <Field
                label="Late penalty (%)"
                help="Taken off marks earned after the due time. 0 counts late work in full."
              >
                <TextInput
                  type="number"
                  min={0}
                  max={100}
                  value={form.latePenaltyPercent}
                  aria-invalid={Boolean(errors.latePenaltyPercent)}
                  onChange={(event) =>
                    set("latePenaltyPercent", event.target.value)
                  }
                />
              </Field>
              <FieldError message={errors.latePenaltyPercent} />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-hairline pt-3.5">
          <span className="min-w-45 flex-1">
            {message ? (
              <FormMessage message={message} />
            ) : (
              <span className="text-caption">
                {form.published
                  ? "Published: students can see this assignment."
                  : "Draft: students can't see this assignment yet."}
              </span>
            )}
          </span>
          {id && (
            <ConfirmButton
              variant="destructive"
              disabled={remove.isPending}
              title={`Delete ${form.title || "this assignment"}?`}
              description="Its gradebook goes with it; students' submissions stay in their history. This can't be undone."
              confirmLabel="Delete assignment"
              onConfirm={() => remove.mutate()}
            >
              Delete
            </ConfirmButton>
          )}
          <Button
            variant="outline"
            disabled={save.isPending}
            onClick={() => submit(false)}
          >
            {form.published ? "Unpublish" : "Save draft"}
          </Button>
          <Button disabled={save.isPending} onClick={() => submit(true)}>
            {form.published ? "Save changes" : "Publish"}
          </Button>
        </div>
      </Card>
    </>
  )
}

interface Gradebook {
  assignment: {
    id: string
    slug: string
    title: string
    dueAt: string
    phase: AssignmentPhase
  }
  problems: { problemId: string; slug: string; title: string; points: number }[]
  total: number
  summary: {
    students: number
    started: number
    average: number
    fullMarks: number
  }
  rows: {
    name: string | null
    email: string
    handle: string | null
    cells: { problemId: string; earned: number; status: GradeStatus }[]
    earned: number
    late: number
  }[]
}

export function AssignmentGradebook({ id }: { id: string }) {
  const owner = useOwner()
  const [viewing, setViewing] = useState<{
    email: string
    problemId: string
  } | null>(null)
  const [search, setSearch] = useState("")
  const { data, error } = useQuery({
    queryKey: owner.key("gradebook", id),
    queryFn: () => api<Gradebook>(owner.api(`/assignments/${id}/gradebook`)),
    refetchInterval: 30_000,
  })
  if (!data) return <Loading error={error} />

  const query = search.trim().toLowerCase()
  const rows = data.rows.filter(
    (row) =>
      !query ||
      row.email.toLowerCase().includes(query) ||
      (row.name ?? "").toLowerCase().includes(query)
  )
  const stats = [
    ["Students", data.summary.students],
    ["Started", data.summary.started],
    ["Full marks", data.summary.fullMarks],
    ["Average", `${data.summary.average} / ${data.total}`],
  ] as const

  return (
    <>
      <PageTitle
        action={
          <span className="flex gap-2">
            <Link
              href={owner.page(`/assignments/${id}`)}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              Edit
            </Link>
            <a
              href={`/api/v1${owner.api(`/assignments/${id}/gradebook`)}?format=csv`}
              download
              className={cn(buttonVariants({ size: "sm" }))}
            >
              Download CSV
            </a>
          </span>
        }
      >
        Gradebook: {data.assignment.title}
      </PageTitle>
      <p className="mb-3 flex flex-wrap items-center gap-2 text-caption text-body">
        <PhaseBadge phase={data.assignment.phase} />
        Due {formatDateTime(data.assignment.dueAt)}. Marks update as students
        submit.
      </p>
      <div className="mb-4 grid grid-cols-2 gap-3 min-[901px]:grid-cols-4">
        {stats.map(([label, value]) => (
          <Card key={label}>
            <div className="text-display-sm text-ink tabular-nums">{value}</div>
            <div className="text-caption">{label}</div>
          </Card>
        ))}
      </div>
      <TextInput
        aria-label="Search students"
        placeholder="Search by name or email"
        className="mb-3 w-72"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <Table
        headers={[
          "Student",
          ...data.problems.map((p) => `${p.title} (${p.points})`),
          `Total (${data.total})`,
        ]}
      >
        {rows.map((row) => (
          <tr key={row.email} data-testid="grade-row">
            <td>
              <div className="text-ink">{row.name ?? row.handle}</div>
              <div className="text-xs">{row.email}</div>
            </td>
            {row.cells.map((cell) => (
              <td
                key={cell.problemId}
                title={STATUS[cell.status].label}
                className={cn("tabular-nums", STATUS[cell.status].tone)}
              >
                {cell.status === "missing" ? (
                  "—"
                ) : (
                  <Button
                    type="button"
                    variant="link"
                    data-testid="grade-cell"
                    className="h-auto p-0 font-normal text-inherit no-underline hover:text-inherit hover:underline"
                    aria-label={`See ${row.email}'s code`}
                    onClick={() =>
                      setViewing({
                        email: row.email,
                        problemId: cell.problemId,
                      })
                    }
                  >
                    {cell.earned}
                    {cell.status === "late" && " (late)"}
                  </Button>
                )}
              </td>
            ))}
            <td className="font-semibold text-ink tabular-nums">
              {row.earned}
            </td>
          </tr>
        ))}
      </Table>
      {rows.length === 0 && (
        <p className="mt-3 text-body-sm text-body">No students match.</p>
      )}
      {viewing && (
        <StudentCode
          path={`${owner.api(`/assignments/${id}/attempts`)}?student=${encodeURIComponent(viewing.email)}&problem=${viewing.problemId}`}
          onClose={() => setViewing(null)}
        />
      )}
    </>
  )
}

interface Attempts {
  student: { name: string | null; email: string }
  problem: { title: string; points: number }
  attempts: {
    id: string
    language: string
    files: { path: string; content: string }[]
    verdict: string | null
    score: number | null
    maxScore: number | null
    passedTests: number | null
    totalTests: number | null
    createdAt: string
    late: boolean
  }[]
}

/** A student's graded submissions on one problem, newest first, with their code. */
function StudentCode({ path, onClose }: { path: string; onClose: () => void }) {
  const { data, error } = useQuery({
    queryKey: ["attempts", path],
    queryFn: () => api<Attempts>(path),
  })
  return (
    // Card doesn't pass extra attributes through, so the test id sits on a wrapper.
    <div data-testid="student-code">
      <Card className="mt-4 grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-title-sm text-ink">
            {data
              ? `${data.student.name ?? data.student.email}: ${data.problem.title}`
              : "Code"}
          </h2>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        {!data && <Loading error={error} />}
        {data?.attempts.length === 0 && (
          <p className="text-body-sm text-body">
            No graded submissions since it opened.
          </p>
        )}
        {data?.attempts.map((a) => (
          <div
            key={a.id}
            className="grid gap-1.5 border-t border-hairline pt-3"
          >
            <div className="flex flex-wrap gap-x-3 text-caption text-body">
              <span
                className={
                  a.verdict === "AC" ? "text-success" : "text-destructive"
                }
              >
                {a.verdict === "AC" ? "Accepted" : (a.verdict ?? "—")}
              </span>
              {a.totalTests !== null && (
                <span className="tabular-nums">
                  {a.passedTests} / {a.totalTests} tests
                </span>
              )}
              <span>{a.language}</span>
              <span>{formatDateTime(a.createdAt)}</span>
              {a.late && <span className="text-primary">Late</span>}
            </div>
            {a.files.map((f) => (
              <div key={f.path}>
                {a.files.length > 1 && (
                  <div className="text-xs text-body">{f.path}</div>
                )}
                <pre className="max-h-80 overflow-auto rounded-md border border-hairline bg-canvas-soft p-3 font-mono text-xs text-ink">
                  {f.content}
                </pre>
              </div>
            ))}
          </div>
        ))}
      </Card>
    </div>
  )
}
