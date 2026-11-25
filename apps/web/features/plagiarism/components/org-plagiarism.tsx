"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Slider } from "@workspace/ui/components/slider"

import { Field, SelectInput } from "@/components/form"
import { Card, Loading, PageTitle } from "@/features/admin/components/shell"
import type { orgCheckable, orgSimilarity } from "@/features/plagiarism/server"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"

import { SimilarPairs, type PairDetail } from "./similar-pairs"

type Work = ApiResult<typeof orgCheckable>[number]
type Result = Exclude<ApiResult<typeof orgSimilarity>, { pair: unknown }>

/**
 * Manage › Plagiarism check: one of the organization's assignments (students the person may
 * grade) or contests (that they run), and one of its problems.
 */
export function OrgPlagiarism({ slug }: { slug: string }) {
  const work = useQuery({
    queryKey: ["org", slug, "plagiarism"],
    queryFn: () => api<Work[]>(`/orgs/${slug}/plagiarism`),
  })
  const [workKey, setWorkKey] = useState("")
  const [problemId, setProblemId] = useState("")
  const [threshold, setThreshold] = useState(80)
  // What the last check was of, so Compare asks within that same check.
  const [checked, setChecked] = useState<{
    work: { kind: Work["kind"]; id: string }
    problemId: string
    threshold: number
  } | null>(null)
  const chosen = work.data?.find((w) => `${w.kind}:${w.id}` === workKey)
  const check = useMutation({
    mutationFn: (input: NonNullable<typeof checked>) =>
      api<Result>(`/orgs/${slug}/plagiarism`, { body: input }),
    onSuccess: (_, input) => setChecked(input),
    meta: { quiet: true },
  })
  if (!work.data) return <Loading error={work.error} />
  return (
    <div className="grid gap-4" data-testid="org-plagiarism">
      <PageTitle>Plagiarism check</PageTitle>
      <p className="max-w-3xl text-body-sm text-body">
        Finds students whose accepted code for a problem is unusually similar,
        among the students you grade. Renaming variables, reformatting or adding
        comments doesn&apos;t hide a copy. A match is a reason to look closer
        and talk to the students, not proof: short or standard solutions can
        look alike. Each check is recorded in the activity log.
      </p>
      {work.data.length === 0 ? (
        <p className="text-body-sm text-body">
          No assignments or contests with problems to check yet.
        </p>
      ) : (
        <Card className="grid gap-3 min-[901px]:grid-cols-[2fr_2fr_1fr_auto] min-[901px]:items-end">
          <Field label="Assignment or contest">
            <SelectInput
              value={workKey}
              onChange={(e) => {
                setWorkKey(e.target.value)
                setProblemId("")
              }}
            >
              <option value="">Choose one</option>
              {work.data.map((w) => (
                <option key={`${w.kind}:${w.id}`} value={`${w.kind}:${w.id}`}>
                  {w.kind === "contest" ? "Contest: " : ""}
                  {w.title}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Problem">
            <SelectInput
              value={problemId}
              disabled={!chosen}
              onChange={(e) => setProblemId(e.target.value)}
            >
              <option value="">Choose a problem</option>
              {chosen?.problems.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label={`Similarity ≥ ${threshold}%`}>
            <Slider
              aria-label="Similarity threshold"
              min={50}
              max={100}
              step={5}
              value={[threshold]}
              className="py-2"
              onValueChange={(value) =>
                setThreshold(
                  Array.isArray(value) ? (value[0] ?? threshold) : value
                )
              }
            />
          </Field>
          <Button
            disabled={!chosen || !problemId || check.isPending}
            onClick={() =>
              chosen &&
              check.mutate({
                work: { kind: chosen.kind, id: chosen.id },
                problemId,
                threshold: threshold / 100,
              })
            }
          >
            Check
          </Button>
        </Card>
      )}
      {check.error && (
        <p role="alert" className="text-body-sm text-destructive">
          {check.error.message}
        </p>
      )}
      {check.data && checked && (
        <SimilarPairs
          result={check.data}
          compare={(a, b) =>
            api<{ pair: PairDetail }>(`/orgs/${slug}/plagiarism`, {
              body: { ...checked, compare: { a, b } },
            })
          }
        />
      )}
    </div>
  )
}
