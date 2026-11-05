"use client"

import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"

import { useQuestionSession } from "@/features/lab/hooks/use-question-session"
import { api } from "@/lib/api/client"

import type { SubmissionRow } from "../types"
import { SubmissionDetailView } from "./submission-view"
import {
  formatMemory,
  formatRuntime,
  formatWhen,
  VerdictText,
} from "./verdict-badge"

/** This problem's graded attempts by this student. Runs aren't listed: they aren't submissions. */
export function SubmissionsPanel() {
  const { question, contestSlug, viewer, files } = useQuestionSession()
  const pathname = usePathname()
  const [openId, setOpenId] = useState<string | null>(null)
  const params = new URLSearchParams({ problem: question.id })
  if (contestSlug) params.set("contest", contestSlug)
  const { data, error } = useQuery({
    queryKey: ["submissions", "list", question.id, contestSlug ?? ""],
    queryFn: () => api<SubmissionRow[]>(`/submissions?${params}`),
    enabled: Boolean(viewer?.user),
    refetchInterval: (query) =>
      query.state.data?.some((row) => row.status !== "done") ? 2000 : false,
  })

  const body = "min-h-0 flex-1 overflow-auto p-4 text-body-sm text-body"

  if (viewer && !viewer.user) {
    return (
      <div className={body}>
        <Link
          className="underline underline-offset-2 hover:text-ink"
          href={`/sign-in?callbackUrl=${encodeURIComponent(pathname)}`}
        >
          Sign in
        </Link>{" "}
        to submit solutions and keep a history of your attempts.
      </div>
    )
  }

  if (openId) {
    return (
      <div className={body}>
        <Button
          variant="ghost"
          size="sm"
          className="mb-2 -ml-2"
          onClick={() => setOpenId(null)}
        >
          ← All submissions
        </Button>
        <SubmissionDetailView
          id={openId}
          onRestore={(submission) =>
            files.restore(submission.files, submission.entry)
          }
        />
      </div>
    )
  }

  return (
    <div className={body}>
      {error && (
        <p role="alert" className="text-destructive">
          {error.message}
        </p>
      )}
      {data?.length === 0 && (
        <p>
          No submissions yet. Press <b>Submit</b> to grade your code against
          every test. <b>Run</b> only tries it out, so it isn&apos;t listed
          here.
        </p>
      )}
      {data && data.length > 0 && (
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-hairline text-caption-upper text-body uppercase">
              <th className="py-2 pr-3 font-semibold">Status</th>
              <th className="py-2 pr-3 font-semibold">Tests</th>
              <th className="py-2 pr-3 font-semibold">Language</th>
              <th className="py-2 pr-3 font-semibold">Runtime</th>
              <th className="py-2 pr-3 font-semibold">Memory</th>
              <th className="py-2 font-semibold">When</th>
            </tr>
          </thead>
          <tbody>
            {data.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-b border-hairline-soft hover:bg-muted"
                onClick={() => setOpenId(row.id)}
              >
                <td className="py-2 pr-3 font-medium">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto justify-start p-0 text-left font-normal hover:bg-transparent"
                    onClick={() => setOpenId(row.id)}
                  >
                    <VerdictText
                      verdict={row.verdict}
                      kind={row.kind}
                      status={row.status}
                    />
                  </Button>
                </td>
                <td className="py-2 pr-3 tabular-nums">
                  {row.totalTests === null
                    ? "—"
                    : `${row.passedTests ?? 0}/${row.totalTests}`}
                </td>
                <td className="py-2 pr-3">{row.language}</td>
                <td className="py-2 pr-3 whitespace-nowrap tabular-nums">
                  {formatRuntime(row.runtimeMs)}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap tabular-nums">
                  {formatMemory(row.memoryKb)}
                </td>
                <td className="py-2 whitespace-nowrap">
                  {formatWhen(row.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
