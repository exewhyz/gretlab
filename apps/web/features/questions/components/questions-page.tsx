"use client"

import Link from "next/link"
import { useState } from "react"

import { Button, buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { SelectInput, TextInput } from "@/components/form"
import { Loading, PageTitle, Table } from "@/features/admin/components/shell"
import { useOwner } from "@/features/admin/owner"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api/client"

import { KIND_LABEL } from "./question-editor"
import { ImportQuestionsDialog } from "./question-import"
import type { BankQuestion } from "./question-picker"

/** The question bank: quiz questions to use in assignments, exams, contests and the daily challenge. */
export function QuestionsPage() {
  const owner = useOwner()
  const { data, error } = useQuery({
    queryKey: owner.key("questions"),
    queryFn: () => api<BankQuestion[]>(owner.api("/questions")),
  })
  const [search, setSearch] = useState("")
  const [kind, setKind] = useState("")
  const [importing, setImporting] = useState(false)
  if (!data) return <Loading error={error} />
  const query = search.trim().toLowerCase()
  const rows = data.filter(
    (q) =>
      (!kind || q.kind === kind) &&
      (!query ||
        q.title.toLowerCase().includes(query) ||
        q.tags.some((t) => t.toLowerCase().includes(query)))
  )
  return (
    <>
      <PageTitle
        action={
          <span className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
              Import
            </Button>
            <Link
              href={owner.page("/questions/new")}
              className={cn(buttonVariants({ size: "sm" }))}
            >
              New question
            </Link>
          </span>
        }
      >
        Questions
      </PageTitle>
      <p className="mb-3 text-caption text-body">
        {data.length} quiz questions. Use them in assignments, exams, contests and the daily
        challenge, alone or beside coding problems.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <TextInput
          aria-label="Search questions"
          placeholder="Search by title or tag"
          className="w-64"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <SelectInput
          aria-label="Type"
          className="w-48"
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          <option value="">Any type</option>
          {Object.entries(KIND_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </SelectInput>
      </div>
      <ImportQuestionsDialog open={importing} onOpenChange={setImporting} />
      <Table headers={["Title", "Type", "Points", "Tags", "Status"]}>
        {rows.map((q) => (
          <tr key={q.id} data-testid="bank-question">
            <td>
              <Link
                href={owner.page(`/questions/${q.id}`)}
                className="font-medium text-ink underline-offset-2 hover:underline"
              >
                {q.title}
              </Link>
            </td>
            <td>
              {KIND_LABEL[q.kind]}
              {!q.marksItself && (
                <span className="ml-1 text-xs text-body">(marked by hand)</span>
              )}
            </td>
            <td className="tabular-nums">{q.points}</td>
            <td className="text-caption">{q.tags.join(", ")}</td>
            <td>{q.published ? "Ready" : "Draft"}</td>
          </tr>
        ))}
      </Table>
      {rows.length === 0 && (
        <p className="mt-3 text-body-sm text-body">
          {data.length === 0
            ? "No questions yet. Write one, or import a file."
            : "No questions match."}
        </p>
      )}
    </>
  )
}
