"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { VERDICTS } from "@workspace/judge"
import Link from "next/link"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"

import { SelectInput, TextInput } from "@/components/form"
import {
  formatMemory,
  formatRuntime,
  VerdictText,
} from "@/features/submissions/components/verdict-badge"
import type { SubmissionRow } from "@/features/submissions/types"
import { api } from "@/lib/api/client"
import { formatDateTime } from "@/lib/format"

import { Loading, PageTitle, Table } from "./shell"
import type { ApiResult } from "@/lib/api/types"
import type { listAllSubmissions } from "@/features/admin/server"

type Page = ApiResult<typeof listAllSubmissions>

export function AdminSubmissions() {
  const [kind, setKind] = useState("submit")
  const [verdict, setVerdict] = useState("")
  const [search, setSearch] = useState("")

  const { data, error, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteQuery({
      queryKey: ["admin", "submissions", kind, verdict, search],
      initialPageParam: "",
      queryFn: ({ pageParam }) => {
        const params = new URLSearchParams({ kind })
        if (verdict) params.set("verdict", verdict)
        if (search) params.set("search", search)
        if (pageParam) params.set("before", pageParam)
        return api<Page>(`/admin/submissions?${params}`)
      },
      getNextPageParam: (last) => last.next,
      refetchInterval: 5000,
    })
  const rows = data?.pages.flatMap((page) => page.rows)

  return (
    <>
      <PageTitle>Submissions</PageTitle>
      <div className="mb-3 flex flex-wrap gap-2">
        <TextInput
          aria-label="Search by student or problem"
          placeholder="Search student or problem"
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
          <option value="submit">Graded submissions</option>
          <option value="run">Runs</option>
          <option value="all">Both</option>
        </SelectInput>
        <SelectInput
          aria-label="Result"
          className="w-52"
          value={verdict}
          onChange={(event) => setVerdict(event.target.value)}
        >
          <option value="">Any result</option>
          {Object.entries(VERDICTS).map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </SelectInput>
      </div>
      {!rows ? (
        <Loading error={error} />
      ) : rows.length === 0 ? (
        <p className="text-body-sm text-body">Nothing matches.</p>
      ) : (
        <>
          <Table
            headers={[
              "When",
              "Student",
              "Problem",
              "Result",
              "Tests",
              "Language",
              "Runtime",
              "Memory",
            ]}
          >
            {rows.map((row) => (
              <tr key={row.id}>
                <td className="whitespace-nowrap">
                  <Link
                    href={`/submissions/${row.id}`}
                    className="underline-offset-2 hover:underline"
                  >
                    {formatDateTime(row.createdAt)}
                  </Link>
                </td>
                <td>{row.email}</td>
                <td>
                  {row.problem ?? "Playground"}
                  {row.contest && (
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
                  {row.kind === "run" && (
                    <div className="text-xs font-normal text-body">Run</div>
                  )}
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
              </tr>
            ))}
          </Table>
          {hasNextPage && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              Show more
            </Button>
          )}
        </>
      )}
    </>
  )
}
