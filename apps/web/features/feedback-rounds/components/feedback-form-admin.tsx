"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import type { FeedbackQuestion } from "@workspace/judge"
import { Button } from "@workspace/ui/components/button"

import { FormMessage } from "@/components/form"
import { Card, Loading, PageTitle } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"

import { QuestionsEditor } from "./questions-editor"

/**
 * Dashboard › Feedback form: the questions every new feedback round starts with, in every
 * organization ("Manage feedback forms"). Rounds already opened keep their own questions.
 */
export function FeedbackFormAdmin() {
  const { data, error } = useQuery({
    queryKey: ["admin", "feedback-form"],
    queryFn: () => api<FeedbackQuestion[]>("/admin/feedback-form"),
  })
  if (!data) return <Loading error={error} />
  return <FormEditor start={data} />
}

function FormEditor({ start }: { start: FeedbackQuestion[] }) {
  const client = useQueryClient()
  const [questions, setQuestions] = useState(start)
  const save = useMutation({
    mutationFn: () =>
      api("/admin/feedback-form", { method: "PUT", body: { questions } }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["admin", "feedback-form"] }),
    meta: { quiet: true },
  })
  return (
    <div
      className="mx-auto grid w-full max-w-3xl gap-4"
      data-testid="feedback-form-admin"
    >
      <PageTitle>Feedback form</PageTitle>
      <p className="text-body-sm text-body">
        The questions every new feedback round starts with, in every
        organization. Whoever opens a round can change its own; rounds already
        opened keep theirs. Ratings are 1 to 5; comments are optional for
        students.
      </p>
      <Card>
        <QuestionsEditor questions={questions} onChange={setQuestions} />
      </Card>
      {save.error && (
        <FormMessage message={{ text: save.error.message, kind: "err" }} />
      )}
      {save.isSuccess && (
        <FormMessage
          message={{ text: "Saved. New rounds start with these.", kind: "ok" }}
        />
      )}
      <div>
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          Save form
        </Button>
      </div>
    </div>
  )
}
