"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"

import { DetailSheet } from "@/components/detail-sheet"
import { EditorSheet } from "@/components/editor-sheet"
import { Field, TextArea, TextInput } from "@/components/form"
import { useOwner } from "@/features/admin/owner"
import { api } from "@/lib/api/client"

import { ProblemPicker } from "./contests"
import type { StaffProblemList } from "./problems"
import { Loading, PageTitle, Table } from "./shell"
import type { ApiResult } from "@/lib/api/types"
import type { listStudyPlans } from "@/features/catalog/server"
import type { createList } from "@/features/catalog/server"
import type { orgStudyPlans } from "@/features/catalog/org-plans"

type Plan = Pick<
  ApiResult<typeof listStudyPlans>[number],
  "slug" | "title" | "description" | "published"
>
type OrgPlans = ApiResult<typeof orgStudyPlans>

/**
 * The platform's study plans (Dashboard › Study plans, on the Problems page for everyone) or an
 * organization's own (Manage › Study plans, for its members, with its members-only problems):
 * the same screen, with its addresses from useOwner().
 */
export function AdminStudyPlans() {
  const queryClient = useQueryClient()
  const owner = useOwner()
  const [title, setTitle] = useState("")
  const [editing, setEditing] = useState<string | null>(null)
  const { data, error } = useQuery({
    queryKey: owner.key("study-plans"),
    queryFn: () =>
      owner.orgSlug
        ? api<OrgPlans>(owner.api("/study-plans")).then((r) => r.plans)
        : api<Plan[]>("/admin/study-plans"),
  })
  const create = useMutation({
    mutationFn: () =>
      owner.orgSlug
        ? api<{ slug: string }>(owner.api("/study-plans"), { body: { title } })
        : api<ApiResult<typeof createList>>("/lists", {
            body: { title, kind: "study_plan" },
          }),
    onSuccess: (plan) => {
      setTitle("")
      void queryClient.invalidateQueries({ queryKey: owner.key("study-plans") })
      setEditing(plan.slug)
    },
  })
  const viewHref = (slug: string) =>
    owner.orgSlug
      ? `/orgs/${owner.orgSlug}/study-plans/${slug}`
      : `/lists/${slug}`
  if (!data) return <Loading error={error} />
  return (
    <>
      {/* The builder opens over the list, which stays where it was. */}
      {editing && <PlanEditor slug={editing} onDone={() => setEditing(null)} />}
      <PageTitle>Study plans</PageTitle>
      <p className="mb-3 text-body-sm text-body">
        Curated, ordered sets of problems for practising on your own, such as
        &ldquo;Week 1: loops&rdquo;. Unlike a course, a plan has no modules,
        release dates or marked work, and isn't given to a class.
        {owner.orgSlug
          ? " Published plans appear under Study plans for your members, with each one's progress. They can hold your members-only problems."
          : " Published plans appear on the Problems page with each student's progress."}
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
                  href={viewHref(plan.slug)}
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
  const owner = useOwner()
  const address = owner.orgSlug ? owner.api(`/study-plans/${slug}`) : `/lists/${slug}`
  const plan = useQuery({
    queryKey: owner.key("study-plan", slug),
    queryFn: () => api<Plan & { items: { slug: string }[] }>(address),
  })
  const problems = useQuery({
    queryKey: owner.key("problems", "picker"),
    // An organization picks from the library shared with it and its own problems.
    queryFn: () =>
      api<StaffProblemList>(
        owner.orgSlug ? `${owner.api("/problems")}?for=picker` : owner.api("/problems")
      ),
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
      address={address}
      problems={
        owner.orgSlug
          ? // What a plan may hold: published problems anyone can practise, or members-only ones
            // (the picker offers only the organization's own of those).
            problems.data.problems.filter(
              (p) => p.published && (p.membersOnly || p.listed)
            )
          : problems.data.problems
      }
      onSaved={() => {
        void queryClient.invalidateQueries({ queryKey: owner.key("study-plans") })
        void queryClient.invalidateQueries({ queryKey: owner.key("study-plan", slug) })
        void queryClient.invalidateQueries({ queryKey: ["list", slug] })
        void queryClient.invalidateQueries({ queryKey: ["lists"] })
      }}
      onDone={onDone}
    />
  )
}

function PlanForm({
  plan,
  address,
  problems,
  onSaved,
  onDone,
}: {
  plan: Plan & { items: { slug: string }[] }
  /** Where the plan is saved: /lists/<slug>, or the organization's own address. */
  address: string
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
      api(address, {
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
      description={
        address.startsWith("/lists/")
          ? "An ordered set of problems learners work through. Save a draft any time; Publish puts it in the library."
          : "An ordered set of problems your members work through. Save a draft any time; Publish shows it to them under Study plans."
      }
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
        orderLabel="In the plan, in this order"
        marker={(index) => String(index + 1)}
        canCreate={false}
      />
    </EditorSheet>
  )
}
