"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { NBA_PROGRAM_OUTCOMES, type AttainmentRules } from "@workspace/judge"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"

import { Field, FormMessage, TextInput } from "@/components/form"
import { Card, Loading, PageTitle } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import type { getProgramOutcomes } from "@/features/outcomes/server"

export interface ProgramOutcome {
  id: string
  code: string
  title: string
}

type ProgramOutcomes = ApiResult<typeof getProgramOutcomes>

type Row = { id?: string; key: string; code: string; title: string }

let counter = 0
const keyOf = () => `new-${++counter}`

/** The organization's program outcomes and how attainment is judged. */
export function ManageOutcomes({ slug }: { slug: string }) {
  const { data, error } = useQuery({
    queryKey: ["org", slug, "outcomes"],
    queryFn: () => api<ProgramOutcomes>(`/orgs/${slug}/outcomes`),
  })
  if (!data) return <Loading error={error} />
  return <OutcomesForm key={JSON.stringify(data)} slug={slug} initial={data} />
}

function OutcomesForm({
  slug,
  initial,
}: {
  slug: string
  initial: ProgramOutcomes
}) {
  const client = useQueryClient()
  const [rows, setRows] = useState<Row[]>(
    initial.outcomes.map((o) => ({ ...o, key: o.id }))
  )
  const [threshold, setThreshold] = useState(String(initial.rules.threshold))
  const [levels, setLevels] = useState(initial.rules.levels.map(String))
  const [message, setMessage] = useState<{
    text: string
    kind: "ok" | "err"
  } | null>(null)
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/outcomes`, {
        method: "PUT",
        body: {
          outcomes: rows.map(({ id, code, title }) => ({ id, code, title })),
          rules: {
            threshold: Number(threshold),
            levels: levels.map(Number),
          },
        },
      }),
    onSuccess: () => {
      setMessage({ text: "Saved.", kind: "ok" })
      void client.invalidateQueries({ queryKey: ["org", slug] })
    },
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
  })
  const edit = (key: string, change: Partial<Row>) => {
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...change } : r)))
    setMessage(null)
  }
  const readOnly = !initial.canEdit

  return (
    <>
      <PageTitle>Outcomes</PageTitle>
      <p className="mb-4 max-w-3xl text-body-sm text-body">
        Program outcomes (POs) say what graduates should be able to do. Each
        class sets its course outcomes (COs) on its Outcomes tab and maps them
        to these; problems in assignments are tagged with COs, and attainment
        comes from the marks.
      </p>
      <div className="grid gap-4">
        <Card className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-title-sm text-ink">Program outcomes</h2>
            {!readOnly && rows.length === 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setRows(
                    NBA_PROGRAM_OUTCOMES.map((o) => ({ ...o, key: keyOf() }))
                  )
                }
              >
                Start from NBA&apos;s PO1–PO12
              </Button>
            )}
          </div>
          {rows.length === 0 && (
            <p className="text-caption">No program outcomes yet.</p>
          )}
          <div className="grid gap-2" data-testid="program-outcomes">
            {rows.map((row) => (
              <div key={row.key} className="flex items-center gap-2">
                <TextInput
                  aria-label="Code"
                  className="w-24"
                  value={row.code}
                  disabled={readOnly}
                  onChange={(event) =>
                    edit(row.key, { code: event.target.value })
                  }
                />
                <TextInput
                  aria-label="Outcome"
                  className="flex-1"
                  value={row.title}
                  disabled={readOnly}
                  onChange={(event) =>
                    edit(row.key, { title: event.target.value })
                  }
                />
                {!readOnly && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={`Remove ${row.code || "outcome"}`}
                    onClick={() =>
                      setRows((all) => all.filter((r) => r.key !== row.key))
                    }
                  >
                    ×
                  </Button>
                )}
              </div>
            ))}
          </div>
          {!readOnly && (
            <Button
              size="sm"
              variant="outline"
              className="justify-self-start"
              onClick={() =>
                setRows((all) => [
                  ...all,
                  { key: keyOf(), code: `PO${all.length + 1}`, title: "" },
                ])
              }
            >
              Add outcome
            </Button>
          )}
        </Card>

        <Card className="grid gap-3">
          <h2 className="text-title-sm text-ink">Attainment</h2>
          <div className="grid max-w-2xl gap-3 min-[901px]:grid-cols-4">
            <Field
              label="A student reaches a CO at (%)"
              help="Of the marks on problems tagged with it."
            >
              <TextInput
                type="number"
                min={1}
                max={100}
                disabled={readOnly}
                value={threshold}
                onChange={(event) => setThreshold(event.target.value)}
              />
            </Field>
            {[1, 2, 3].map((level, i) => (
              <Field
                key={level}
                label={`Level ${level} when (%)`}
                help={i === 0 ? "of students reach it." : undefined}
              >
                <TextInput
                  type="number"
                  min={0}
                  max={100}
                  disabled={readOnly}
                  value={levels[i]}
                  onChange={(event) =>
                    setLevels((all) =>
                      all.map((v, j) => (j === i ? event.target.value : v))
                    )
                  }
                />
              </Field>
            ))}
          </div>
          <p className="text-caption">
            A PO&apos;s attainment is its COs&apos; levels averaged by how
            strongly each maps to it (1 low, 2 medium, 3 high).
          </p>
        </Card>

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={save.isPending} onClick={() => save.mutate()}>
              Save outcomes
            </Button>
            {message && <FormMessage message={message} />}
          </div>
        )}
      </div>
    </>
  )
}
