"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"

import { Loading, PageTitle, Table } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"

import type { SubmissionRow } from "../types"
import {
  formatMemory,
  formatRuntime,
  formatWhen,
  VerdictText,
} from "./verdict-badge"

export function MySubmissions({ contestSlug }: { contestSlug?: string }) {
  const params = contestSlug ? `?contest=${contestSlug}` : ""
  const { data, error } = useQuery({
    queryKey: ["submissions", "mine", contestSlug ?? ""],
    queryFn: () => api<SubmissionRow[]>(`/submissions${params}`),
    refetchInterval: (query) =>
      query.state.data?.some((row) => row.status !== "done") ? 2000 : false,
  })
  if (!data) return <Loading error={error} />
  if (!data.length) {
    return (
      <p className="text-body-sm text-body">
        No submissions yet. Open a problem from the{" "}
        <Link
          href="/problems"
          className="text-ink underline underline-offset-2"
        >
          problem list
        </Link>
        , write your code and press <b className="text-ink">Submit</b>; it will
        show up here.
      </p>
    )
  }
  return (
    <Table
      headers={[
        "Problem",
        "Status",
        "Tests",
        "Language",
        "Runtime",
        "Memory",
        "When",
      ]}
    >
      {data.map((row) => (
        <tr key={row.id}>
          <td>
            <Link
              href={`/submissions/${row.id}`}
              className="underline-offset-2 hover:underline"
            >
              {row.problem ?? "Problem"}
            </Link>
            {!contestSlug && row.contest && (
              <div className="text-xs text-body">{row.contest}</div>
            )}
          </td>
          <td className="font-medium whitespace-nowrap">
            <Link href={`/submissions/${row.id}`}>
              <VerdictText
                verdict={row.verdict}
                kind={row.kind}
                status={row.status}
              />
            </Link>
          </td>
          <td className="tabular-nums">
            {row.totalTests === null
              ? "—"
              : `${row.passedTests ?? 0}/${row.totalTests}`}
          </td>
          <td>{row.language}</td>
          <td className="whitespace-nowrap tabular-nums">
            {formatRuntime(row.runtimeMs)}
          </td>
          <td className="whitespace-nowrap tabular-nums">
            {formatMemory(row.memoryKb)}
          </td>
          <td className="whitespace-nowrap">{formatWhen(row.createdAt)}</td>
        </tr>
      ))}
    </Table>
  )
}

export function MySubmissionsPage() {
  return (
    <>
      <PageTitle>My submissions</PageTitle>
      <MySubmissions />
    </>
  )
}
