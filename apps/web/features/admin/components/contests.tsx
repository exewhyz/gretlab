"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState, type ReactNode } from "react"

import { Button, buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"
import { Checkbox } from "@workspace/ui/components/checkbox"

import {
  Field,
  FormMessage,
  SelectInput,
  TextArea,
  TextInput,
} from "@/components/form"
import { ConfirmButton } from "@/components/confirm"
import { PhaseBadge } from "@/features/contests/components/contest-list"
import { contestInputSchema, slugify } from "@/features/problems/schemas"
import { api, ApiRequestError } from "@/lib/api/client"
import { formatDateTime } from "@/lib/format"
import { useOwner } from "@/features/admin/owner"
import { AudiencePicker } from "./audience"

import type { StaffProblemList } from "./problems"
import { Card, Loading, PageTitle, Table } from "./shell"

interface ContestRow {
  id: string
  slug: string
  title: string
  startsAt: string
  endsAt: string
  scoring: string
  published: boolean
  phase: "upcoming" | "live" | "ended"
  participants: number
}

export function AdminContests() {
  const owner = useOwner()
  const { data, error } = useQuery({
    queryKey: owner.key("contests"),
    queryFn: () => api<ContestRow[]>(owner.api("/contests")),
  })
  if (!data) return <Loading error={error} />
  return (
    <>
      <PageTitle
        action={
          <Link
            href={owner.page("/contests/new")}
            className={cn(buttonVariants({ size: "sm" }))}
          >
            New contest
          </Link>
        }
      >
        Contests
      </PageTitle>
      {data.length === 0 ? (
        <p className="text-body-sm text-body">
          No contests yet. Create one to get started.
        </p>
      ) : (
        <Table
          headers={[
            "Title",
            "Status",
            "Starts",
            "Ends",
            "Scoring",
            "Registered",
            "",
          ]}
        >
          {data.map((contest) => (
            <tr key={contest.id}>
              <td>
                <Link
                  href={owner.page(`/contests/${contest.id}`)}
                  className="underline-offset-2 hover:underline"
                >
                  {contest.title}
                </Link>
              </td>
              <td>
                <PhaseBadge
                  phase={contest.phase}
                  published={contest.published}
                />
              </td>
              <td className="whitespace-nowrap">
                {formatDateTime(contest.startsAt)}
              </td>
              <td className="whitespace-nowrap">
                {formatDateTime(contest.endsAt)}
              </td>
              <td className="uppercase">{contest.scoring}</td>
              <td className="tabular-nums">{contest.participants}</td>
              <td>
                <Link
                  href={`/contests/${contest.slug}`}
                  className="underline underline-offset-2"
                >
                  View
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </>
  )
}

/** datetime-local works in the viewer's own timezone. */
export function toLocalInput(value: Date | string) {
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 16)
}

interface ContestForm {
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
  /** Organization groups it's for; empty for everyone. */
  audience: string[][]
}

interface StoredContest extends Omit<
  ContestForm,
  "penaltyMinutes" | "freezeMinutes"
> {
  penaltyMinutes: number
  freezeMinutes: number
}

function blankForm(): ContestForm {
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
    audience: [],
  }
}

export function ContestEditorPage({ id }: { id: string | null }) {
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
      }
    : blankForm()
  return (
    <ContestEditor
      key={id ?? "new"}
      id={id}
      initial={initial}
      problems={problems.data.problems}
    />
  )
}

type FieldErrors = Partial<Record<keyof ContestForm, string>>

function describeDuration(startsAt: string, endsAt: string) {
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

export function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p role="alert" className="text-xs text-destructive">
      {message}
    </p>
  )
}

export function ProblemPicker({
  problems,
  selected,
  onChange,
  error,
  orderLabel = "In the contest, in this order",
  marker = (index) => String.fromCharCode(65 + index),
  extra,
}: {
  problems: StaffProblemList["problems"]
  selected: string[]
  onChange: (ids: string[]) => void
  error?: string
  orderLabel?: string
  marker?: (index: number) => string
  /** Extra controls on each chosen problem, such as its points. */
  extra?: (id: string) => ReactNode
}) {
  const [search, setSearch] = useState("")
  const [level, setLevel] = useState("")
  const byId = useMemo(
    () => new Map(problems.map((problem) => [problem.id, problem])),
    [problems]
  )
  const available = problems.filter(
    (problem) =>
      !selected.includes(problem.id) &&
      (!level || problem.level === level) &&
      problem.title.toLowerCase().includes(search.trim().toLowerCase())
  )
  const move = (index: number, delta: -1 | 1) => {
    const next = [...selected]
    const [item] = next.splice(index, 1)
    if (item) next.splice(index + delta, 0, item)
    onChange(next)
  }

  return (
    <div className="grid gap-2">
      <div className="text-caption font-semibold text-ink">
        Problems ({selected.length})
      </div>
      <div className="grid gap-3 min-[901px]:grid-cols-2">
        <div className="rounded-md border border-hairline p-2.5">
          <div className="mb-2 flex gap-2">
            <TextInput
              aria-label="Search problems"
              placeholder="Search problems"
              className="py-1"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <SelectInput
              aria-label="Filter by level"
              className="w-28 py-1"
              value={level}
              onChange={(event) => setLevel(event.target.value)}
            >
              <option value="">Any level</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </SelectInput>
          </div>
          <ul className="grid max-h-64 gap-0.5 overflow-auto">
            {available.map((problem) => (
              <li key={problem.id}>
                <Button
                  type="button"
                  variant="ghost"
                  aria-label={`Add ${problem.title}`}
                  className="h-auto w-full justify-start gap-2 rounded-sm px-2 py-1 text-left text-body-sm font-normal whitespace-normal"
                  onClick={() => onChange([...selected, problem.id])}
                >
                  <span className="flex-none text-muted-foreground">+</span>
                  <span className="min-w-0 flex-1 text-ink">
                    {problem.title}
                  </span>
                  <span className="text-xs capitalize">{problem.level}</span>
                  {!problem.published && (
                    <span
                      className="text-xs"
                      title="Only visible through this contest"
                    >
                      Draft
                    </span>
                  )}
                </Button>
              </li>
            ))}
            {available.length === 0 && (
              <li className="px-2 py-1 text-caption">Nothing matches.</li>
            )}
          </ul>
        </div>

        <div className="rounded-md border border-hairline p-2.5">
          <div className="mb-2 text-caption">{orderLabel}</div>
          {selected.length === 0 && (
            <p className="px-2 py-1 text-caption">
              Add problems from the list.
            </p>
          )}
          <ol className="grid gap-0.5">
            {selected.map((id, index) => (
              <li
                key={id}
                data-testid="selected-problem"
                className="flex items-center gap-2 rounded-sm px-2 py-1 hover:bg-muted"
              >
                <b className="w-5 flex-none text-ink">{marker(index)}</b>
                <span className="min-w-0 flex-1 text-ink">
                  {byId.get(id)?.title ?? "Unknown problem"}
                </span>
                {extra?.(id)}
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Move up"
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Move down"
                  disabled={index === selected.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Remove ${byId.get(id)?.title ?? ""}`}
                  onClick={() =>
                    onChange(selected.filter((item) => item !== id))
                  }
                >
                  ✕
                </Button>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <FieldError message={error} />
    </div>
  )
}

function ContestEditor({
  id,
  initial,
  problems,
}: {
  id: string | null
  initial: ContestForm
  problems: StaffProblemList["problems"]
}) {
  const owner = useOwner()
  const router = useRouter()
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
    mutationFn: (body: NonNullable<ReturnType<typeof validated>>) =>
      id
        ? api<{ id: string }>(owner.api(`/contests/${id}`), {
            method: "PUT",
            body,
          })
        : api<{ id: string }>(owner.api("/contests"), { body }),
    onSuccess: (saved, body) => {
      void queryClient.invalidateQueries({ queryKey: ["admin"] })
      void queryClient.invalidateQueries({ queryKey: ["contests"] })
      setForm((current) => ({ ...current, published: body.published }))
      setMessage({
        text: body.published
          ? "Published. Students can see it and register."
          : "Saved as a draft. Only staff can see it.",
        kind: "ok",
      })
      if (!id) router.push(owner.page(`/contests/${saved.id}`))
    },
    onError: (error) => {
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
