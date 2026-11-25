"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { MIN_RESPONSES, type FeedbackQuestion } from "@workspace/judge"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"

import { ConfirmButton } from "@/components/confirm"
import { DetailSheet } from "@/components/detail-sheet"
import { EditorSheet } from "@/components/editor-sheet"
import { Field, TextArea, TextInput } from "@/components/form"
import {
  Card,
  Loading,
  PageTitle,
  Table,
} from "@/features/admin/components/shell"
import { toLocalInput } from "@/features/admin/components/contest-parts"
import type {
  listRounds,
  roundResults,
} from "@/features/feedback-rounds/server"
import { GroupChecklist } from "@/features/orgs/components/group-checklist"
import { QuestionsEditor } from "./questions-editor"
import type { listGroups } from "@/features/orgs/server"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { formatDate } from "@/lib/format"

type Round = ApiResult<typeof listRounds>[number]
type Results = ApiResult<typeof roundResults>

const PHASE = { upcoming: "Upcoming", open: "Open", closed: "Closed" } as const

/**
 * Manage › Feedback rounds: open a round for some classes, where students rate the teachers of
 * their subjects; see every teacher's results (never who answered, nothing below a few answers).
 */
export function ManageFeedbackRounds({ slug }: { slug: string }) {
  const client = useQueryClient()
  const [editing, setEditing] = useState<Round | "new" | null>(null)
  const [viewing, setViewing] = useState<Round | null>(null)
  const { data, error } = useQuery({
    queryKey: ["org", slug, "feedback-rounds"],
    queryFn: () => api<Round[]>(`/orgs/${slug}/feedback-rounds`),
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/orgs/${slug}/feedback-rounds/${id}`, { method: "DELETE" }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["org", slug, "feedback-rounds"] }),
    meta: { success: "Round deleted." },
  })
  if (!data) return <Loading error={error} />
  return (
    <>
      {editing && (
        <RoundEditor
          slug={slug}
          round={editing === "new" ? null : editing}
          onDone={() => setEditing(null)}
        />
      )}
      {viewing && (
        <RoundResults
          slug={slug}
          round={viewing}
          onClose={() => setViewing(null)}
        />
      )}
      <PageTitle
        action={
          <Button size="sm" onClick={() => setEditing("new")}>
            New round
          </Button>
        }
      >
        Feedback rounds
      </PageTitle>
      <p className="mb-3 max-w-3xl text-body-sm text-body">
        Students of the classes you choose rate each teacher of their subjects.
        Teachers see their own results, you see everyone&apos;s; nobody sees who
        answered, and results show once {MIN_RESPONSES} students have answered.
      </p>
      {data.length === 0 ? (
        <Card>
          <p className="text-body-sm text-body">No feedback rounds yet.</p>
        </Card>
      ) : (
        <Card>
          <Table headers={["Round", "Classes", "Dates", "Answers", ""]}>
            {data.map((r) => (
              <tr key={r.id} data-testid="feedback-round">
                <td className="text-ink">
                  {r.title}{" "}
                  <Badge variant={r.phase === "open" ? "default" : "secondary"}>
                    {PHASE[r.phase]}
                  </Badge>
                </td>
                <td className="text-body">
                  {r.classes.join(", ")}
                  <div className="text-caption">
                    {r.subjects.length
                      ? r.subjects.join(", ")
                      : "Every subject"}
                  </div>
                </td>
                <td className="text-body">
                  {formatDate(r.opensAt)} to {formatDate(r.closesAt)}
                </td>
                <td className="text-body tabular-nums">{r.responses}</td>
                <td className="text-right whitespace-nowrap">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setViewing(r)}
                  >
                    Results
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setEditing(r)}
                  >
                    Edit
                  </Button>
                  <ConfirmButton
                    variant="ghost"
                    size="xs"
                    title={`Delete "${r.title}"?`}
                    description="Its answers go with it. This can't be undone."
                    confirmLabel="Delete round"
                    onConfirm={() => remove.mutate(r.id)}
                  >
                    Delete
                  </ConfirmButton>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  )
}

/** A new round starts from the platform's feedback form (Dashboard › Feedback form). */
function RoundEditor({
  slug,
  round,
  onDone,
}: {
  slug: string
  round: Round | null
  onDone: () => void
}) {
  const form = useQuery({
    queryKey: ["org", slug, "feedback-form"],
    queryFn: () =>
      api<FeedbackQuestion[]>(`/orgs/${slug}/feedback-rounds/form`),
    enabled: round === null,
  })
  if (round)
    return (
      <RoundForm
        slug={slug}
        round={round}
        start={round.questions as FeedbackQuestion[]}
        onDone={onDone}
      />
    )
  if (!form.data)
    return (
      <DetailSheet title="New feedback round" onClose={onDone}>
        <Loading error={form.error} />
      </DetailSheet>
    )
  return (
    <RoundForm slug={slug} round={null} start={form.data} onDone={onDone} />
  )
}

function RoundForm({
  slug,
  round,
  start,
  onDone,
}: {
  slug: string
  round: Round | null
  start: FeedbackQuestion[]
  onDone: () => void
}) {
  const client = useQueryClient()
  const groups = useQuery({
    queryKey: ["org", slug, "groups"],
    queryFn: () => api<ApiResult<typeof listGroups>>(`/orgs/${slug}/groups`),
  })
  const week = new Date(Date.now() + 7 * 86_400_000)
  const [title, setTitle] = useState(round?.title ?? "")
  const [description, setDescription] = useState(round?.description ?? "")
  const [groupIds, setGroupIds] = useState<string[]>(round?.groupIds ?? [])
  const [subjectIds, setSubjectIds] = useState<string[]>(
    round?.subjectIds ?? []
  )
  const subjects = useQuery({
    queryKey: ["org", slug, "feedback-rounds", "subjects"],
    queryFn: () =>
      api<{ id: string; name: string }[]>(
        `/orgs/${slug}/feedback-rounds/subjects`
      ),
  })
  const [opensAt, setOpensAt] = useState(
    toLocalInput(round?.opensAt ?? new Date())
  )
  const [closesAt, setClosesAt] = useState(
    toLocalInput(round?.closesAt ?? week)
  )
  const [questions, setQuestions] = useState<FeedbackQuestion[]>(start)
  const save = useMutation({
    mutationFn: () => {
      const body = {
        title,
        description,
        groupIds,
        subjectIds,
        questions,
        opensAt: new Date(opensAt),
        closesAt: new Date(closesAt),
      }
      return round
        ? api(`/orgs/${slug}/feedback-rounds/${round.id}`, {
            method: "PUT",
            body,
          })
        : api(`/orgs/${slug}/feedback-rounds`, { body })
    },
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["org", slug, "feedback-rounds"],
      })
      onDone()
    },
    meta: { quiet: true },
  })
  return (
    <EditorSheet
      title={round ? `Edit ${round.title}` : "New feedback round"}
      description="Students of these classes rate each teacher of their subjects (from Subjects) while it's open."
      error={save.error?.message}
      submitLabel={round ? "Save round" : "Open round"}
      submitDisabled={save.isPending || !title.trim() || groupIds.length === 0}
      onSubmit={() => save.mutate()}
      onClose={onDone}
      testId="round-editor"
    >
      <Field label="Title">
        <TextInput
          value={title}
          placeholder="Semester 1 faculty feedback"
          onChange={(e) => setTitle(e.target.value)}
        />
      </Field>
      <Field
        label="Note to students"
        help="Optional. Shown above the questions."
      >
        <TextArea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Opens">
          <TextInput
            type="datetime-local"
            value={opensAt}
            onChange={(e) => setOpensAt(e.target.value)}
          />
        </Field>
        <Field label="Closes">
          <TextInput
            type="datetime-local"
            value={closesAt}
            onChange={(e) => setClosesAt(e.target.value)}
          />
        </Field>
      </div>
      <Field
        label="Classes"
        help="Students sitting in these (and the groups inside them) answer."
      >
        {groups.data ? (
          <GroupChecklist
            groups={groups.data.groups}
            levels={groups.data.levels}
            value={groupIds}
            onChange={setGroupIds}
          />
        ) : (
          <Loading error={groups.error} />
        )}
      </Field>
      <Field
        label="Subjects"
        help="Only these subjects' teachers are rated. None ticked: every subject."
      >
        {subjects.data ? (
          subjects.data.length === 0 ? (
            <p className="text-caption">
              No subjects yet: add them under Subjects, with their teachers.
            </p>
          ) : (
            <div
              className="flex flex-wrap gap-x-4 gap-y-2"
              data-testid="round-subjects"
            >
              {subjects.data.map((x) => (
                <label
                  key={x.id}
                  className="flex items-center gap-2 text-body-sm"
                >
                  <Checkbox
                    checked={subjectIds.includes(x.id)}
                    onCheckedChange={(on) =>
                      setSubjectIds(
                        on
                          ? [...subjectIds, x.id]
                          : subjectIds.filter((id) => id !== x.id)
                      )
                    }
                  />
                  {x.name}
                </label>
              ))}
            </div>
          )
        ) : (
          <Loading error={subjects.error} />
        )}
      </Field>
      <QuestionsEditor questions={questions} onChange={setQuestions} />
    </EditorSheet>
  )
}

function RoundResults({
  slug,
  round,
  onClose,
}: {
  slug: string
  round: Round
  onClose: () => void
}) {
  const { data, error } = useQuery({
    queryKey: ["org", slug, "feedback-rounds", round.id, "results"],
    queryFn: () =>
      api<Results>(`/orgs/${slug}/feedback-rounds/${round.id}/results`),
  })
  return (
    <DetailSheet
      title={round.title}
      description="Each teacher's results by subject and class. Nobody sees who answered."
      onClose={onClose}
      testId="round-results"
    >
      {!data ? (
        <Loading error={error} />
      ) : (
        <Tabs defaultValue="teachers">
          <TabsList>
            <TabsTrigger value="teachers">By teacher</TabsTrigger>
            <TabsTrigger value="subjects">By subject</TabsTrigger>
          </TabsList>
          <TabsContent value="teachers" className="mt-3">
            <ResultLines lines={data.lines} />
          </TabsContent>
          <TabsContent value="subjects" className="mt-3">
            <SubjectLines lines={data.bySubject} />
          </TabsContent>
        </Tabs>
      )}
    </DetailSheet>
  )
}

/** One line per teacher, subject and class: averages and comments, or only a count below the minimum. */
export function ResultLines({ lines }: { lines: Results["lines"] }) {
  if (lines.length === 0)
    return <p className="text-body-sm text-body">No answers yet.</p>
  return (
    <div className="grid gap-3">
      {lines.map((l) => (
        <Card key={`${l.teacher}|${l.subject}|${l.group}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-ink">
              {l.teacher} · {l.subject}{" "}
              <span className="text-caption text-body">({l.group})</span>
            </div>
            <div className="text-caption text-body">
              {l.responses} {l.responses === 1 ? "answer" : "answers"}
              {l.overall !== null && (
                <>
                  {" · "}
                  <span
                    className="font-semibold text-ink"
                    data-testid="overall"
                  >
                    {l.overall.toFixed(1)}
                  </span>{" "}
                  out of 5
                </>
              )}
            </div>
          </div>
          {!l.shown ? (
            <p className="mt-2 text-caption text-body" data-testid="too-few">
              Shown once {MIN_RESPONSES} students have answered, so nobody can
              be picked out.
            </p>
          ) : (
            <>
              <dl className="mt-2 grid gap-1 text-body-sm">
                {l.questions.map((q) => (
                  <div key={q.id} className="flex justify-between gap-3">
                    <dt className="text-body">{q.text}</dt>
                    <dd className="text-ink tabular-nums">
                      {q.average.toFixed(1)}
                    </dd>
                  </div>
                ))}
              </dl>
              {l.comments.length > 0 && (
                <ul className="mt-2 grid gap-1 border-t border-hairline pt-2 text-body-sm text-body">
                  {l.comments.map((c, i) => (
                    <li key={i}>&ldquo;{c}&rdquo;</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Card>
      ))}
    </div>
  )
}

/** Each subject across all its teachers and classes (for whoever runs rounds). */
function SubjectLines({ lines }: { lines: Results["bySubject"] }) {
  if (lines.length === 0)
    return <p className="text-body-sm text-body">No answers yet.</p>
  return (
    <div className="grid gap-3">
      {lines.map((l) => (
        <Card key={l.subjectId} data-testid="subject-line">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-ink">
              {l.subject}{" "}
              <span className="text-caption text-body">
                ({l.teachers} {l.teachers === 1 ? "teacher" : "teachers"})
              </span>
            </div>
            <div className="text-caption text-body">
              {l.responses} {l.responses === 1 ? "answer" : "answers"}
              {l.overall !== null && (
                <>
                  {" · "}
                  <span className="font-semibold text-ink">
                    {l.overall.toFixed(1)}
                  </span>{" "}
                  out of 5
                </>
              )}
            </div>
          </div>
          {!l.shown ? (
            <p className="mt-2 text-caption text-body">
              Shown once {MIN_RESPONSES} students have answered, so nobody can
              be picked out.
            </p>
          ) : (
            <dl className="mt-2 grid gap-1 text-body-sm">
              {l.questions.map((q) => (
                <div key={q.id} className="flex justify-between gap-3">
                  <dt className="text-body">{q.text}</dt>
                  <dd className="text-ink tabular-nums">
                    {q.average.toFixed(1)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </Card>
      ))}
    </div>
  )
}
