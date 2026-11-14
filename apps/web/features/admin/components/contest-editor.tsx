"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useRef, useState } from "react"

import { Button, buttonVariants } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { cn } from "@workspace/ui/lib/utils"

import { ConfirmButton } from "@/components/confirm"
import {
  Field,
  FormMessage,
  SelectInput,
  TextArea,
  TextInput,
} from "@/components/form"
import { SaveConflict } from "@/components/save-conflict"
import { useOwner } from "@/features/admin/owner"
import { contestInputSchema, slugify } from "@/features/problems/schemas"
import { api, ApiRequestError } from "@/lib/api/client"
import { AudiencePicker } from "./audience"

import type { orgContest, saveOrgContest } from "@/features/orgs/content"
import { QuestionPicker } from "@/features/questions/components/question-picker"
import type { ApiResult } from "@/lib/api/types"
import { orgPages } from "@/lib/paths"
import { FieldError, ProblemPicker, toLocalInput } from "./contest-parts"
import type { StaffProblemList } from "./problems"
import { Card, Loading, PageTitle } from "./shell"

export interface ContestForm {
  slug: string
  title: string
  description: string
  startsAt: string
  endsAt: string
  scoring: "icpc" | "ioi"
  /** Text while editing, so a field can be cleared without turning into 0. */
  penaltyMinutes: string
  freezeMinutes: string
  published: boolean
  registrationOpen: boolean
  problemIds: string[]
  /** Bank questions that mark themselves, with points as typed. */
  questions: { questionId: string; points: string }[]
  /** Organization groups it's for; empty for everyone. */
  audience: string[][]
}

export type StoredContest = ApiResult<typeof orgContest>

/** A new one; made from a class page, it's for that class. */
export function blankForm(forClass: string | null): ContestForm {
  const start = new Date(Date.now() + 24 * 60 * 60_000)
  start.setMinutes(0, 0, 0)
  return {
    slug: "",
    title: "",
    description: "",
    startsAt: toLocalInput(start),
    endsAt: toLocalInput(new Date(start.getTime() + 2 * 60 * 60_000)),
    scoring: "icpc",
    penaltyMinutes: "20",
    freezeMinutes: "0",
    published: false,
    registrationOpen: true,
    problemIds: [],
    questions: [],
    audience: forClass ? [[forClass]] : [],
  }
}

