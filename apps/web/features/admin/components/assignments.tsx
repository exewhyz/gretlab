"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"

import { Button, buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  rubricTotal,
  type ExamSettings,
  type RubricCriterion,
} from "@workspace/judge"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"

import { ConfirmButton } from "@/components/confirm"
import { SaveConflict } from "@/components/save-conflict"
import { Markdown } from "@/components/markdown"
import {
  Field,
  FormMessage,
  SelectInput,
  TextArea,
  TextInput,
} from "@/components/form"
import {
  PhaseBadge,
  STATUS,
  type AssignmentPhase,
  type GradeStatus,
} from "@/features/assignments/components/assignments"
import { assignmentInputSchema, slugify } from "@/features/problems/schemas"
import { QuestionPicker } from "@/features/questions/components/question-picker"
import { api, ApiRequestError } from "@/lib/api/client"
import { formatDateTime } from "@/lib/format"
import { useOwner } from "@/features/admin/owner"
import { LiveCode, Playback } from "@/features/drafts/components/student-work"
import { formatLeft, type SittingView } from "@/features/exams/components/exam"
import {
  CommentedCode,
  type LineComment,
} from "@/features/feedback/components/commented-code"
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
  /** Criteria marked by hand, per problem, added to its test points. */
  rubric: Record<string, RubricCriterion[]>
  /** Course outcomes each problem assesses. */
  outcomes: Record<string, string[]>
  /** Bank questions, beside or instead of the problems, with points as typed. */
  questions: { questionId: string; points: string }[]
  holdFeedback: boolean
  /** A lab exam, with its settings as typed. */
  exam: boolean
  examMinutes: string
  examFullscreen: boolean
  /** One address or range per line. */
  examNetworks: string
  /** Minutes after opening to press Start; empty for any time. */
  examStartWithin: string
  audience: string[][]
}

interface StoredAssignment {
  updatedAt: string
  slug: string
  title: string
  description: string
  opensAt: string
  dueAt: string
  allowLate: boolean
  latePenaltyPercent: number
  published: boolean
  holdFeedback: boolean
  exam: ExamSettings | null
  audience: string[][]
  problems: {
    problemId: string
    points: number
    rubric: RubricCriterion[]
    outcomes: string[]
  }[]
  questions: { questionId: string; points: number }[]
}

/** A new one; made from a class page, it's for that class. */
function blankForm(forClass: string | null): AssignmentForm {
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
    audience: forClass ? [[forClass]] : [],
    points: {},
    rubric: {},
    outcomes: {},
    questions: [],
    holdFeedback: false,
    exam: false,
    examMinutes: "60",
    examFullscreen: true,
    examNetworks: "",
    examStartWithin: "",
  }
}

export function AssignmentEditorPage({
  id,
  forClass = null,
}: {
  id: string | null
  /** Started from a class page: aimed at that class, and back there after saving. */
  forClass?: string | null
}) {
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
        rubric: Object.fromEntries(
          data.problems.map((p) => [p.problemId, p.rubric ?? []])
        ),
        outcomes: Object.fromEntries(
          data.problems.map((p) => [p.problemId, p.outcomes ?? []])
        ),
        questions: (data.questions ?? []).map((q) => ({
          questionId: q.questionId,
          points: String(q.points),
        })),
        exam: data.exam !== null,
        examMinutes: data.exam?.minutes ? String(data.exam.minutes) : data.exam ? "" : "60",
        examFullscreen: data.exam?.fullscreen ?? true,
        examNetworks: (data.exam?.networks ?? []).join("\n"),
        examStartWithin: data.exam?.startWithin ? String(data.exam.startWithin) : "",
      }
    : blankForm(forClass)
  return (
    <AssignmentEditor
      key={id ?? "new"}
      id={id}
      version={data?.updatedAt}
      forClass={forClass}
      initial={initial}
      // Students reach problems through the practice pages, so drafts can't be assigned.
      problems={problems.data.problems.filter((p) => p.published)}
    />
  )
}

type FieldErrors = Partial<Record<keyof AssignmentForm | "problems", string>>

