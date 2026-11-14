"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"

import { DetailSheet } from "@/components/detail-sheet"
import { EditorSheet } from "@/components/editor-sheet"
import { Field, FormMessage, TextArea, TextInput } from "@/components/form"
import { api } from "@/lib/api/client"

import { ProblemPicker } from "./contests"
import type { StaffProblemList } from "./problems"
import { Card, Loading, PageTitle, Table } from "./shell"
import type { ApiResult } from "@/lib/api/types"
import type { listStudyPlans } from "@/features/catalog/server"
import type { createList } from "@/features/catalog/server"

type Plan = ApiResult<typeof listStudyPlans>[number]

export function AdminStudyPlans() {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState("")
  const [editing, setEditing] = useState<string | null>(null)
  const { data, error } = useQuery({
    queryKey: ["admin", "study-plans"],
    queryFn: () => api<Plan[]>("/admin/study-plans"),
  })
  const create = useMutation({
    mutationFn: () =>
      api<ApiResult<typeof createList>>("/lists", {
        body: { title, kind: "study_plan" },
      }),
    onSuccess: (plan) => {
      setTitle("")
      void queryClient.invalidateQueries({ queryKey: ["admin", "study-plans"] })
      setEditing(plan.slug)
    },
  })
  if (!data) return <Loading error={error} />
  return (
    <>
      {/* The builder opens over the list, which stays where it was. */}
      {editing && <PlanEditor slug={editing} onDone={() => setEditing(null)} />}
      <PageTitle>Study plans</PageTitle>
      <p className="mb-3 text-body-sm text-body">
        Curated, ordered sets of problems, such as &ldquo;Week 1: loops&rdquo;.
        Published plans appear on the Problems page with each student&apos;s
        progress.
      </p>
      {data.length > 0 && (
        <Table headers={["Plan", "Status", ""]}>
          {data.map((plan) => (
            <tr key={plan.slug}>
              <td>{plan.title}</td>
              <td>{plan.published ? "Published" : "Draft"}</td>
              <td className="w-40 text-right">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setEditing(plan.slug)}
                >
                  Edit
                </Button>
                <Link
                  className="ml-2 text-caption underline"
                  href={`/lists/${plan.slug}`}
                >
                  View
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <div className="mt-3 flex max-w-md gap-2">
        <TextInput
          aria-label="New study plan name"
          placeholder="New study plan"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <Button
          size="sm"
          className="h-auto"
          disabled={!title.trim()}
          onClick={() => create.mutate()}
        >
          Create
        </Button>
      </div>
    </>
  )
}

function PlanEditor({ slug, onDone }: { slug: string; onDone: () => void }) {
  const queryClient = useQueryClient()
  const plan = useQuery({
    queryKey: ["list", slug],
    queryFn: () => api<Plan & { items: { slug: string }[] }>(`/lists/${slug}`),
  })
  const problems = useQuery({
    queryKey: ["admin", "problems"],
    queryFn: () => api<StaffProblemList>("/admin/problems"),
  })
  if (!plan.data || !problems.data) {
    return (
      <DetailSheet title="Edit study plan" onClose={onDone}>
        <Loading error={plan.error ?? problems.error} />
      </DetailSheet>
    )
  }
  return (
    <PlanForm
      key={slug}
      plan={plan.data}
      problems={problems.data.problems}
      onSaved={() => {
        void queryClient.invalidateQueries({
          queryKey: ["admin", "study-plans"],
        })
        void queryClient.invalidateQueries({ queryKey: ["list", slug] })
        void queryClient.invalidateQueries({ queryKey: ["lists"] })
      }}
      onDone={onDone}
    />
  )
}

function PlanForm({
  plan,
  problems,
  onSaved,
  onDone,
}: {
  plan: Plan & { items: { slug: string }[] }
  problems: StaffProblemList["problems"]
  onSaved: () => void
  onDone: () => void
}) {
  const idOf = new Map(problems.map((problem) => [problem.slug, problem.id]))
  const slugOf = new Map(problems.map((problem) => [problem.id, problem.slug]))
  const [title, setTitle] = useState(plan.title)
  const [description, setDescription] = useState(plan.description)
  const [selected, setSelected] = useState(
    plan.items.flatMap((item) => idOf.get(item.slug) ?? [])
  )
  const save = useMutation({
    mutationFn: (published: boolean) =>
      api(`/lists/${plan.slug}`, {
        method: "PATCH",
        body: {
          title,
          description,
          published,
          problemSlugs: selected.flatMap((id) => slugOf.get(id) ?? []),
        },
      }),
    onSuccess: onSaved,
  })
  return (
    <EditorSheet
      title="Edit study plan"
      description="An ordered set of problems learners work through. Save a draft any time; Publish puts it in the library."
      width="48rem"
      error={save.error?.message}
      notice={save.isSuccess ? "Saved." : null}
      submitLabel="Publish"
      submitDisabled={save.isPending}
      onSubmit={() => save.mutate(true)}
      onClose={onDone}
      cancelLabel="Close"
      testId="plan-editor"
      extra={
        <Button
          variant="outline"
          disabled={save.isPending}
          onClick={() => save.mutate(false)}
        >
          Save draft
        </Button>
      }
    >
      <Field label="Title">
        <TextInput
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </Field>
      <Field label="Description" help="Optional. Shown at the top of the plan.">
        <TextArea
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>
      <ProblemPicker
        problems={problems}
        selected={selected}
        onChange={setSelected}
      />
    </EditorSheet>
  )
}