export function ContestEditorPage({
  id,
  forClass = null,
}: {
  id: string | null
  /** Started from a class page: aimed at that class, and back there after saving. */
  forClass?: string | null
}) {
  const owner = useOwner()
  const { data, error } = useQuery({
    queryKey: owner.key("contest", id),
    queryFn: () => api<StoredContest>(owner.api(`/contests/${id}`)),
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
  const initial: ContestForm = data
    ? {
        ...data,
        startsAt: toLocalInput(data.startsAt),
        endsAt: toLocalInput(data.endsAt),
        penaltyMinutes: String(data.penaltyMinutes),
        freezeMinutes: String(data.freezeMinutes),
        questions: (data.questions ?? []).map((q) => ({
          questionId: q.questionId,
          points: String(q.points),
        })),
      }
    : blankForm(forClass)
  return (
    <ContestEditor
      key={id ?? "new"}
      id={id}
      version={data?.updatedAt}
      forClass={forClass}
      initial={initial}
      problems={problems.data.problems}
    />
  )
}

export type FieldErrors = Partial<Record<keyof ContestForm, string>>

export function describeDuration(startsAt: string, endsAt: string) {
  const minutes = Math.round(
    (new Date(endsAt).getTime() - new Date(startsAt).getTime()) / 60_000
  )
  if (!Number.isFinite(minutes) || minutes <= 0) return null
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return [hours && `${hours} h`, rest && `${rest} min`]
    .filter(Boolean)
    .join(" ")
}

export function ContestEditor({
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
  initial: ContestForm
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
  // The address follows the title until someone types their own.
  const [slugTouched, setSlugTouched] = useState(Boolean(id))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [message, setMessage] = useState<{
    text: string
    kind?: "ok" | "err"
  } | null>(null)

  const set = <K extends keyof ContestForm>(key: K, value: ContestForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
    setMessage(null)
  }

  const started = id !== null && new Date(initial.startsAt) <= new Date()
  const duration = describeDuration(form.startsAt, form.endsAt)
  const startsInPast = !started && new Date(form.startsAt) < new Date()

  /** Checks with the same rules as the server, to show errors beside their fields. */
  function validated(published: boolean) {
    const parsed = contestInputSchema.safeParse({
      title: form.title,
      slug: form.slug,
      description: form.description,
      scoring: form.scoring,
      registrationOpen: form.registrationOpen,
      problemIds: form.problemIds,
      questions: form.questions.map((q) => ({
        questionId: q.questionId,
        points: q.points.trim() === "" ? NaN : Number(q.points),
      })),
      audience: form.audience.filter((c) => c.length > 0),
      published,
      penaltyMinutes:
        form.penaltyMinutes.trim() === "" ? NaN : Number(form.penaltyMinutes),
      freezeMinutes:
        form.freezeMinutes.trim() === "" ? NaN : Number(form.freezeMinutes),
      startsAt: form.startsAt ? new Date(form.startsAt) : undefined,
      endsAt: form.endsAt ? new Date(form.endsAt) : undefined,
    })
    if (parsed.success) {
      setErrors({})
      return parsed.data
    }
    const found: FieldErrors = {}
    for (const issue of parsed.error.issues) {
      const key = issue.path[0] as keyof ContestForm
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
        ? api<ApiResult<typeof saveOrgContest>>(owner.api(`/contests/${id}`), {
            method: "PUT",
            body: { ...body, expectedUpdatedAt },
          })
        : api<ApiResult<typeof saveOrgContest>>(owner.api("/contests"), {
            body,
          })
    },
    onSuccess: (saved, body) => {
      setVersion(saved.updatedAt)
      setConflict(false)
      void queryClient.invalidateQueries({ queryKey: ["admin"] })
      void queryClient.invalidateQueries({ queryKey: ["contests"] })
      setForm((current) => ({ ...current, published: body.published }))
      setMessage({
        text: body.published
          ? "Published. Students can see it and register."
          : "Saved as a draft. Only staff can see it.",
        kind: "ok",
      })
      if (!id && forClass && owner.orgSlug)
        router.push(orgPages(owner.orgSlug).cls(forClass, "classwork"))
      else if (!id) router.push(owner.page(`/contests/${saved.id}`))
    },
    onError: (error) => {
      if (
        error instanceof ApiRequestError &&
        error.code === "edited_elsewhere"
      ) {
        setConflict(true)
      }
      if (error instanceof ApiRequestError && error.code === "conflict") {
        setErrors({ slug: "Another contest already uses this address." })
      }
      setMessage({ text: error.message, kind: "err" })
    },
  })

  const submit = (published: boolean) => {
    const body = validated(published)
    if (body) save.mutate(body)
  }

  const remove = useMutation({
    mutationFn: () => api(owner.api(`/contests/${id}`), { method: "DELETE" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin"] })
      router.push(owner.page("/contests"))
    },
    onError: (error) => setMessage({ text: error.message, kind: "err" }),
  })

  return (
    <>
      <PageTitle
        action={
          id && (
            <Link
              href={`/contests/${form.slug}`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              View contest page
            </Link>
          )
        }
      >
        {id ? "Edit contest" : "New contest"}
      </PageTitle>
      <Card className="grid gap-5">
        {started && (
          <p className="rounded-md border border-hairline-strong bg-canvas-soft p-3 text-caption text-ink">
            This contest has already started. Changing its times or problems
            affects students right now.
          </p>
        )}

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
              help={`Its page will be /contests/${form.slug || "your-address"}`}
            >
              <TextInput
                value={form.slug}
                placeholder="midterm-2026"
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
          label="Description"
          help="Optional. Students see it on the contest page."
        >
          <TextArea
            rows={2}
            value={form.description}
            onChange={(event) => set("description", event.target.value)}
          />
        </Field>

        <div className="grid gap-1.5">
          <div className="grid gap-3 min-[901px]:grid-cols-2">
            <div className="grid content-start gap-1.5">
              <Field label="Starts">
                <TextInput
                  type="datetime-local"
                  value={form.startsAt}
                  aria-invalid={Boolean(errors.startsAt)}
                  onChange={(event) => set("startsAt", event.target.value)}
                />
              </Field>
              <FieldError message={errors.startsAt} />
            </div>
            <div className="grid content-start gap-1.5">
              <Field label="Ends">
                <TextInput
                  type="datetime-local"
                  value={form.endsAt}
                  aria-invalid={Boolean(errors.endsAt)}
                  onChange={(event) => set("endsAt", event.target.value)}
                />
              </Field>
              <FieldError message={errors.endsAt} />
            </div>
          </div>
          <p className="text-xs">
            Your timezone: {Intl.DateTimeFormat().resolvedOptions().timeZone}
            {duration && ` · Lasts ${duration}`}
            {startsInPast && " · Starts immediately, as this time has passed"}
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
          error={errors.problemIds}
        />

        <QuestionPicker
          selected={form.questions}
          onChange={(questions) => set("questions", questions)}
          autoOnly
          label="Quiz questions (answered once, marked at once)"
        />

        <div className="grid gap-3 min-[901px]:grid-cols-3">
          <Field
            label="Scoring"
            help={
              form.scoring === "icpc"
                ? "ICPC: most problems solved wins, then least time and penalties."
                : "IOI: points per test passed, best score per problem."
            }
          >
            <SelectInput
              value={form.scoring}
              onChange={(event) =>
                set("scoring", event.target.value as ContestForm["scoring"])
              }
            >
              <option value="icpc">ICPC</option>
              <option value="ioi">IOI</option>
            </SelectInput>
          </Field>
          {form.scoring === "icpc" && (
            <div className="grid content-start gap-1.5">
              <Field label="Penalty per wrong attempt (minutes)">
                <TextInput
                  type="number"
                  min={0}
                  value={form.penaltyMinutes}
                  aria-invalid={Boolean(errors.penaltyMinutes)}
                  onChange={(event) =>
                    set("penaltyMinutes", event.target.value)
                  }
                />
              </Field>
              <FieldError message={errors.penaltyMinutes} />
            </div>
          )}
          <div className="grid content-start gap-1.5">
            <Field
              label="Freeze the board before the end (minutes)"
              help="0 keeps the board live throughout."
            >
              <TextInput
                type="number"
                min={0}
                value={form.freezeMinutes}
                aria-invalid={Boolean(errors.freezeMinutes)}
                onChange={(event) => set("freezeMinutes", event.target.value)}
              />
            </Field>
            <FieldError message={errors.freezeMinutes} />
          </div>
        </div>

        <label className="inline-flex items-center gap-2 text-ink">
          <Checkbox
            checked={form.registrationOpen}
            onCheckedChange={(checked) => set("registrationOpen", checked)}
          />
          Registration open
        </label>

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
                  ? "Published: students can see this contest."
                  : "Draft: students can't see this contest yet."}
              </span>
            )}
          </span>
          {id && (
            <ConfirmButton
              variant="destructive"
              disabled={remove.isPending}
              title={`Delete ${form.title || "this contest"}?`}
              description="Its leaderboard and registrations go with it; submissions stay in students' history. This can't be undone."
              confirmLabel="Delete contest"
              onConfirm={() => remove.mutate()}
            >
              Delete
            </ConfirmButton>
          )}
          {form.published ? (
            <>
              <Button
                variant="outline"
                disabled={save.isPending}
                onClick={() => submit(false)}
              >
                Unpublish
              </Button>
              <Button disabled={save.isPending} onClick={() => submit(true)}>
                Save changes
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={save.isPending}
                onClick={() => submit(false)}
              >
                Save draft
              </Button>
              <Button disabled={save.isPending} onClick={() => submit(true)}>
                Publish
              </Button>
            </>
          )}
        </div>
      </Card>
    </>
  )
}