function AssignmentEditor({
  id,
  version: openedAt,
  forClass,
  initial,
  problems,
}: {
  id: string | null
  /** When the saved version was last changed; a save over a newer one is refused. */
  version?: string
  forClass: string | null
  initial: AssignmentForm
  problems: StaffProblemList["problems"]
}) {
  const owner = useOwner()
  const router = useRouter()
  const [version, setVersion] = useState(openedAt)
  const [conflict, setConflict] = useState(false)
  // "Keep mine" saves once without the version check.
  const overwrite = useRef(false)
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
  const rubricOf = (problemId: string) => form.rubric[problemId] ?? []
  const totalPoints = form.problemIds.reduce(
    (sum, problemId) =>
      sum +
      (Number(pointsOf(problemId)) || 0) +
      rubricTotal(rubricOf(problemId)),
    0
  )

  /** Checks with the same rules as the server, to show errors beside their fields. */
  function validated(published: boolean) {
    const parsed = assignmentInputSchema.safeParse({
      title: form.title,
      slug: form.slug,
      description: form.description,
      allowLate: form.exam ? false : form.allowLate,
      holdFeedback: form.holdFeedback,
      exam: form.exam
        ? {
            minutes:
              form.examMinutes.trim() === "" ? null : Number(form.examMinutes),
            fullscreen: form.examFullscreen,
            networks: form.examNetworks
              .split(/[\n,]/)
              .map((n) => n.trim())
              .filter(Boolean),
            startWithin:
              form.examStartWithin.trim() === ""
                ? null
                : Number(form.examStartWithin),
          }
        : null,
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
        rubric: rubricOf(problemId),
        outcomes: form.outcomes[problemId] ?? [],
      })),
      questions: form.questions.map((q) => ({
        questionId: q.questionId,
        points: q.points.trim() === "" ? NaN : Number(q.points),
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
    mutationFn: (body: NonNullable<ReturnType<typeof validated>>) => {
      const expectedUpdatedAt = overwrite.current ? undefined : version
      overwrite.current = false
      return id
        ? api<{ id: string; updatedAt: string }>(owner.api(`/assignments/${id}`), {
            method: "PUT",
            body: { ...body, expectedUpdatedAt },
          })
        : api<{ id: string; updatedAt: string }>(owner.api("/assignments"), { body })
    },
    onSuccess: (saved, body) => {
      setVersion(saved.updatedAt)
      setConflict(false)
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
      if (!id && forClass && owner.orgSlug)
        router.push(`/orgs/${owner.orgSlug}/classes/${forClass}?tab=classwork`)
      else if (!id) router.push(owner.page(`/assignments/${saved.id}`))
    },
    onError: (error) => {
      if (error instanceof ApiRequestError && error.code === "edited_elsewhere") {
        setConflict(true)
      }
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
            <span className="flex items-center gap-1.5">
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
              <RubricEditor
                title={problems.find((p) => p.id === problemId)?.title ?? ""}
                rubric={rubricOf(problemId)}
                onChange={(rubric) =>
                  set("rubric", { ...form.rubric, [problemId]: rubric })
                }
              />
              {owner.orgSlug && (
                <OutcomeTagger
                  orgSlug={owner.orgSlug}
                  title={problems.find((p) => p.id === problemId)?.title ?? ""}
                  chosen={form.outcomes[problemId] ?? []}
                  onChange={(ids) =>
                    set("outcomes", { ...form.outcomes, [problemId]: ids })
                  }
                />
              )}
            </span>
          )}
        />

        <QuestionPicker
          selected={form.questions}
          onChange={(questions) => set("questions", questions)}
          error={errors.questions}
        />

        <div className="grid gap-3 rounded-md border border-hairline p-3">
          <label className="inline-flex items-center gap-2 self-start text-ink">
            <Checkbox
              checked={form.exam}
              onCheckedChange={(checked) => {
                set("exam", checked)
                if (checked) set("allowLate", false)
              }}
            />
            Lab exam: each student starts it once and has a fixed time
          </label>
          {form.exam && (
            <div className="grid gap-3 min-[901px]:grid-cols-2">
              <Field
                label="Minutes per student"
                help="From when they press Start; it still ends at the due time. Leave empty for until the due time."
              >
                <TextInput
                  type="number"
                  min={5}
                  max={600}
                  value={form.examMinutes}
                  onChange={(event) => set("examMinutes", event.target.value)}
                />
              </Field>
              <Field
                label="Lab networks (optional)"
                help="One address or range per line, such as 10.1.0.0/16. Students can start and submit only from these. Empty allows anywhere."
              >
                <TextArea
                  rows={3}
                  mono
                  value={form.examNetworks}
                  onChange={(event) => set("examNetworks", event.target.value)}
                />
              </Field>
              <Field
                label="Students must start within (minutes after it opens)"
                help="Keeps a lab starting together, so nobody who has finished can brief a late starter. Empty allows starting any time before the due time."
              >
                <TextInput
                  type="number"
                  min={1}
                  max={1440}
                  value={form.examStartWithin}
                  onChange={(event) => set("examStartWithin", event.target.value)}
                />
              </Field>
              <label className="inline-flex items-center gap-2 self-start text-ink">
                <Checkbox
                  checked={form.examFullscreen}
                  onCheckedChange={(checked) => set("examFullscreen", checked)}
                />
                Ask for fullscreen
              </label>
              {form.problemIds.some(
                (id) => problems.find((p) => p.id === id)?.listed
              ) && (
                <p
                  className="rounded-md border border-primary/40 bg-primary/5 p-2 text-caption text-ink min-[901px]:col-span-2"
                  data-testid="exam-library-warning"
                >
                  Some of these problems are in the public library, so anyone can practise
                  them, with hints and editorials, before the exam. For a closed exam, use
                  &ldquo;Write a problem&rdquo; or &ldquo;Import problems&rdquo; above: those
                  stay out of the library.
                </p>
              )}
              <p className="text-caption min-[901px]:col-span-2">
                Problems stay hidden until a student starts. Leaving the page or fullscreen
                and pasting from elsewhere are recorded in the gradebook; editorials are
                closed during the exam. Only work submitted during their time counts.
              </p>
            </div>
          )}
          <FieldError message={errors.exam} />
        </div>

        <div className="grid gap-3 min-[901px]:grid-cols-2">
          <label className="inline-flex items-center gap-2 self-start text-ink">
            <Checkbox
              disabled={form.exam}
              checked={form.allowLate}
              onCheckedChange={(checked) => set("allowLate", checked)}
            />
            Accept late submissions
          </label>
          <label className="inline-flex items-center gap-2 self-start text-ink">
            <Checkbox
              checked={form.holdFeedback}
              onCheckedChange={(checked) => set("holdFeedback", checked)}
            />
            Hold results until I release them (quiz marks and answers, rubric
            marks, comments)
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

        {conflict && (
          <SaveConflict
            onKeepMine={() => {
              overwrite.current = true
              submit(form.published)
            }}
          />
        )}
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
    holdFeedback: boolean
    exam: ExamSettings | null
    quiz: { questions: number; points: number } | null
  }
  /** `points` is tests plus rubric. */
  problems: {
    problemId: string
    slug: string
    title: string
    points: number
    tests: number
    rubric: RubricCriterion[]
  }[]
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
    exam: (SittingView & { warnings: number }) | null
    extension: { dueAt: string; problemIds: string[]; reason: string } | null
    quiz: { earned: number; max: number; answered: boolean; needsMarking: number } | null
  }[]
}

