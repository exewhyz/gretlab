"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import { Slider } from "@workspace/ui/components/slider"

import { Field, SelectInput } from "@/components/form"
import { api } from "@/lib/api/client"

import type { StaffProblemList } from "./problems"
import { Card, Loading, PageTitle, Table } from "./shell"
import type { ApiResult } from "@/lib/api/types"
import type { findSimilarSubmissions } from "@/features/catalog/server"
import type { listOwnedContests } from "@/features/contests/server"

type Result = ApiResult<typeof findSimilarSubmissions>

export function AdminIntegrity() {
  const problems = useQuery({
    queryKey: ["admin", "problems"],
    queryFn: () => api<StaffProblemList>("/admin/problems"),
  })
  const contests = useQuery({
    queryKey: ["admin", "contests"],
    queryFn: () => api<ApiResult<typeof listOwnedContests>>("/admin/contests"),
  })
  const [problemSlug, setProblemSlug] = useState("")
  const [contestSlug, setContestSlug] = useState("")
  const [threshold, setThreshold] = useState(80)
  const check = useMutation({
    mutationFn: () =>
      api<Result>("/admin/similarity", {
        body: {
          problemSlug,
          contestSlug: contestSlug || null,
          threshold: threshold / 100,
        },
      }),
  })
  if (!problems.data || !contests.data) {
    return <Loading error={problems.error ?? contests.error} />
  }
  return (
    <>
      <PageTitle>Plagiarism check</PageTitle>
      <p className="mb-3 max-w-3xl text-body-sm text-body">
        Finds students whose accepted code for a problem is unusually similar.
        Renaming variables, reformatting or adding comments doesn&apos;t hide a
        copy. A match is a reason to look closer and talk to the students, not
        proof: short or standard solutions can look alike.
      </p>
      <Card className="mb-4 grid gap-3 min-[901px]:grid-cols-[2fr_2fr_1fr_auto] min-[901px]:items-end">
        <Field label="Problem">
          <SelectInput
            value={problemSlug}
            onChange={(event) => setProblemSlug(event.target.value)}
          >
            <option value="">Choose a problem</option>
            {problems.data.problems.map((problem) => (
              <option key={problem.slug} value={problem.slug}>
                {problem.title}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="Submissions from">
          <SelectInput
            value={contestSlug}
            onChange={(event) => setContestSlug(event.target.value)}
          >
            <option value="">Anywhere</option>
            {contests.data.map((contest) => (
              <option key={contest.slug} value={contest.slug}>
                Contest: {contest.title}
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
          disabled={!problemSlug || check.isPending}
          onClick={() => check.mutate()}
        >
          Check
        </Button>
      </Card>
      {check.error && (
        <p role="alert" className="text-body-sm text-destructive">
          {check.error.message}
        </p>
      )}
      {check.data && (
        <>
          <p className="mb-2 text-body-sm text-body">
            Compared the latest accepted code of {check.data.compared} students.{" "}
            {check.data.pairs.length === 0
              ? "No pairs at this level of similarity."
              : `${check.data.pairs.length} pair(s) to review.`}
          </p>
          {check.data.pairs.length > 0 && (
            <Table
              headers={[
                "Similarity",
                "First student",
                "Second student",
                "Language",
              ]}
            >
              {check.data.pairs.map((pair) => (
                <tr key={`${pair.a.submissionId}-${pair.b.submissionId}`}>
                  <td className="font-semibold tabular-nums">{pair.score}%</td>
                  <td>
                    <Link
                      className="underline-offset-2 hover:underline"
                      href={`/submissions/${pair.a.submissionId}`}
                    >
                      {pair.a.email}
                    </Link>
                  </td>
                  <td>
                    <Link
                      className="underline-offset-2 hover:underline"
                      href={`/submissions/${pair.b.submissionId}`}
                    >
                      {pair.b.email}
                    </Link>
                  </td>
                  <td>{pair.language}</td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}
    </>
  )
}
