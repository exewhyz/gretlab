"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { AttainmentRules } from "@workspace/judge"
import Link from "next/link"
import { useState } from "react"

import { Button, buttonVariants } from "@workspace/ui/components/button"
import { cn } from "@workspace/ui/lib/utils"

import { FormMessage, SelectInput, TextInput } from "@/components/form"
import { Loading, Table } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import { orgPages } from "@/lib/paths"

interface Report {
  canEdit: boolean
  rules: AttainmentRules
  programOutcomes: { id: string; code: string; title: string; attainment: number | null }[]
  outcomes: {
    id: string
    code: string
    title: string
    mapping: Record<string, number>
    evidence: { assignment: string; problem: string; points: number }[]
    assessed: number
    reached: number
    percent: number | null
    level: number | null
  }[]
  students: { name: string; email: string; percents: (number | null)[] }[]
}

const STRENGTH = ["–", "1 low", "2 medium", "3 high"]

/** A class's course outcomes: attainment for teachers, and editing for those who set work. */
export function ClassOutcomes({ slug, groupId }: { slug: string; groupId: string }) {
  const path = `/orgs/${slug}/classes/${groupId}/outcomes`
  const { data, error } = useQuery({
    queryKey: ["org", slug, "class", groupId, "outcomes"],
    queryFn: () => api<Report>(path),
  })
  const [editing, setEditing] = useState(false)
  if (!data) return <Loading error={error} />

  if (editing) {
    return (
      <OutcomeEditor
        slug={slug}
        groupId={groupId}
        report={data}
        onDone={() => setEditing(false)}
      />
    )
  }

  return (
    <div className="grid gap-5" data-testid="class-outcomes">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-caption">
          A student reaches a CO with {data.rules.threshold}% of the marks on problems
          tagged with it. Level 1, 2 or 3 when {data.rules.levels.join("%, ")}% of
          students reach it. Tag problems with COs on the assignment form.
        </p>
        <span className="flex gap-2">
          {data.canEdit && (
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              Edit outcomes
            </Button>
          )}
          {data.outcomes.length > 0 && (
            <a
              href={`/api/v1${path}?format=csv`}
              download
              className={cn(buttonVariants({ size: "sm" }))}
            >
              Download CSV
            </a>
          )}
        </span>
      </div>

      {data.outcomes.length === 0 ? (
        <p className="text-body-sm text-body">
          No course outcomes yet.
          {data.canEdit && " Add them with Edit outcomes, then tag problems with them."}
        </p>
      ) : (
        <>
          <section className="grid gap-2">
            <h3 className="text-title-sm text-ink">Course outcomes</h3>
            <Table headers={["CO", "Outcome", "Assessed by", "Reached", "Level"]}>
              {data.outcomes.map((o) => (
                <tr key={o.id} data-testid="co-row">
                  <td className="font-medium text-ink">{o.code}</td>
                  <td>{o.title}</td>
                  <td className="text-caption">
                    {o.evidence.length === 0
                      ? "No problems tagged yet"
                      : o.evidence.map((e) => `${e.assignment}: ${e.problem}`).join("; ")}
                  </td>
                  <td className="tabular-nums">
                    {o.percent === null
                      ? "—"
                      : `${o.reached} of ${o.assessed} (${o.percent}%)`}
                  </td>
                  <td className="font-semibold text-ink tabular-nums">
                    {o.level ?? "—"}
                  </td>
                </tr>
              ))}
            </Table>
          </section>

          {data.programOutcomes.length > 0 && (
            <section className="grid gap-2">
              <h3 className="text-title-sm text-ink">CO–PO mapping and attainment</h3>
              <Table
                headers={["", ...data.programOutcomes.map((p) => p.code)]}
              >
                {data.outcomes.map((o) => (
                  <tr key={o.id}>
                    <td className="font-medium text-ink">{o.code}</td>
                    {data.programOutcomes.map((p) => (
                      <td key={p.id} className="tabular-nums">
                        {o.mapping[p.id] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr data-testid="po-attainment">
                  <td className="font-semibold text-ink">Attainment</td>
                  {data.programOutcomes.map((p) => (
                    <td
                      key={p.id}
                      title={p.title}
                      className="font-semibold text-ink tabular-nums"
                    >
                      {p.attainment ?? "—"}
                    </td>
                  ))}
                </tr>
              </Table>
            </section>
          )}

          <section className="grid gap-2">
            <h3 className="text-title-sm text-ink">Students</h3>
            <Table
              headers={["Student", ...data.outcomes.map((o) => `${o.code} %`)]}
            >
              {data.students.map((s) => (
                <tr key={s.email}>
                  <td>
                    <div className="text-ink">{s.name}</div>
                    <div className="text-xs">{s.email}</div>
                  </td>
                  {s.percents.map((p, i) => (
                    <td
                      key={i}
                      className={cn(
                        "tabular-nums",
                        p !== null &&
                          (p >= data.rules.threshold
                            ? "text-success"
                            : "text-destructive")
                      )}
                    >
                      {p ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </Table>
          </section>
        </>
      )}
    </div>
  )
}

type Row = {
  id?: string
  key: string
  code: string
  title: string
  mapping: Record<string, number>
}

let counter = 0

function OutcomeEditor({
  slug,
  groupId,
  report,
  onDone,
}: {
  slug: string
  groupId: string
  report: Report
  onDone: () => void
}) {
  const client = useQueryClient()
  const [rows, setRows] = useState<Row[]>(
    report.outcomes.map((o) => ({
      id: o.id,
      key: o.id,
      code: o.code,
      title: o.title,
      mapping: o.mapping,
    }))
  )
  const [message, setMessage] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/classes/${groupId}/outcomes`, {
        method: "PUT",
        body: {
          outcomes: rows.map(({ id, code, title, mapping }) => ({
            id,
            code,
            title,
            mapping,
          })),
        },
      }),
    onSuccess: async () => {
      await client.invalidateQueries({
        queryKey: ["org", slug, "class", groupId, "outcomes"],
      })
      onDone()
    },
    onError: (e) => setMessage(e.message),
  })
  const edit = (key: string, change: Partial<Row>) => {
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...change } : r)))
    setMessage(null)
  }
  const pos = report.programOutcomes

  return (
    <div className="grid gap-3" data-testid="outcome-editor">
      <h3 className="text-title-sm text-ink">Course outcomes</h3>
      {pos.length === 0 && (
        <p className="text-caption">
          Your organization has no program outcomes yet, so there&apos;s nothing to map to.
          They&apos;re set under{" "}
          <Link href={orgPages(slug).manage(`/outcomes`)} className="underline">
            Manage › Outcomes
          </Link>
          .
        </p>
      )}
      {rows.map((row) => (
        <div
          key={row.key}
          className="grid gap-2 rounded-md border border-hairline p-3"
        >
          <div className="flex items-center gap-2">
            <TextInput
              aria-label="CO code"
              className="w-24"
              value={row.code}
              onChange={(event) => edit(row.key, { code: event.target.value })}
            />
            <TextInput
              aria-label="Course outcome"
              placeholder="Students can …"
              className="flex-1"
              value={row.title}
              onChange={(event) => edit(row.key, { title: event.target.value })}
            />
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={`Remove ${row.code || "outcome"}`}
              onClick={() => setRows((all) => all.filter((r) => r.key !== row.key))}
            >
              ×
            </Button>
          </div>
          {pos.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pos.map((p) => (
                <label
                  key={p.id}
                  className="flex items-center gap-1 text-caption"
                  title={p.title}
                >
                  {p.code}
                  <SelectInput
                    aria-label={`${row.code} supports ${p.code}`}
                    className="w-24 py-0.5"
                    value={String(row.mapping[p.id] ?? 0)}
                    onChange={(event) =>
                      edit(row.key, {
                        mapping: {
                          ...row.mapping,
                          [p.id]: Number(event.target.value),
                        },
                      })
                    }
                  >
                    {STRENGTH.map((label, s) => (
                      <option key={s} value={s}>
                        {label}
                      </option>
                    ))}
                  </SelectInput>
                </label>
              ))}
            </div>
          )}
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        className="justify-self-start"
        disabled={rows.length >= 20}
        onClick={() =>
          setRows((all) => [
            ...all,
            {
              key: `new-${++counter}`,
              code: `CO${all.length + 1}`,
              title: "",
              mapping: {},
            },
          ])
        }
      >
        Add course outcome
      </Button>
      <p className="text-caption">
        Removing a CO also removes it from problems tagged with it.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={save.isPending} onClick={() => save.mutate()}>
          Save outcomes
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        {message && <FormMessage message={{ text: message, kind: "err" }} />}
      </div>
    </div>
  )
}
