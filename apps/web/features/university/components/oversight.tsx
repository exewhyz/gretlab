"use client"

import { keepPreviousData, useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

import { Figure, Figures } from "@/components/figures"
import { TextInput } from "@/components/form"
import {
  Loading,
  PageTitle,
  Pager,
  PercentBar,
  Table,
} from "@/features/admin/components/shell"
import type {
  universityCollege,
  universityOverview,
} from "@/features/university/oversight"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { orgPages } from "@/lib/paths"
import { useDebounced } from "@/lib/use-debounced"

type Overview = ApiResult<typeof universityOverview>
type College = ApiResult<typeof universityCollege>

function Search({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  label: string
  placeholder: string
}) {
  return (
    <div className="w-full sm:w-72">
      <TextInput
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

/** A university's Manage › Oversight: each affiliated college at a glance. */
export function UniversityOversight({ slug }: { slug: string }) {
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const query = useDebounced(q)
  const { data, error, isPlaceholderData } = useQuery({
    queryKey: ["org", slug, "oversight", query, page],
    queryFn: () =>
      api<Overview>(
        `/orgs/${slug}/oversight?page=${page}&q=${encodeURIComponent(query)}`
      ),
    placeholderData: keepPreviousData,
  })
  if (!data) return <Loading error={error} />
  return (
    <div className="grid min-w-0 gap-4 *:min-w-0">
      <PageTitle>Oversight</PageTitle>
      <p className="max-w-[70ch] text-body-sm text-body">
        Your affiliated colleges&apos; academics: registered students,
        attendance over the last {data.days.attendance} days, the latest
        published results and coding lab use over {data.days.coding} days. Never
        their fees, parents, hostel, transport, leave or staff.
      </p>
      <Figures>
        <Figure label="Colleges" value={data.totals.colleges} />
        <Figure label="Registered students" value={data.totals.registered} />
        <Figure label="Registrations waiting" value={data.totals.waiting} />
      </Figures>
      <Search
        label="Search colleges"
        placeholder="Name or college code"
        value={q}
        onChange={(v) => {
          setQ(v)
          setPage(1)
        }}
      />
      {data.items.length === 0 ? (
        <p className="text-body-sm text-body">
          {query ? "No college matches." : "No affiliated colleges yet."}
        </p>
      ) : (
        <div className={isPlaceholderData ? "opacity-60" : undefined}>
          <Table
            headers={[
              "College",
              "Students",
              "Attendance",
              "Latest results",
              "Coding lab",
            ]}
          >
            {data.items.map((c) => (
              <tr key={c.id} data-testid="oversight-college">
                <td>
                  <Link
                    className="font-medium text-ink underline-offset-2 hover:underline"
                    href={orgPages(slug).manage(`/oversight/${c.id}`)}
                  >
                    {c.name}
                  </Link>
                  {c.code && (
                    <span className="ml-2 font-mono text-caption">
                      {c.code}
                    </span>
                  )}
                </td>
                <td className="tabular-nums">
                  {c.registered}
                  {c.waiting > 0 && (
                    <span className="block text-caption">
                      {c.waiting} waiting
                    </span>
                  )}
                </td>
                <td>
                  <PercentBar value={c.attendance} low={75} />
                </td>
                <td>
                  {c.results ? (
                    <>
                      <PercentBar value={c.results.percent} low={50} />
                      <span className="block text-caption">
                        {c.results.passed} of {c.results.sat} passed ·{" "}
                        {c.results.exam}, sem {c.results.semester}
                      </span>
                    </>
                  ) : (
                    <span className="text-caption">None published yet</span>
                  )}
                </td>
                <td className="tabular-nums">
                  {c.submissions}
                  <span className="block text-caption">
                    {c.submissions === 1
                      ? "graded submission"
                      : "graded submissions"}
                  </span>
                </td>
              </tr>
            ))}
          </Table>
          <Pager
            page={data.page}
            pages={data.pages}
            total={data.total}
            perPage={data.perPage}
            onPage={setPage}
          />
        </div>
      )}
    </div>
  )
}

/** One affiliated college: its registered students with attendance, coding and results. */
export function UniversityCollegeView({
  slug,
  collegeId,
}: {
  slug: string
  collegeId: string
}) {
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const query = useDebounced(q)
  const { data, error, isPlaceholderData } = useQuery({
    queryKey: ["org", slug, "oversight", collegeId, query, page],
    queryFn: () =>
      api<College>(
        `/orgs/${slug}/oversight/${collegeId}?page=${page}&q=${encodeURIComponent(query)}`
      ),
    placeholderData: keepPreviousData,
  })
  if (!data) return <Loading error={error} />
  return (
    <div className="grid min-w-0 gap-4 *:min-w-0">
      <PageTitle>{data.college.name}</PageTitle>
      <p className="text-body-sm text-body">
        <Link
          className="text-ink underline underline-offset-2"
          href={orgPages(slug).manage("/oversight")}
        >
          Oversight
        </Link>
        {data.college.code && (
          <>
            {" · "}College code{" "}
            <span className="font-mono text-ink">{data.college.code}</span>
          </>
        )}
        {data.latestExam &&
          ` · Results from ${data.latestExam.name}, semester ${data.latestExam.semester}`}
      </p>
      <Figures>
        <Figure label="Registered students" value={data.total} />
      </Figures>
      <Search
        label="Search students"
        placeholder="Name or registration number"
        value={q}
        onChange={(v) => {
          setQ(v)
          setPage(1)
        }}
      />
      {data.items.length === 0 ? (
        <p className="text-body-sm text-body">
          {query ? "No student matches." : "No registered students yet."}
        </p>
      ) : (
        <div className={isPlaceholderData ? "opacity-60" : undefined}>
          <Table
            headers={[
              "Registration",
              "Student",
              "Program",
              "Attendance",
              "SGPA",
              "Coding lab",
            ]}
          >
            {data.items.map((s) => (
              <tr key={s.studentId} data-testid="oversight-student">
                <td className="font-mono text-ink">{s.regNo ?? "—"}</td>
                <td className="text-ink">{s.name}</td>
                <td>
                  {s.program}
                  <span className="block text-caption">
                    Admitted {s.admissionYear}
                  </span>
                </td>
                <td>
                  <PercentBar value={s.attendance} low={75} />
                </td>
                <td className="tabular-nums">
                  {s.result ? (
                    <>
                      {s.result.sgpa == null ? "—" : s.result.sgpa.toFixed(2)}
                      {s.result.backlogs > 0 && (
                        <span className="block text-caption text-destructive">
                          {s.result.backlogs} backlog
                          {s.result.backlogs === 1 ? "" : "s"}
                        </span>
                      )}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="tabular-nums">{s.submissions}</td>
              </tr>
            ))}
          </Table>
          <Pager
            page={data.page}
            pages={data.pages}
            total={data.total}
            perPage={data.perPage}
            onPage={setPage}
          />
        </div>
      )}
    </div>
  )
}
