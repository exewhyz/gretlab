"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Input } from "@workspace/ui/components/input"
import { Field, FormMessage, TextArea } from "@/components/form"
import { Card, PageTitle, Table } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"

import { readXlsx, toCsv } from "@/lib/xlsx"

import type { importMembers } from "@/features/orgs/server"

export interface ImportRow {
  line: number
  email: string
  name: string
  group: string
  role: string
  action: "invite" | "add" | "update" | "unchanged" | "error"
  note: string
}

export type ImportResult = ApiResult<typeof importMembers>

/** A small CSV reader: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let quoted = false
  const src = text.replace(/^\uFEFF/, "")
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ",") {
      row.push(field)
      field = ""
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else field += c
  }
  if (field !== "" || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""))
}

export const TEMPLATE =
  "email,name,group,role\nasha@college.edu,Asha Rao,CSE / 2026-A,\nravi@college.edu,Ravi Kumar,CSE / 2026-B,\nmeera@college.edu,Dr Meera Iyer,CSE,Teacher\n"

export const ACTION_LABEL: Record<ImportRow["action"], string> = {
  invite: "New account",
  add: "Joins",
  update: "Update",
  unchanged: "No change",
  error: "Error",
}

export function ManageImport({ slug }: { slug: string }) {
  const queryClient = useQueryClient()
  const [text, setText] = useState("")
  const [createGroups, setCreateGroups] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  /** The CSV as rows of {email, name, group, role}, using the header row to find columns. */
  function rows() {
    const table = parseCsv(text)
    const header = (table[0] ?? []).map((h) => h.trim().toLowerCase())
    const col = (name: string) => header.indexOf(name)
    if (col("email") < 0) {
      throw new Error('The first line must be a header with an "email" column.')
    }
    return table.slice(1).map((cells) => ({
      email: cells[col("email")] ?? "",
      name: col("name") >= 0 ? (cells[col("name")] ?? "") : "",
      group: col("group") >= 0 ? (cells[col("group")] ?? "") : "",
      role: col("role") >= 0 ? (cells[col("role")] ?? "") : "",
    }))
  }

  const run = useMutation({
    mutationFn: (commit: boolean) =>
      api<ImportResult>(`/orgs/${slug}/import`, {
        body: { rows: rows(), createGroups, commit },
      }),
    onMutate: () => setProblem(null),
    onSuccess: (data) => {
      setResult(data)
      if (data.committed)
        void queryClient.invalidateQueries({ queryKey: ["org", slug] })
    },
    onError: (e) => setProblem(e.message),
  })
  const doable = result
    ? result.counts.invite + result.counts.add + result.counts.update
    : 0

  return (
    <>
      <PageTitle>Import members</PageTitle>
      <Card className="mb-4 grid gap-3">
        <p className="text-body-sm text-body">
          A CSV with a header row: <code>email</code> (required),{" "}
          <code>name</code>, <code>group</code> (a path from the top, like{" "}
          <code>CSE / 2026-A</code>) and <code>role</code> (a role&apos;s name;
          empty for Member). Upload a CSV or Excel (.xlsx) file, or paste the
          rows. People without an account get one, ready when they first sign
          in.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a
            href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
            download="members-template.csv"
            className="text-caption underline underline-offset-2"
          >
            Download a template
          </a>
          <label className="text-caption">
            <span className="sr-only">CSV or Excel file</span>
            <Input
              type="file"
              accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              aria-label="CSV or Excel file"
              className="h-auto w-72 py-1.5 text-caption"
              onChange={async (event) => {
                const file = event.target.files?.[0]
                if (!file) return
                setResult(null)
                setProblem(null)
                try {
                  // Excel files are read in the browser and shown as CSV, so the same preview applies.
                  setText(
                    file.name.toLowerCase().endsWith(".xlsx")
                      ? toCsv(readXlsx(await file.arrayBuffer()))
                      : await file.text()
                  )
                } catch {
                  setProblem(
                    "Couldn't read that file. Save it as .xlsx or .csv and try again."
                  )
                }
              }}
            />
          </label>
        </div>
        <Field label="Or paste the CSV">
          <TextArea
            rows={6}
            value={text}
            className="font-mono text-xs"
            onChange={(event) => {
              setText(event.target.value)
              setResult(null)
            }}
          />
        </Field>
        <label className="flex items-center gap-2 text-body-sm text-ink">
          <Checkbox
            checked={createGroups}
            onCheckedChange={(checked) => {
              setCreateGroups(checked)
              setResult(null)
            }}
          />
          Create groups that don&apos;t exist yet
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            disabled={!text.trim() || run.isPending}
            onClick={() => run.mutate(false)}
          >
            Check
          </Button>
          {result && !result.committed && doable > 0 && (
            <Button disabled={run.isPending} onClick={() => run.mutate(true)}>
              Import {doable} {doable === 1 ? "person" : "people"}
              {result.counts.error > 0 &&
                `, skip ${result.counts.error} with errors`}
            </Button>
          )}
          {problem && <FormMessage message={{ text: problem, kind: "err" }} />}
          {result?.committed && (
            <FormMessage
              message={{
                text: `Done: ${doable} imported${result.counts.newGroups ? `, ${result.counts.newGroups} groups created` : ""}.`,
                kind: "ok",
              }}
            />
          )}
        </div>
      </Card>
      {result && (
        <>
          <p
            data-testid="import-summary"
            className="mb-2 text-caption text-body"
          >
            {result.counts.invite} new accounts · {result.counts.add} join ·{" "}
            {result.counts.update} updated · {result.counts.unchanged} unchanged
            · {result.counts.error} errors
            {result.counts.newGroups > 0 &&
              ` · ${result.counts.newGroups} new groups`}
          </p>
          <Table
            headers={["Line", "Email", "Name", "Group", "Role", "What happens"]}
          >
            {result.rows.map((row) => (
              <tr key={row.line} data-testid="import-row">
                <td className="tabular-nums">{row.line}</td>
                <td className="text-ink">{row.email || "—"}</td>
                <td>{row.name}</td>
                <td>{row.group}</td>
                <td>{row.role}</td>
                <td
                  className={
                    row.action === "error" ? "text-destructive" : "text-ink"
                  }
                >
                  {ACTION_LABEL[row.action]}
                  <div className="text-xs text-body">{row.note}</div>
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </>
  )
}
