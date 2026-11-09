"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useMemo, useState } from "react"

import { Button, buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { SelectInput, TextInput } from "@/components/form"
import { api } from "@/lib/api/client"
import { useOwner } from "@/features/admin/owner"

import { ImportProblemsDialog } from "./problem-import"
import { Loading, PageTitle, Table } from "./shell"

export interface StaffProblemList {
  units: { id: string; name: string; position: number }[]
  problems: {
    id: string
    slug: string
    title: string
    level: string
    position: number
    unitId: string | null
    published: boolean
    /** false: written for assignments, exams or contests, not in the library. */
    listed: boolean
    testCount: number
  }[]
}

export function AdminProblems() {
  const owner = useOwner()
  const { data, error } = useQuery({
    queryKey: owner.key("problems"),
    queryFn: () => api<StaffProblemList>(owner.api("/problems")),
  })
  const [search, setSearch] = useState("")
  const [unit, setUnit] = useState("")
  const [state, setState] = useState("")
  const [importing, setImporting] = useState(false)

  // Course order: by unit, then by position inside it, as students see them.
  const rows = useMemo(() => {
    if (!data) return []
    const unitOrder = new Map(data.units.map((u) => [u.id, u.position]))
    const query = search.trim().toLowerCase()
    return data.problems
      .filter(
        (problem) =>
          (!query ||
            problem.title.toLowerCase().includes(query) ||
            problem.slug.toLowerCase().includes(query)) &&
          (!unit || problem.unitId === unit) &&
          (!state ||
            (state === "own"
              ? !problem.listed
              : (state === "published") === problem.published))
      )
      .sort(
        (a, b) =>
          (unitOrder.get(a.unitId ?? "") ?? 1e9) -
            (unitOrder.get(b.unitId ?? "") ?? 1e9) ||
          a.position - b.position ||
          a.slug.localeCompare(b.slug)
      )
  }, [data, search, unit, state])

  if (!data) return <Loading error={error} />
  const unitName = (id: string | null) =>
    data.units.find((u) => u.id === id)?.name ?? "—"
  const drafts = data.problems.filter((p) => !p.published).length

  return (
    <>
      <PageTitle
        action={
          <span className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
              Import
            </Button>
            <Link
              href={owner.page("/problems/new")}
              className={cn(buttonVariants({ size: "sm" }))}
            >
              New problem
            </Link>
          </span>
        }
      >
        Problems
      </PageTitle>
      <p className="mb-3 text-caption text-body">
        {data.problems.length} problems · {drafts} drafts. Click a title to edit
        its statement, tests, hints and editorial.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <TextInput
          aria-label="Search problems"
          placeholder="Search by title or slug"
          className="w-64"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <SelectInput
          aria-label="Unit"
          className="w-64"
          value={unit}
          onChange={(event) => setUnit(event.target.value)}
        >
          <option value="">All units</option>
          {data.units.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </SelectInput>
        <SelectInput
          aria-label="Status"
          className="w-36"
          value={state}
          onChange={(event) => setState(event.target.value)}
        >
          <option value="">Any status</option>
          <option value="published">Published</option>
          <option value="draft">Draft</option>
          <option value="own">Not in the library</option>
        </SelectInput>
      </div>
      <ImportProblemsDialog open={importing} onOpenChange={setImporting} />
      <Table headers={["Title", "Unit", "Level", "Tests", "Status", ""]}>
        {rows.map((problem) => (
          <tr key={problem.id}>
            <td>
              <Link
                href={owner.page(`/problems/${problem.id}`)}
                className="font-medium text-ink underline-offset-2 hover:underline"
              >
                {problem.title}
              </Link>
            </td>
            <td>{unitName(problem.unitId)}</td>
            <td className="capitalize">{problem.level}</td>
            <td className="tabular-nums">{problem.testCount}</td>
            <td>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-xs",
                  problem.published
                    ? "bg-success/10 text-success"
                    : "bg-muted text-body"
                )}
              >
                {problem.published ? "Published" : "Draft"}
              </span>
              {!problem.listed && (
                <span
                  className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs text-body"
                  title="Only through the assignments, exams and contests that use it"
                >
                  Not in library
                </span>
              )}
            </td>
            <td className="text-right">
              {problem.published && problem.listed && (
                <Link
                  href={`/problems/${problem.slug}`}
                  className="text-caption underline underline-offset-2"
                >
                  View
                </Link>
              )}
            </td>
          </tr>
        ))}
      </Table>
      {rows.length === 0 && (
        <p className="mt-3 text-body-sm text-body">
          No problems match these filters.
        </p>
      )}
    </>
  )
}
