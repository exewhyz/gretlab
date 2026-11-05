"use client"

import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import { Button } from "@workspace/ui/components/button"

import {
  GroupChecklist,
  topmost,
} from "@/features/orgs/components/group-checklist"
import { api } from "@/lib/api/client"

interface Group {
  id: string
  name: string
  parentId: string | null
  depth: number
}

/**
 * Who something is for. Each box is a condition met by being in any ticked group (or one
 * inside it); a person must meet every box. One box with "3rd Year", another with "CAC":
 * third-year students who take CAC, in every section. No boxes: the whole organization.
 */
export function AudiencePicker({
  orgSlug,
  value,
  onChange,
}: {
  orgSlug: string
  value: string[][]
  onChange: (audience: string[][]) => void
}) {
  const { data } = useQuery({
    queryKey: ["org", orgSlug, "groups"],
    queryFn: () =>
      api<{ levels: string[]; groups: Group[] }>(`/orgs/${orgSlug}/groups`),
  })
  const groups = data?.groups ?? []
  const name = (id: string) => groups.find((g) => g.id === id)?.name ?? "?"

  // Debounced, so ticking several boxes asks once.
  const [asked, setAsked] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setAsked(value), 300)
    return () => clearTimeout(timer)
  }, [value])
  const conditions = asked.filter((c) => c.length > 0)
  const preview = useQuery({
    queryKey: ["org", orgSlug, "audience", conditions],
    queryFn: () =>
      api<{ count: number; sample: string[] }>(`/orgs/${orgSlug}/audience`, {
        body: { audience: conditions },
      }),
  })

  const setCondition = (index: number, ids: string[]) =>
    onChange(value.map((c, i) => (i === index ? ids : c)))
  const shown = value.length === 0 ? [[]] : value

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-caption font-semibold text-ink">
        Who it&apos;s for
      </legend>
      <p className="text-xs text-body">
        Tick groups in a box to include anyone in any of them. Add another box
        to narrow it down: people must be in every box. Nothing ticked means
        everyone in the organization.
      </p>
      {shown.map((condition, index) => (
        <div key={index} className="grid gap-1.5">
          {index > 0 && (
            <div className="text-caption-upper text-primary uppercase">
              and also in
            </div>
          )}
          <div
            data-testid="audience-condition"
            className="grid gap-1.5 rounded-md border border-hairline p-2.5"
          >
            {groups.length === 0 && (
              <p className="text-xs text-body">
                This organization has no groups yet.
              </p>
            )}
            <GroupChecklist
              groups={groups}
              levels={data?.levels}
              value={condition}
              labelFor={(g) =>
                index === 0 ? g.name : `${g.name} (condition ${index + 1})`
              }
              onChange={(ids) => {
                // Stored as the topmost groups: the same people, a clearer summary.
                const next = topmost(groups, ids)
                if (value.length === 0) onChange([next])
                else setCondition(index, next)
              }}
            />
            {index > 0 && (
              <Button
                size="xs"
                variant="ghost"
                className="justify-self-start"
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                Remove this condition
              </Button>
            )}
          </div>
        </div>
      ))}
      {value.length > 0 &&
        value.length < 5 &&
        value[value.length - 1]!.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="justify-self-start"
            onClick={() => onChange([...value, []])}
          >
            + And also in…
          </Button>
        )}
      <p data-testid="audience-summary" className="text-caption text-ink">
        {conditions.length === 0
          ? "Everyone in the organization"
          : conditions
              .map((c) => c.map(name).join(" or "))
              .map((text, i) =>
                i === 0 ? `People in ${text}` : `also in ${text}`
              )
              .join(", ")}
        {preview.data && (
          <span className="text-body">
            {" "}
            · {preview.data.count}{" "}
            {preview.data.count === 1 ? "person" : "people"}
            {preview.data.sample.length > 0 &&
              ` (${preview.data.sample.join(", ")}${preview.data.count > preview.data.sample.length ? ", …" : ""})`}
          </span>
        )}
      </p>
    </fieldset>
  )
}
