"use client"

import { CheckCircleIcon } from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import type { FeedbackQuestion } from "@workspace/judge"
import { Button } from "@workspace/ui/components/button"

import { FormMessage, TextArea } from "@/components/form"
import { Card, Loading, PageTitle } from "@/features/admin/components/shell"
import type { myResults, myRounds } from "@/features/feedback-rounds/server"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { formatDate } from "@/lib/format"

import { ResultLines } from "./manage-rounds"

type Rounds = ApiResult<typeof myRounds>
type Target = Rounds[number]["targets"][number]

/** Feedback rounds a student is in: each teacher of their subjects to rate, once. */
export function GiveFeedback({ slug }: { slug: string }) {
  const { data, error } = useQuery({
    queryKey: ["org", slug, "feedback", "to-give"],
    queryFn: () => api<Rounds>(`/orgs/${slug}/feedback-rounds/to-give`),
  })
  if (!data) return <Loading error={error} />
  return (
    <div className="grid gap-4" data-testid="give-feedback">
      <PageTitle>Feedback</PageTitle>
      {data.length === 0 ? (
        <p className="text-body-sm text-body">No feedback to give right now.</p>
      ) : (
        data.map((round) => (
          <section key={round.id} className="grid gap-3">
            <div>
              <h2 className="text-title-sm text-ink">{round.title}</h2>
              <p className="text-caption text-body">
                Closes {formatDate(round.closesAt)} ·{" "}
                {round.targets.filter((t) => t.done).length} of{" "}
                {round.targets.length} done · Your teachers never see who
                answered.
              </p>
              {round.description && (
                <p className="mt-1 text-body-sm text-body">
                  {round.description}
                </p>
              )}
            </div>
            {round.targets.map((t) => (
              <TargetCard
                key={t.classSubjectId}
                slug={slug}
                roundId={round.id}
                questions={round.questions as FeedbackQuestion[]}
                target={t}
              />
            ))}
          </section>
        ))
      )}
    </div>
  )
}

function TargetCard({
  slug,
  roundId,
  questions,
  target,
}: {
  slug: string
  roundId: string
  questions: FeedbackQuestion[]
  target: Target
}) {
  const client = useQueryClient()
  const [answers, setAnswers] = useState<Record<string, number | string>>({})
  const send = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/feedback-rounds/${roundId}/answers`, {
        body: { classSubjectId: target.classSubjectId, answers },
      }),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["org", slug, "feedback", "to-give"],
      })
      void client.invalidateQueries({ queryKey: ["me", "notifications"] })
    },
    meta: { quiet: true },
  })
  const ratings = questions.filter((q) => q.kind === "rating")
  const complete = ratings.every((q) => typeof answers[q.id] === "number")
  return (
    <Card data-testid="feedback-target">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-ink">
          {target.teacher} · {target.subject}
        </div>
        {target.done && (
          <span
            className="flex items-center gap-1 text-caption text-success"
            data-testid="feedback-done"
          >
            <CheckCircleIcon aria-hidden weight="fill" />
            Done
          </span>
        )}
      </div>
      {!target.done && (
        <div className="mt-3 grid gap-3">
          {questions.map((q) =>
            q.kind === "rating" ? (
              <fieldset key={q.id} className="grid gap-1.5">
                <legend className="text-body-sm text-ink">{q.text}</legend>
                <div
                  className="flex flex-wrap gap-1.5"
                  role="radiogroup"
                  aria-label={q.text}
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Button
                      key={n}
                      type="button"
                      size="sm"
                      role="radio"
                      aria-checked={answers[q.id] === n}
                      variant={answers[q.id] === n ? "default" : "outline"}
                      className="w-10"
                      onClick={() => setAnswers({ ...answers, [q.id]: n })}
                    >
                      {n}
                    </Button>
                  ))}
                </div>
              </fieldset>
            ) : (
              <div key={q.id} className="grid gap-1.5">
                <label
                  className="text-body-sm text-ink"
                  htmlFor={`${target.classSubjectId}-${q.id}`}
                >
                  {q.text}{" "}
                  <span className="text-caption text-body">(optional)</span>
                </label>
                <TextArea
                  id={`${target.classSubjectId}-${q.id}`}
                  rows={2}
                  maxLength={1000}
                  value={(answers[q.id] as string | undefined) ?? ""}
                  onChange={(e) =>
                    setAnswers({ ...answers, [q.id]: e.target.value })
                  }
                />
              </div>
            )
          )}
          {send.error && (
            <FormMessage message={{ text: send.error.message, kind: "err" }} />
          )}
          <div>
            <Button
              disabled={!complete || send.isPending}
              onClick={() => send.mutate()}
            >
              Send feedback
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

/** A teacher's own results, round by round (Manage › My feedback). */
export function MyFeedbackResults({ slug }: { slug: string }) {
  const { data, error } = useQuery({
    queryKey: ["org", slug, "feedback", "my-results"],
    queryFn: () =>
      api<ApiResult<typeof myResults>>(
        `/orgs/${slug}/feedback-rounds/my-results`
      ),
  })
  if (!data) return <Loading error={error} />
  return (
    <div className="grid gap-4" data-testid="my-feedback">
      <PageTitle>My feedback</PageTitle>
      <p className="max-w-3xl text-body-sm text-body">
        What students said about your teaching in each feedback round. You never
        see who answered.
      </p>
      {data.length === 0 ? (
        <p className="text-body-sm text-body">
          No feedback about your teaching yet.
        </p>
      ) : (
        data.map((round) => (
          <section key={round.id} className="grid gap-2">
            <h2 className="text-title-sm text-ink">
              {round.title}
              {round.phase === "open" && (
                <span className="ml-2 text-caption text-body">
                  (still open)
                </span>
              )}
            </h2>
            <ResultLines lines={round.lines} />
          </section>
        ))
      )}
    </div>
  )
}