export function AssignmentGradebook({ id }: { id: string }) {
  const owner = useOwner()
  const [viewing, setViewing] = useState<{
    email: string
    problemId: string
  } | null>(null)
  const [now] = useState(() => Date.now())
  const [marking, setMarking] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const client = useQueryClient()
  const [rejudged, setRejudged] = useState<string | null>(null)
  const rejudge = useMutation({
    mutationFn: () =>
      api<{ queued: number }>(owner.api(`/assignments/${id}/rejudge`), {
        method: "POST",
      }),
    onSuccess: ({ queued }) => {
      setRejudged(
        queued
          ? `${queued} ${queued === 1 ? "submission is" : "submissions are"} being judged again. Marks update as they finish.`
          : "No system errors to re-judge."
      )
      void client.invalidateQueries({ queryKey: owner.key("gradebook", id) })
    },
    onError: (e) => setRejudged(e.message),
  })
  const release = useMutation({
    mutationFn: () =>
      api(owner.api(`/assignments/${id}/release`), { method: "POST" }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: owner.key("gradebook", id) }),
  })
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
            <Button
              size="sm"
              variant="outline"
              disabled={rejudge.isPending}
              title="After a runner outage: judge every submission that ended in a system error again, keeping when it was submitted."
              onClick={() => rejudge.mutate()}
            >
              Re-judge system errors
            </Button>
            {data.assignment.exam && (
              <ConfirmButton
                size="sm"
                variant="outline"
                title="Forget network addresses?"
                description="The addresses each sitting started from, and of refused submissions, are deleted. Everything else stays. This can't be undone."
                confirmLabel="Forget addresses"
                onConfirm={() =>
                  void api(owner.api(`/assignments/${id}/forget-addresses`), {
                    method: "POST",
                  }).then(() =>
                    client.invalidateQueries({ queryKey: ["attempts"] })
                  )
                }
              >
                Forget addresses
              </ConfirmButton>
            )}
            {data.assignment.holdFeedback && (
              <ConfirmButton
                size="sm"
                disabled={release.isPending}
                title="Release results?"
                description="Every student sees their marks: quiz answers with the right answers, rubric marks and comments. New marks show at once from then on."
                confirmLabel="Release results"
                tone="default"
                onConfirm={() => release.mutate()}
              >
                Release results
              </ConfirmButton>
            )}
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
        {data.assignment.holdFeedback &&
          " Results are held: students don't see quiz marks, rubric marks or comments yet."}
        {rejudged && <span data-testid="rejudge-result"> {rejudged}</span>}
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
          ...(data.assignment.exam ? ["Exam"] : []),
          ...data.problems.map((p) => `${p.title} (${p.points})`),
          ...(data.assignment.quiz ? [`Quiz (${data.assignment.quiz.points})`] : []),
          `Total (${data.total})`,
        ]}
      >
        {rows.map((row) => (
          <tr key={row.email} data-testid="grade-row">
            <td>
              <div className="text-ink">{row.name ?? row.handle}</div>
              <div className="text-xs">{row.email}</div>
              <ExtensionControl
                assignmentId={id}
                student={row.email}
                name={row.name ?? row.handle ?? row.email}
                dueAt={data.assignment.dueAt}
                problems={data.problems}
                extension={row.extension}
              />
            </td>
            {row.exam && (
              <td className="text-caption" data-testid="exam-cell">
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 text-caption font-normal text-ink"
                  aria-label={`See ${row.email}'s exam`}
                  disabled={!data.problems[0]}
                  onClick={() =>
                    setViewing({
                      email: row.email,
                      problemId: data.problems[0]!.problemId,
                    })
                  }
                >
                  {row.exam.status === "not_started"
                    ? "Not started"
                    : row.exam.status === "in_progress"
                      ? `In progress, ${formatLeft(new Date(row.exam.endsAt!).getTime() - now)} left`
                      : row.exam.finishedEarly
                        ? "Finished"
                        : "Time ran out"}
                </Button>
                {row.exam.warnings > 0 && (
                  <div className="text-destructive">
                    {row.exam.warnings}{" "}
                    {row.exam.warnings === 1 ? "warning" : "warnings"}
                  </div>
                )}
              </td>
            )}
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
            {data.assignment.quiz && (
              <td className="tabular-nums" data-testid="quiz-cell">
                {row.quiz?.answered ? (
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 font-normal text-inherit"
                    aria-label={`Mark ${row.email}'s answers`}
                    onClick={() => setMarking(row.email)}
                  >
                    {row.quiz.earned}
                  </Button>
                ) : (
                  "—"
                )}
                {(row.quiz?.needsMarking ?? 0) > 0 && (
                  <div className="text-xs text-primary">
                    {row.quiz!.needsMarking} to mark
                  </div>
                )}
              </td>
            )}
            <td className="font-semibold text-ink tabular-nums">
              {row.earned}
            </td>
          </tr>
        ))}
      </Table>
      {rows.length === 0 && (
        <p className="mt-3 text-body-sm text-body">No students match.</p>
      )}
      {marking && (
        <QuizMarking
          key={marking}
          assignmentId={id}
          student={marking}
          onClose={() => setMarking(null)}
        />
      )}
      {viewing && (
        <StudentCode
          key={`${viewing.email} ${viewing.problemId}`}
          assignmentId={id}
          student={viewing.email}
          problemId={viewing.problemId}
          onClose={() => setViewing(null)}
        />
      )}
    </>
  )
}

