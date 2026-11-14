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

import { ConfirmButton } from "@/components/confirm"
import { SaveConflict } from "@/components/save-conflict"
import { Field, FormMessage, TextArea, TextInput } from "@/components/form"
import { assignmentInputSchema, slugify } from "@/features/problems/schemas"
import { QuestionPicker } from "@/features/questions/components/question-picker"
import { api, ApiRequestError } from "@/lib/api/client"
import { useOwner } from "@/features/admin/owner"
import {
  ProjectsEditor,
  projectKey,
  type ProjectDraft,
} from "@/features/projects/components/projects"
import { AudiencePicker } from "./audience"

import { FieldError, ProblemPicker, toLocalInput } from "./contests"
import type { StaffProblemList } from "./problems"
import { Card, Loading, PageTitle } from "./shell"
import { orgPages } from "@/lib/paths"
import type { ApiResult } from "@/lib/api/types"
import type { orgCourseOutcomes } from "@/features/outcomes/server"
import type { orgTemplateFromAssignment } from "@/features/templates/org"
import { YourAddress } from "./gradebook"

export interface AssignmentForm {
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
  /** Project work handed in as GitHub repositories. */
  projects: ProjectDraft[]
  /** Peer review after the due time, as typed. */
  peer: boolean
  peerReviews: string
  peerAnonymous: boolean
  /** Empty: no end. */
  peerDueAt: string
}

export interface StoredAssignment {
  updatedAt: string
  /** Templates have no address, dates or audience. */
  slug?: string
  title: string
  description: string
  opensAt?: string
  dueAt?: string
  allowLate: boolean
  latePenaltyPercent: number
  published: boolean
  holdFeedback: boolean
  exam: ExamSettings | null
  peerReview?: {
    reviews: number
    anonymous: boolean
    dueAt: string | null
  } | null
  projects?: {
    id: string
    title: string
    instructions: string
    points: number
  }[]
  audience?: string[][]
  /** Made from a template (assignments). */
  templateId?: string | null
  /** Its problems as the picker lists them, for ones the picker no longer offers. */
  chosenProblems?: Omit<StaffProblemList["problems"][number], "testCount">[]
  problems: {
    problemId: string
    points: number
    rubric: RubricCriterion[]
    outcomes: string[]
  }[]
  questions: { questionId: string; points: number }[]
}

/** A new one; made from a class page, it's for that class. */
export function blankForm(forClass: string | null): AssignmentForm {
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
    projects: [],
    peer: false,
    peerReviews: "2",
    peerAnonymous: true,
    peerDueAt: "",
  }
}

