"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"

import { ConfirmButton } from "@/components/confirm"
import { Field, SelectInput, TextArea } from "@/components/form"
import { api } from "@/lib/api/client"
import { useOwner } from "@/features/admin/owner"

import type { StaffProblemList } from "./problems"
import { Card, Loading, PageTitle } from "./shell"

interface Note {
  id: string
  text: string
  problemId: string | null
  createdAt: string
}

export function AdminNotes() {
  const owner = useOwner()
  const queryClient = useQueryClient()
  const [text, setText] = useState("")
  const [target, setTarget] = useState("all")
  const notes = useQuery({
    queryKey: owner.key("notes"),
    queryFn: () => api<Note[]>(owner.api("/notes")),
  })
  const problems = useQuery({
    queryKey: owner.key("problems"),
    queryFn: () => api<StaffProblemList>(owner.api("/problems")),
    // Organization notices go on the organization's page, not on problems.
    enabled: !owner.orgSlug,
  })
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: owner.key("notes") })
  const add = useMutation({
    mutationFn: () =>
      api(owner.api("/notes"), {
        body: { text, problemId: target === "all" ? null : target },
      }),
    onSuccess: () => {
      setText("")
      void refresh()
    },
  })
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(owner.api(`/notes/${id}`), { method: "DELETE" }),
    onSuccess: refresh,
  })
  const titleOf = (id: string | null) =>
    id
      ? (problems.data?.problems.find((problem) => problem.id === id)?.title ??
        "Problem")
      : "Everyone"

  return (
    <>
      <PageTitle>Notices</PageTitle>
      <Card className="mb-4 grid gap-3">
        {!owner.orgSlug && (
          <Field label="Show on">
            <SelectInput
              value={target}
              onChange={(event) => setTarget(event.target.value)}
            >
              <option value="all">Everyone (top of the page)</option>
              {problems.data?.problems.map((problem) => (
                <option key={problem.id} value={problem.id}>
                  {problem.title}
                </option>
              ))}
            </SelectInput>
          </Field>
        )}
        <Field label="Notice">
          <TextArea
            rows={3}
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </Field>
        <div>
          <Button
            size="sm"
            disabled={!text.trim() || add.isPending}
            onClick={() => add.mutate()}
          >
            Add notice
          </Button>
        </div>
      </Card>
      {!notes.data ? (
        <Loading error={notes.error} />
      ) : (
        <div className="grid gap-2">
          {notes.data.map((note) => (
            <Card key={note.id} className="flex items-start gap-3 p-3">
              <div className="min-w-0 flex-1 wrap-anywhere whitespace-pre-wrap text-ink">
                {note.text}
                <div className="text-xs text-body">
                  {titleOf(note.problemId)}
                </div>
              </div>
              <ConfirmButton
                variant="ghost"
                size="sm"
                title="Delete this notice?"
                description="Nobody will see it any more."
                confirmLabel="Delete notice"
                onConfirm={() => remove.mutate(note.id)}
              >
                Delete
              </ConfirmButton>
            </Card>
          ))}
        </div>
      )}
    </>
  )
}