interface Attempts {
  exam:
    | (SittingView & {
        ip: string | null
        events: { kind: string; detail: string; at: string }[]
      })
    | null
  student: { name: string | null; email: string }
  problem: { title: string; points: number; rubric: RubricCriterion[] }
  marks: Record<string, number>
  holdFeedback: boolean
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
    outside: boolean
    comments: LineComment[]
  }[]
}

/**
 * One student on one problem: their graded submissions (with rubric marks and line
 * comments), the code they're writing now, and how that code grew.
 */
function StudentCode({
  assignmentId,
  student,
  problemId,
  onClose,
}: {
  assignmentId: string
  student: string
  problemId: string
  onClose: () => void
}) {
  const owner = useOwner()
  const client = useQueryClient()
  const path = `${owner.api(`/assignments/${assignmentId}/attempts`)}?student=${encodeURIComponent(student)}&problem=${problemId}`
  const { data, error } = useQuery({
    queryKey: ["attempts", path],
    queryFn: () => api<Attempts>(path),
  })
  const refresh = () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["attempts", path] }),
      client.invalidateQueries({ queryKey: owner.key("gradebook", assignmentId) }),
    ])
  const addComment = (submissionId: string, file: string) =>
    (line: number, body: string) =>
      api(owner.api(`/assignments/${assignmentId}/comments`), {
        body: { student, submissionId, path: file, line, body },
      }).then(refresh)
  const removeComment = (commentId: string) =>
    api(owner.api(`/assignments/${assignmentId}/comments/${commentId}`), {
      method: "DELETE",
    }).then(refresh)
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
        {data?.exam && (
          <ExamRecord
            exam={data.exam}
            onExtend={(minutes) =>
              api(owner.api(`/assignments/${assignmentId}/extend`), {
                body: { student, minutes },
              }).then(refresh)
            }
          />
        )}
        {data && data.problem.rubric.length > 0 && (
          <RubricMarking
            rubric={data.problem.rubric}
            marks={data.marks}
            held={data.holdFeedback}
            onSave={(marks) =>
              api(owner.api(`/assignments/${assignmentId}/marks`), {
                method: "PUT",
                body: { student, problemId, marks },
              }).then(refresh)
            }
          />
        )}
        <Tabs defaultValue="submissions">
          <TabsList variant="line">
            <TabsTrigger value="submissions">
              Submissions{data ? ` (${data.attempts.length})` : ""}
            </TabsTrigger>
            <TabsTrigger value="live">Working copy</TabsTrigger>
            <TabsTrigger value="playback">Playback</TabsTrigger>
          </TabsList>
          <TabsContent value="live" className="pt-3">
            <LiveCode path={path} />
          </TabsContent>
          <TabsContent value="playback" className="pt-3">
            <Playback path={path} />
          </TabsContent>
          <TabsContent value="submissions" className="grid gap-3 pt-3">
            {!data && <Loading error={error} />}
            {data?.attempts.length === 0 && (
              <p className="text-body-sm text-body">
                No graded submissions since it opened.
              </p>
            )}
            {data && data.attempts.length > 0 && (
              <p className="text-caption">
                Select a line number to comment on that line
                {data.holdFeedback
                  ? ". Students see comments once you release feedback."
                  : "; the student sees it with the submission."}
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
                  {a.outside && (
                    <span className="text-primary">
                      Outside the exam: doesn&apos;t count
                    </span>
                  )}
                </div>
                {a.files.map((f) => (
                  <div
                    key={f.path}
                    className="overflow-hidden rounded-md border border-hairline"
                  >
                    {a.files.length > 1 && (
                      <div className="px-3 pt-2 text-xs text-body">{f.path}</div>
                    )}
                    <CommentedCode
                      content={f.content}
                      comments={a.comments.filter((c) => c.path === f.path)}
                      onAdd={addComment(a.id, f.path)}
                      onDelete={removeComment}
                    />
                  </div>
                ))}
              </div>
            ))}
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  )
}