export function AssignmentEditorPage({
  id,
  forClass = null,
  template = false,
}: {
  id: string | null
  /** Started from a class page: aimed at that class, and back there after saving. */
  forClass?: string | null
  /** Edits a template: the same form without address, dates or audience. */
  template?: boolean
}) {
  const owner = useOwner()
  const { data, error } = useQuery({
    queryKey: owner.key(template ? "template" : "assignment", id),
    queryFn: () =>
      api<StoredAssignment>(
        owner.api(`/${template ? "templates" : "assignments"}/${id}`)
      ),
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
  const blank = blankForm(forClass)
  const initial: AssignmentForm = data
    ? {
        ...data,
        slug: data.slug ?? "",
        audience: data.audience ?? [],
        opensAt: data.opensAt ? toLocalInput(data.opensAt) : blank.opensAt,
        dueAt: data.dueAt ? toLocalInput(data.dueAt) : blank.dueAt,
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
        examMinutes: data.exam?.minutes
          ? String(data.exam.minutes)
          : data.exam
            ? ""
            : "60",
        examFullscreen: data.exam?.fullscreen ?? true,
        examNetworks: (data.exam?.networks ?? []).join("\n"),
        projects: (data.projects ?? []).map((p) => ({
          key: projectKey(),
          id: p.id,
          title: p.title,
          instructions: p.instructions,
          points: String(p.points),
        })),
        peer: Boolean(data.peerReview),
        peerReviews: String(data.peerReview?.reviews ?? 2),
        peerAnonymous: data.peerReview?.anonymous ?? true,
        peerDueAt: data.peerReview?.dueAt
          ? toLocalInput(data.peerReview.dueAt)
          : "",
        examStartWithin: data.exam?.startWithin
          ? String(data.exam.startWithin)
          : "",
      }
    : blank
  return (
    <AssignmentEditor
      key={id ?? "new"}
      id={id}
      version={data?.updatedAt}
      forClass={forClass}
      initial={initial}
      template={template}
      fromTemplate={Boolean(data?.templateId)}
      // Students reach problems through the practice pages, so drafts can't be assigned.
      // Chosen problems the picker doesn't offer (a template's shared ones) still show.
      problems={[
        ...problems.data.problems.filter((p) => p.published),
        ...(data?.chosenProblems ?? [])
          .filter((c) => !problems.data.problems.some((p) => p.id === c.id))
          .map((c) => ({ ...c, testCount: 0 })),
      ]}
    />
  )
}

export type FieldErrors = Partial<
  Record<keyof AssignmentForm | "problems" | "peerReview", string>
>

export function AssignmentEditor({
  id,
  version: openedAt,
  forClass,
  initial,
  problems,
  template,
  fromTemplate,
}: {
  template: boolean
  fromTemplate: boolean
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
    // A template has no address or dates; placeholders satisfy the shared rules.
    const placeholderOpens = new Date()
    const parsed = assignmentInputSchema.safeParse({
      title: form.title,
      slug: template ? "template" : form.slug,
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
      opensAt: template
        ? placeholderOpens
        : form.opensAt
          ? new Date(form.opensAt)
          : undefined,
      dueAt: template
        ? new Date(placeholderOpens.getTime() + 3600_000)
        : form.dueAt
          ? new Date(form.dueAt)
          : undefined,
      audience: template ? [] : form.audience.filter((c) => c.length > 0),
      problems: form.problemIds.map((problemId) => ({
        problemId,
        points:
          pointsOf(problemId).trim() === "" ? NaN : Number(pointsOf(problemId)),
        rubric: rubricOf(problemId),
        outcomes: form.outcomes[problemId] ?? [],
      })),
      projects:
        template || form.exam
          ? []
          : form.projects.map((p) => ({
              id: p.id,
              title: p.title,
              instructions: p.instructions,
              points: Number(p.points),
            })),
      peerReview:
        form.peer && !form.exam && !template
          ? {
              reviews:
                form.peerReviews.trim() === "" ? NaN : Number(form.peerReviews),
              anonymous: form.peerAnonymous,
              dueAt: form.peerDueAt
                ? new Date(form.peerDueAt).toISOString()
                : null,
            }
          : null,
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

  const kind = template ? "templates" : "assignments"
  const save = useMutation({
    mutationFn: async (body: NonNullable<ReturnType<typeof validated>>) => {
      const expectedUpdatedAt = overwrite.current ? undefined : version
      overwrite.current = false
      type Saved = { id: string; updatedAt: string }
      const result = id
        ? await api<Saved | { template: Saved; updated: number; kept: number }>(
            owner.api(`/${kind}/${id}`),
            { method: "PUT", body: { ...body, expectedUpdatedAt } }
          )
        : await api<Saved | { template: Saved; updated: number; kept: number }>(
            owner.api(`/${kind}`),
            { body }
          )
      return "template" in result
        ? { ...result.template, updated: result.updated, kept: result.kept }
        : { ...result, updated: 0, kept: 0 }
    },
    onSuccess: (saved, body) => {
      setVersion(saved.updatedAt)
      setConflict(false)
      void queryClient.invalidateQueries({ queryKey: ["admin"] })
      void queryClient.invalidateQueries({ queryKey: ["assignments"] })
      void queryClient.invalidateQueries({ queryKey: ["assignment"] })
      setForm((current) => ({ ...current, published: body.published }))
      setMessage({
        text: template
          ? [
              body.published
                ? "Saved. Ready to use."
                : "Saved as a draft: it can't be used yet.",
              saved.updated > 0 &&
                `${saved.updated} ${saved.updated === 1 ? "use that hasn't opened has" : "uses that haven't opened have"} the changes.`,
              saved.kept > 0 &&
                `${saved.kept} already open ${saved.kept === 1 ? "stays" : "stay"} as ${saved.kept === 1 ? "it was" : "they were"}.`,
            ]
              .filter(Boolean)
              .join(" ")
          : body.published
            ? "Published. Students can see it under Assignments."
            : "Saved as a draft. Only staff can see it.",
        kind: "ok",
      })
      if (template) {
        if (!id) router.push(owner.page(`/templates/${saved.id}`))
      } else if (!id && forClass && owner.orgSlug)
        router.push(orgPages(owner.orgSlug).cls(forClass, "classwork"))
      else if (!id) router.push(owner.page(`/assignments/${saved.id}`))
    },
    onError: (error) => {
      if (
        error instanceof ApiRequestError &&
        error.code === "edited_elsewhere"
      ) {
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
    mutationFn: () => api(owner.api(`/${kind}/${id}`), { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin"] })
      router.push(owner.page(`/${kind}`))
    },
    onError: (error) => setMessage({ text: error.message, kind: "err" }),
  })
  const asTemplate = useMutation({
    mutationFn: () =>
      api<ApiResult<typeof orgTemplateFromAssignment>>(
        owner.api("/templates/from-assignment"),
        {
          body: { assignmentId: id },
        }
      ),
    onSuccess: (row) => router.push(owner.page(`/templates/${row.id}`)),
    onError: (error) => setMessage({ text: error.message, kind: "err" }),
  })

  return (
    <>
      <PageTitle
        action={
          id &&
          !template && (
            <span className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={asTemplate.isPending}
                onClick={() => asTemplate.mutate()}
              >
                Save as template
              </Button>
              <Link
                href={owner.page(`/assignments/${id}/grades`)}
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" })
                )}
              >
                Gradebook
              </Link>
            </span>
          )
        }
      >
        {template
          ? id
            ? "Edit template"
            : "New template"
          : id
            ? "Edit assignment"
            : "New assignment"}
      </PageTitle>
      {template && (
        <p className="mb-3 max-w-3xl text-body-sm text-body">
          A template is an assignment or exam without dates or classes. Use it
          for any number of classes, each with its own dates. Until a use opens,
          saving here brings it your changes; once it opens it stays as it was.
        </p>
      )}
      {fromTemplate && (
        <p
          className="mb-3 rounded-md border border-hairline bg-card p-2 text-caption"
          data-testid="from-template"
        >
          Made from a template. Until it opens, changes to the template replace
          its problems, questions and rules here; its dates and classes stay
          yours.
        </p>
      )}
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
          {!template && (
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
          )}
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

        {!template && (
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
        )}

        {owner.orgSlug && !template && (
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
              {owner.orgSlug && !template && (
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

        {!template && !form.exam && (
          <ProjectsEditor
            projects={form.projects}
            onChange={(projects) => set("projects", projects)}
            error={errors.projects}
          />
        )}

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
              {!template && (
                <div className="grid content-start gap-1">
                  <Field
                    label="Lab networks (optional)"
                    help="One address or range per line, such as 10.1.0.0/16. Students can start and submit only from these. Empty allows anywhere."
                  >
                    <TextArea
                      rows={3}
                      mono
                      value={form.examNetworks}
                      onChange={(event) =>
                        set("examNetworks", event.target.value)
                      }
                    />
                  </Field>
                  <YourAddress />
                </div>
              )}
              <Field
                label="Students must start within (minutes after it opens)"
                help="Keeps a lab starting together, so nobody who has finished can brief a late starter. Empty allows starting any time before the due time."
              >
                <TextInput
                  type="number"
                  min={1}
                  max={1440}
                  value={form.examStartWithin}
                  onChange={(event) =>
                    set("examStartWithin", event.target.value)
                  }
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
                  Some of these problems are in the public library, so anyone
                  can practise them, with hints and editorials, before the exam.
                  For a closed exam, use &ldquo;Write a problem&rdquo; or
                  &ldquo;Import problems&rdquo; above: those stay out of the
                  library.
                </p>
              )}
              <p className="text-caption min-[901px]:col-span-2">
                Problems stay hidden until a student starts. Leaving the page or
                fullscreen and pasting from elsewhere are recorded in the
                gradebook; editorials are closed during the exam. Only work
                submitted during their time counts.
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

        {!template && !form.exam && (
          <div
            className="grid gap-3 rounded-md border border-hairline p-3"
            data-testid="peer-settings"
          >
            <label className="inline-flex items-center gap-2 self-start text-ink">
              <Checkbox
                checked={form.peer}
                onCheckedChange={(checked) => set("peer", checked)}
              />
              Peer review: after the due time, students review classmates&apos;
              final code
            </label>
            {form.peer && (
              <div className="grid gap-3 min-[901px]:grid-cols-3">
                <Field
                  label="Reviews each student writes"
                  help="Per problem; they get as many on their own work."
                >
                  <TextInput
                    type="number"
                    min={1}
                    max={5}
                    value={form.peerReviews}
                    onChange={(event) => set("peerReviews", event.target.value)}
                  />
                </Field>
                <Field
                  label="Reviews due (optional)"
                  help="Empty: they can review any time."
                >
                  <TextInput
                    type="datetime-local"
                    value={form.peerDueAt}
                    onChange={(event) => set("peerDueAt", event.target.value)}
                  />
                </Field>
                <label className="inline-flex items-center gap-2 self-center text-ink">
                  <Checkbox
                    checked={form.peerAnonymous}
                    onCheckedChange={(checked) => set("peerAnonymous", checked)}
                  />
                  Anonymous (teachers still see names)
                </label>
                <p className="text-caption min-[901px]:col-span-3">
                  Start it from the gradebook once the assignment is due.
                  Students score each problem on its rubric (or one overall
                  score) and comment; it never changes marks.
                </p>
              </div>
            )}
            <FieldError message={errors.peerReview} />
          </div>
        )}

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
                {template
                  ? form.published
                    ? "Ready: it can be used for classes."
                    : "Draft: it can't be used yet."
                  : form.published
                    ? "Published: students can see this assignment."
                    : "Draft: students can't see this assignment yet."}
              </span>
            )}
          </span>
          {id && (
            <ConfirmButton
              variant="destructive"
              disabled={remove.isPending}
              title={`Delete ${form.title || (template ? "this template" : "this assignment")}?`}
              description={
                template
                  ? "Assignments made from it stay as they are; they just stop getting its changes."
                  : "Its gradebook goes with it; students' submissions stay in their history. This can't be undone."
              }
              confirmLabel={template ? "Delete template" : "Delete assignment"}
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
            {form.published
              ? template
                ? "Back to draft"
                : "Unpublish"
              : "Save draft"}
          </Button>
          <Button disabled={save.isPending} onClick={() => submit(true)}>
            {template
              ? "Save template"
              : form.published
                ? "Save changes"
                : "Publish"}
          </Button>
        </div>
      </Card>
    </>
  )
}

/** Criteria a teacher marks by hand for one problem, on top of its tests. */
export function RubricEditor({
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
              <p className="text-caption">
                No criteria: tests decide the marks.
              </p>
            )}
            {draft.map((row, index) => (
              <div key={row.id} className="flex items-center gap-2">
                <TextInput
                  aria-label="Criterion"
                  placeholder="Readable names"
                  className="flex-1"
                  value={row.label}
                  onChange={(event) =>
                    edit(index, { label: event.target.value })
                  }
                />
                <TextInput
                  type="number"
                  min={1}
                  aria-label="Criterion points"
                  className="w-20"
                  value={row.points}
                  onChange={(event) =>
                    edit(index, { points: event.target.value })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Remove criterion"
                  onClick={() =>
                    setDraft((rows) => rows.filter((_, i) => i !== index))
                  }
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
                  {
                    id: crypto.randomUUID().slice(0, 8),
                    label: "",
                    points: "10",
                  },
                ])
              }
            >
              Add criterion
            </Button>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
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

export type CourseOutcomeOption = ApiResult<typeof orgCourseOutcomes>[number]

/** Which course outcomes a problem assesses, chosen from every course in the organization. */
export function OutcomeTagger({
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
      !query || `${o.course} ${o.code} ${o.title}`.toLowerCase().includes(query)
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
                    <div className="text-caption font-medium text-ink">
                      {course}
                    </div>
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
