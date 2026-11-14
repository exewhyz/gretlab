"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

import { Field, FormMessage, SelectInput } from "@/components/form"
import { QuestionPicker } from "@/features/questions/components/question-picker"
import { api } from "@/lib/api/client"

import type { StaffProblemList } from "./problems"
import { Loading, PageTitle, Table } from "./shell"
import type { ApiResult } from "@/lib/api/types"
import type { getDailySchedule } from "@/features/catalog/server"
import { formatDay } from "@/lib/format"

type Day = ApiResult<typeof getDailySchedule>[number]

/** Most questions a day can have (matches the server). */
const MAX_QUESTIONS = 10

/** The daily challenge for the next two weeks: one compact row a day, edited in a dialog. */
export function AdminDaily() {
  const { data, error } = useQuery({
    queryKey: ["admin", "daily"],
    queryFn: () => api<Day[]>("/admin/daily"),
  })
  const problems = useQuery({
    queryKey: ["admin", "problems"],
    queryFn: () => api<StaffProblemList>("/admin/problems"),
  })
  const [editing, setEditing] = useState<Day | null>(null)
  if (!data || !problems.data)
    return <Loading error={error ?? problems.error} />
  const published = problems.data.problems.filter(
    (problem) => problem.published && problem.listed
  )
  return (
    <>
      <PageTitle>Daily challenge</PageTitle>
      <p className="mb-3 text-body-sm text-body">
        Each day has a problem, quiz questions (up to {MAX_QUESTIONS}), or both.
        Days left on automatic get a different published problem each day.
        Students answer each question once and see why at once; a right answer
        keeps their streak. Days follow the timezone in Settings.
      </p>
      <Table headers={["Day", "Problem", "Questions", ""]}>
        {data.map((row) => (
          <tr key={row.day} data-testid="daily-day">
            <td className="w-32 whitespace-nowrap tabular-nums">{formatDay(row.day)}</td>
            <td>
              {row.scheduled ? (
                <span className="text-ink">{row.scheduled.title}</span>
              ) : row.questions.length ? (
                <span className="text-body">No problem</span>
              ) : (
                <span className="text-body">
                  Automatic{row.automatic ? `: ${row.automatic.title}` : ""}
                </span>
              )}
            </td>
            <td className="max-w-80">
              {row.questions.length === 0 ? (
                <span className="text-body">None</span>
              ) : (
                <span
                  className="block truncate"
                  title={row.questions
                    .map((q, i) => `Q${i + 1}. ${q.title}`)
                    .join("\n")}
                >
                  <span className="text-ink">
                    {row.questions.length}{" "}
                    {row.questions.length === 1 ? "question" : "questions"}
                  </span>
                  <span className="text-body">
                    : {row.questions.map((q) => q.title).join(", ")}
                  </span>
                </span>
              )}
            </td>
            <td className="w-20 text-right">
              <Button
                size="sm"
                variant="outline"
                aria-label={`Edit ${row.day}`}
                onClick={() => setEditing(row)}
              >
                Edit
              </Button>
            </td>
          </tr>
        ))}
      </Table>
      {editing && (
        <DayDialog
          key={editing.day}
          day={editing}
          problems={published}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

/** One day: its problem, and its questions in order, saved together. */
function DayDialog({
  day,
  problems,
  onClose,
}: {
  day: Day
  problems: StaffProblemList["problems"]
  onClose: () => void
}) {
  const client = useQueryClient()
  const [problem, setProblem] = useState(day.scheduled?.slug ?? "")
  const [questions, setQuestions] = useState(
    day.questions.map((q) => ({ questionId: q.id, points: "1" }))
  )
  const save = useMutation({
    mutationFn: () =>
      api("/admin/daily", {
        method: "PUT",
        body: {
          day: day.day,
          problemSlug: problem || null,
          questionIds: questions.map((q) => q.questionId),
        },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["admin", "daily"] })
      void client.invalidateQueries({ queryKey: ["daily"] })
      onClose()
    },
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="max-h-[92dvh] overflow-y-auto sm:max-w-4xl"
        data-testid="daily-dialog"
      >
        <DialogHeader>
          <DialogTitle>Daily challenge · {formatDay(day.day)}</DialogTitle>
          <DialogDescription>
            Pick the problem and the questions, in the order students see them.
            Only questions that mark themselves can be used: choice questions,
            and short answers with accepted answers.
          </DialogDescription>
        </DialogHeader>
        <Field label="Problem">
          <SelectInput
            aria-label="Problem"
            value={problem}
            onChange={(event) => setProblem(event.target.value)}
          >
            <option value="">
              {questions.length
                ? "No problem (questions only)"
                : `Automatic${day.automatic ? `: ${day.automatic.title}` : ""}`}
            </option>
            {problems.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.title}
              </option>
            ))}
          </SelectInput>
        </Field>
        <QuestionPicker
          selected={questions}
          onChange={setQuestions}
          autoOnly
          showPoints={false}
          max={MAX_QUESTIONS}
          label="Questions"
        />
        {save.error && (
          <FormMessage message={{ text: save.error.message, kind: "err" }} />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            Save day
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