const EVENT_LABEL: Record<string, string> = {
  left_tab: "Left the page",
  left_fullscreen: "Left fullscreen",
  pasted: "Pasted from elsewhere",
  other_network: "Tried to submit from another network",
}

/** A student's exam sitting: when, from where, what the browser noticed, and more time. */
function ExamRecord({
  exam,
  onExtend,
}: {
  exam: NonNullable<Attempts["exam"]>
  onExtend: (minutes: number) => Promise<unknown>
}) {
  const [minutes, setMinutes] = useState("10")
  const [message, setMessage] = useState<{
    text: string
    kind: "ok" | "err"
  } | null>(null)
  const extend = useMutation({
    mutationFn: () => onExtend(Number(minutes)),
    onSuccess: () => setMessage({ text: "More time given.", kind: "ok" }),
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
  })
  return (
    <div
      className="grid gap-2 rounded-md border border-hairline p-3"
      data-testid="exam-record"
    >
      <h3 className="text-body-sm font-semibold text-ink">Exam</h3>
      {exam.status === "not_started" ? (
        <p className="text-caption">Hasn&apos;t started.</p>
      ) : (
        <>
          <p className="text-caption">
            Started {formatDateTime(exam.startedAt!)}
            {exam.ip ? ` from ${exam.ip}` : ""};{" "}
            {exam.status === "in_progress" ? "ends" : "ended"}{" "}
            {formatDateTime(exam.endsAt!)}
            {exam.finishedEarly ? " (finished early)" : ""}.
          </p>
          {exam.events.length === 0 ? (
            <p className="text-caption">Nothing noticed during the exam.</p>
          ) : (
            <ul className="grid gap-0.5 text-caption" data-testid="exam-events">
              {exam.events.map((e, i) => (
                <li key={i}>
                  <span className="tabular-nums">{formatDateTime(e.at)}</span>
                  {" · "}
                  <span className="text-ink">{EVENT_LABEL[e.kind] ?? e.kind}</span>
                  {e.detail && ` (${e.detail})`}
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <TextInput
              type="number"
              min={1}
              max={600}
              aria-label="Extra minutes"
              className="w-20 py-0.5"
              value={minutes}
              onChange={(event) => {
                setMinutes(event.target.value)
                setMessage(null)
              }}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={extend.isPending || !(Number(minutes) >= 1)}
              onClick={() => extend.mutate()}
            >
              Give more time
            </Button>
            {message && <FormMessage message={message} />}
          </div>
        </>
      )}
    </div>
  )
}

/** Marks for each rubric criterion, saved together. */
function RubricMarking({
  rubric,
  marks,
  held,
  onSave,
}: {
  rubric: RubricCriterion[]
  marks: Record<string, number>
  held: boolean
  onSave: (marks: Record<string, number>) => Promise<unknown>
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      rubric.map((c) => [c.id, c.id in marks ? String(marks[c.id]) : ""])
    )
  )
  const [message, setMessage] = useState<{
    text: string
    kind: "ok" | "err"
  } | null>(null)
  const save = useMutation({
    mutationFn: () => {
      const out: Record<string, number> = {}
      for (const c of rubric) {
        const text = values[c.id]?.trim() ?? ""
        if (text === "") continue
        const n = Number(text)
        if (!Number.isFinite(n) || n < 0 || n > c.points) {
          throw new Error(`${c.label}: give 0 to ${c.points}.`)
        }
        out[c.id] = n
      }
      return onSave(out)
    },
    onSuccess: () =>
      setMessage({
        text: held ? "Saved. Held until you release feedback." : "Saved.",
        kind: "ok",
      }),
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
  })
  const earned = rubric.reduce(
    (t, c) => t + Math.min(c.points, Math.max(0, Number(values[c.id]) || 0)),
    0
  )
  return (
    <div
      className="grid gap-2 rounded-md border border-hairline p-3"
      data-testid="rubric-marking"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-body-sm font-semibold text-ink">Rubric</h3>
        <span className="text-caption tabular-nums">
          {earned} / {rubricTotal(rubric)} by hand
        </span>
      </div>
      {rubric.map((c) => (
        <label key={c.id} className="flex items-center gap-2 text-body-sm">
          <span className="flex-1 text-ink">{c.label}</span>
          <TextInput
            type="number"
            min={0}
            max={c.points}
            aria-label={`Marks for ${c.label}`}
            className="w-20 py-0.5"
            value={values[c.id] ?? ""}
            onChange={(event) => {
              setValues((v) => ({ ...v, [c.id]: event.target.value }))
              setMessage(null)
            }}
          />
          <span className="w-12 text-caption tabular-nums">/ {c.points}</span>
        </label>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          Save marks
        </Button>
        {message && <FormMessage message={message} />}
      </div>
    </div>
  )
}

/** Criteria a teacher marks by hand for one problem, on top of its tests. */
function RubricEditor({
  title,
  rubric,
  onChange,
}: {
  title: string
  rubric: RubricCriterion[]
  onChange: (rubric: RubricCriterion[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<
    { id: string; label: string; points: string }[]
  >([])
  const begin = () => {
    setDraft(rubric.map((c) => ({ ...c, points: String(c.points) })))
    setOpen(true)
  }
  const edit = (index: number, change: Partial<(typeof draft)[number]>) =>
    setDraft((rows) =>
      rows.map((row, i) => (i === index ? { ...row, ...change } : row))
    )
  const total = rubricTotal(rubric)
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="xs"
        aria-label={`Rubric for ${title}`}
        onClick={begin}
      >
        {rubric.length ? `+ ${total} rubric` : "Rubric"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Rubric for {title}</DialogTitle>
            <DialogDescription>
              Marked by hand in the gradebook and added to the test points:
              naming, comments, approach.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {draft.length === 0 && (
              <p className="text-caption">No criteria: tests decide the marks.</p>
            )}
            {draft.map((row, index) => (
              <div key={row.id} className="flex items-center gap-2">
                <TextInput
                  aria-label="Criterion"
                  placeholder="Readable names"
                  className="flex-1"
                  value={row.label}
                  onChange={(event) => edit(index, { label: event.target.value })}
                />
                <TextInput
                  type="number"
                  min={1}
                  aria-label="Criterion points"
                  className="w-20"
                  value={row.points}
                  onChange={(event) => edit(index, { points: event.target.value })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Remove criterion"
                  onClick={() => setDraft((rows) => rows.filter((_, i) => i !== index))}
                >
                  ×
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="justify-self-start"
              disabled={draft.length >= 20}
              onClick={() =>
                setDraft((rows) => [
                  ...rows,
                  { id: crypto.randomUUID().slice(0, 8), label: "", points: "10" },
                ])
              }
            >
              Add criterion
            </Button>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                onChange(
                  draft.map((row) => ({
                    id: row.id,
                    label: row.label.trim(),
                    points: Number(row.points) || 0,
                  }))
                )
                setOpen(false)
              }}
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

interface CourseOutcomeOption {
  id: string
  code: string
  title: string
  groupId: string
  course: string
}

/** Which course outcomes a problem assesses, chosen from every course in the organization. */
function OutcomeTagger({
  orgSlug,
  title,
  chosen,
  onChange,
}: {
  orgSlug: string
  title: string
  chosen: string[]
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const { data, error } = useQuery({
    queryKey: ["org", orgSlug, "outcomes", "courses"],
    queryFn: () =>
      api<CourseOutcomeOption[]>(`/orgs/${orgSlug}/outcomes/courses`),
    enabled: open || chosen.length > 0,
  })
  const query = search.trim().toLowerCase()
  const shown = (data ?? []).filter(
    (o) =>
      !query ||
      `${o.course} ${o.code} ${o.title}`.toLowerCase().includes(query)
  )
  const courses = [...new Set(shown.map((o) => o.course))]
  const codes = (data ?? [])
    .filter((o) => chosen.includes(o.id))
    .map((o) => o.code)
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="xs"
        aria-label={`Outcomes for ${title}`}
        onClick={() => setOpen(true)}
      >
        {chosen.length ? codes.join(", ") || `${chosen.length} COs` : "COs"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Outcomes {title} assesses</DialogTitle>
            <DialogDescription>
              Marks on this problem count toward each chosen course outcome.
            </DialogDescription>
          </DialogHeader>
          {!data ? (
            <Loading error={error} />
          ) : data.length === 0 ? (
            <p className="text-caption">
              No course outcomes yet. A class sets them on its Outcomes tab.
            </p>
          ) : (
            <div className="grid gap-2">
              <TextInput
                aria-label="Search outcomes"
                placeholder="Search outcomes"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <div className="grid max-h-80 gap-3 overflow-y-auto">
                {courses.map((course) => (
                  <div key={course} className="grid gap-1">
                    <div className="text-caption font-medium text-ink">{course}</div>
                    {shown
                      .filter((o) => o.course === course)
                      .map((o) => (
                        <label
                          key={o.id}
                          className="flex items-start gap-2 text-body-sm"
                        >
                          <Checkbox
                            checked={chosen.includes(o.id)}
                            onCheckedChange={(checked) =>
                              onChange(
                                checked
                                  ? [...chosen, o.id]
                                  : chosen.filter((id) => id !== o.id)
                              )
                            }
                          />
                          <span>
                            <b>{o.code}</b> {o.title}
                          </span>
                        </label>
                      ))}
                  </div>
                ))}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" onClick={() => setOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** A later due date for one student, or reopening some problems after feedback. */
function ExtensionControl({
  assignmentId,
  student,
  name,
  dueAt,
  problems,
  extension,
}: {
  assignmentId: string
  student: string
  name: string
  dueAt: string
  problems: { problemId: string; title: string }[]
  extension: { dueAt: string; problemIds: string[]; reason: string } | null
}) {
  const owner = useOwner()
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const suggested = new Date(
    Math.max(new Date(dueAt).getTime(), Date.now()) + 3 * 86_400_000
  )
  const [until, setUntil] = useState(
    toLocalInput(extension?.dueAt ?? suggested.toISOString())
  )
  const [chosen, setChosen] = useState<string[]>(extension?.problemIds ?? [])
  const [reason, setReason] = useState(extension?.reason ?? "")
  const [message, setMessage] = useState<string | null>(null)
  const path = owner.api(`/assignments/${assignmentId}/extensions`)
  const refresh = () =>
    client.invalidateQueries({ queryKey: owner.key("gradebook", assignmentId) })
  const save = useMutation({
    mutationFn: () =>
      api(path, {
        method: "PUT",
        body: { student, dueAt: new Date(until).toISOString(), problemIds: chosen, reason },
      }),
    onSuccess: () => {
      setOpen(false)
      void refresh()
    },
    onError: (e) => setMessage(e.message),
  })
  const labelOf = (id: string) => {
    const index = problems.findIndex((p) => p.problemId === id)
    return index < 0 ? "" : `Q${index + 1}`
  }
  return (
    <>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {extension && (
          <span
            data-testid="extension-chip"
            className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary"
            title={extension.reason || undefined}
          >
            Until {formatDateTime(extension.dueAt)}
            {extension.problemIds.length > 0 &&
              ` · ${extension.problemIds.map(labelOf).join(", ")}`}
          </span>
        )}
        <Button
          type="button"
          variant="link"
          size="xs"
          className="h-auto p-0 text-xs"
          aria-label={`Extend for ${student}`}
          onClick={() => setOpen(true)}
        >
          {extension ? "Change" : "Extend"}
        </Button>
        {extension && (
          <ConfirmButton
            variant="link"
            size="xs"
            className="h-auto p-0 text-xs text-destructive"
            title={`Remove ${name}'s extension?`}
            description="Their work is graded against the assignment's own due time again."
            confirmLabel="Remove extension"
            onConfirm={() =>
              void api(`${path}?student=${encodeURIComponent(student)}`, {
                method: "DELETE",
              }).then(refresh)
            }
          >
            Remove
          </ConfirmButton>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Extend for {name}</DialogTitle>
            <DialogDescription>
              A later due time for this student only. Choose problems to reopen just those,
              for example after feedback; choose none for the whole assignment.
            </DialogDescription>
          </DialogHeader>
          <Field label="New due time">
            <TextInput
              type="datetime-local"
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
          </Field>
          <div className="grid gap-1.5">
            <div className="text-caption font-medium text-ink">Problems</div>
            {problems.map((p, index) => (
              <label key={p.problemId} className="inline-flex items-center gap-2 text-body-sm">
                <Checkbox
                  checked={chosen.includes(p.problemId)}
                  onCheckedChange={(checked) =>
                    setChosen((all) =>
                      checked ? [...all, p.problemId] : all.filter((x) => x !== p.problemId)
                    )
                  }
                />
                Q{index + 1}. {p.title}
              </label>
            ))}
            <p className="text-caption">
              {chosen.length === 0 ? "None chosen: the whole assignment." : "Only these reopen."}
            </p>
          </div>
          <Field label="Reason (optional, for your records)">
            <TextInput value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
          {message && <FormMessage message={{ text: message, kind: "err" }} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              Save extension
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

interface StudentQuiz {
  student: { name: string | null; email: string }
  savedAt: string | null
  earned: number
  max: number
  held: boolean
  questions: {
    id: string
    kind: "single" | "multiple" | "short" | "written"
    prompt: string
    options: { id: string; text: string }[]
    correct: string[]
    accepted: string[]
    points: number
    answer: string[] | string | null
    earned: number | null
    needsMarking: boolean
    byTeacher: boolean
    automatic: number | null
  }[]
}

/** One student's answers: the automatic marks, and a teacher's mark to replace any of them. */
function QuizMarking({
  assignmentId,
  student,
  onClose,
}: {
  assignmentId: string
  student: string
  onClose: () => void
}) {
  const owner = useOwner()
  const client = useQueryClient()
  const path = `${owner.api(`/assignments/${assignmentId}/quiz`)}?student=${encodeURIComponent(student)}`
  const { data, error } = useQuery({
    queryKey: ["quiz-marking", path],
    queryFn: () => api<StudentQuiz>(path),
  })
  const [given, setGiven] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<{ text: string; kind: "ok" | "err" } | null>(null)
  const save = useMutation({
    mutationFn: () => {
      const marks: Record<string, number | null> = {}
      for (const [id, text] of Object.entries(given)) {
        marks[id] = text.trim() === "" ? null : Number(text)
      }
      return api(owner.api(`/assignments/${assignmentId}/quiz`), {
        method: "PUT",
        body: { student, marks },
      })
    },
    onSuccess: () => {
      setMessage({ text: "Saved.", kind: "ok" })
      setGiven({})
      void client.invalidateQueries({ queryKey: ["quiz-marking", path] })
      void client.invalidateQueries({ queryKey: owner.key("gradebook", assignmentId) })
    },
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
  })
  const show = (q: StudentQuiz["questions"][number]) => {
    if (q.answer === null) return "No answer"
    if (Array.isArray(q.answer)) {
      return (
        q.answer
          .map((id) => q.options.find((o) => o.id === id)?.text ?? id)
          .join(", ") || "No answer"
      )
    }
    return q.answer.trim() || "No answer"
  }
  return (
    <div data-testid="quiz-marking">
      <Card className="mt-4 grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-title-sm text-ink">
            {data ? `${data.student.name ?? data.student.email}: quiz` : "Quiz"}
            {data && (
              <span className="ml-2 text-caption tabular-nums">
                {data.earned} / {data.max}
              </span>
            )}
          </h2>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
        {!data && <Loading error={error} />}
        {data?.questions.map((q, index) => (
          <div key={q.id} className="grid gap-1.5 border-t border-hairline pt-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-body-sm font-semibold text-ink">Q{index + 1}</span>
              <span className="text-caption">
                {q.needsMarking
                  ? "Needs marking"
                  : q.byTeacher
                    ? `Marked ${q.earned} (automatic: ${q.automatic ?? "none"})`
                    : `Automatic: ${q.earned}`}{" "}
                / {q.points}
              </span>
            </div>
            <div className="text-body-sm text-body">
              <Markdown text={q.prompt} />
            </div>
            <div className="rounded-md bg-canvas-soft p-2 font-sans text-body-sm whitespace-pre-wrap text-ink">
              {show(q)}
            </div>
            {(q.kind === "single" || q.kind === "multiple") && (
              <p className="text-caption">
                Right:{" "}
                {q.correct
                  .map((id) => q.options.find((o) => o.id === id)?.text ?? id)
                  .join(", ")}
              </p>
            )}
            {q.kind === "short" && q.accepted.length > 0 && (
              <p className="text-caption">Accepted: {q.accepted.join(" · ")}</p>
            )}
            <label className="flex items-center gap-2 text-caption">
              Your mark
              <TextInput
                type="number"
                min={0}
                max={q.points}
                aria-label={`Mark for Q${index + 1}`}
                placeholder={q.byTeacher ? String(q.earned) : "automatic"}
                className="w-24 py-0.5"
                value={given[q.id] ?? (q.byTeacher ? String(q.earned) : "")}
                onChange={(event) => {
                  setGiven((g) => ({ ...g, [q.id]: event.target.value }))
                  setMessage(null)
                }}
              />
              / {q.points} (empty: automatic)
            </label>
          </div>
        ))}
        {data && (
          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              disabled={save.isPending || Object.keys(given).length === 0}
              onClick={() => save.mutate()}
            >
              Save marks
            </Button>
            {message && <FormMessage message={message} />}
            {data.held && (
              <span className="text-caption">
                Held: the student sees these once you release results.
              </span>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}
