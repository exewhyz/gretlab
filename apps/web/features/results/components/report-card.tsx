"use client"

import {
  DotsThreeIcon,
  PencilSimpleIcon,
  PlusIcon,
  PrinterIcon,
} from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Fragment, useEffect, useMemo, useRef, useState } from "react"

import { Badge } from "@workspace/ui/components/badge"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import { Progress } from "@workspace/ui/components/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { cn } from "@workspace/ui/lib/utils"

import { ConfirmDialog } from "@/components/confirm"
import {
  Check,
  Field,
  FormMessage,
  SelectInput,
  TextArea,
  TextInput,
} from "@/components/form"
import { Loading, PageTitle, Stats } from "@/features/admin/components/shell"
import { api, ApiRequestError } from "@/lib/api/client"
import { orgPages } from "@/lib/paths"
import type { ApiResult } from "@/lib/api/types"
import type { getExam } from "@/features/results/server"
import type { examResults, reportCard } from "@/features/results/server"
import type { listExams } from "@/features/results/server"
import type {
  addPapers,
  addTerm,
  examSettings,
  setPublished,
} from "@/features/results/server"

import { RESULT, fmt } from "./results-parts"

export type ReportCardData = ApiResult<typeof reportCard>

export function ReportCard({
  slug,
  studentId,
}: {
  slug: string
  studentId: string
}) {
  const [yearId, setYearId] = useState("")
  const { data, error } = useQuery({
    queryKey: ["org", slug, "report-card", studentId, yearId],
    queryFn: () =>
      api<ReportCardData>(
        `/orgs/${slug}/report-cards/${studentId}${yearId ? `?yearId=${yearId}` : ""}`
      ),
  })
  if (!data) return <Loading error={error} />
  const weighted = data.exams.some((e) => e.weight > 0)
  return (
    <>
      <style>{`@media print {
        body * { visibility: hidden !important; }
        #report-card, #report-card * { visibility: visible !important; }
        #report-card { position: absolute; inset: 0 auto auto 0; width: 100%; padding: 0; }
        @page { margin: 14mm; }
      }`}</style>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 print:hidden">
        {data.years.length > 1 ? (
          <div className="w-48">
            <Field label="Academic year">
              <SelectInput
                value={data.year.id}
                onChange={(e) => setYearId(e.target.value)}
              >
                {data.years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
          </div>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <a
            href={`/api/v1/orgs/${slug}/report-cards/${studentId}/pdf?yearId=${data.year.id}`}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: "outline" })}
            data-testid="report-pdf"
          >
            Download PDF
          </a>
          <Button variant="outline" onClick={() => window.print()}>
            <PrinterIcon /> Print
          </Button>
        </div>
      </div>
      <article
        id="report-card"
        data-testid="report-card"
        className="mx-auto grid max-w-4xl gap-5 rounded-xl border border-hairline bg-card p-5 sm:p-8"
      >
        <header className="grid gap-1 border-b border-hairline pb-4 text-center">
          <div className="text-title-lg text-ink">{data.org.name}</div>
          <div className="text-body-sm tracking-wide text-muted-foreground uppercase">
            Report card · {data.year.name}
          </div>
        </header>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-body-sm sm:grid-cols-4">
          {[
            ["Student", data.student.name],
            ["Admission no.", data.student.admissionNo ?? "–"],
            ["Class", data.year.class ?? "–"],
            [
              "Roll no.",
              data.year.rollNo == null ? "–" : String(data.year.rollNo),
            ],
            ...(data.year.classTeacher
              ? [["Class teacher", data.year.classTeacher]]
              : []),
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-caption text-muted-foreground">{k}</dt>
              <dd className="font-medium text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        {data.credits && data.credits.terms.length > 0 && (
          <section className="grid gap-4" data-testid="grade-card">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <h2 className="text-title-sm text-ink">Grade card</h2>
              <div className="flex gap-4 text-body-sm">
                <span>
                  CGPA{" "}
                  <span
                    className="text-title-md font-semibold text-ink tabular-nums"
                    data-testid="cgpa"
                  >
                    {data.credits.cgpa == null
                      ? "–"
                      : data.credits.cgpa.toFixed(2)}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  {data.credits.earned} credits earned
                </span>
              </div>
            </div>
            {data.credits.terms.map((t) => (
              <div key={t.id} className="grid gap-2" data-testid="grade-term">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-medium text-ink">{t.name}</h3>
                  <span className="text-body-sm text-muted-foreground">
                    SGPA{" "}
                    <span
                      className="font-semibold text-ink tabular-nums"
                      data-testid="sgpa"
                    >
                      {t.sgpa == null ? "–" : t.sgpa.toFixed(2)}
                    </span>
                    {" · "}
                    {t.earned} of {t.credits} credits
                    {t.backlogs > 0 && (
                      <span className="text-destructive">
                        {" "}
                        · {t.backlogs} backlog{t.backlogs === 1 ? "" : "s"}
                      </span>
                    )}
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-body-sm">
                    <thead>
                      <tr className="border-b border-hairline text-left text-caption text-muted-foreground">
                        <th className="py-1.5 pr-3 font-medium">Code</th>
                        <th className="py-1.5 pr-3 font-medium">Course</th>
                        <th className="px-2 py-1.5 text-right font-medium">
                          Credits
                        </th>
                        <th className="px-2 py-1.5 text-right font-medium">
                          Grade
                        </th>
                        <th className="px-2 py-1.5 text-right font-medium">
                          Points
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {t.courses.map((c) => (
                        <tr
                          key={c.subjectId}
                          className="border-b border-hairline/60"
                        >
                          <td className="py-1.5 pr-3 font-mono text-xs text-muted-foreground">
                            {c.code || "–"}
                          </td>
                          <td className="py-1.5 pr-3 text-ink">{c.name}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {c.credits ?? "–"}
                          </td>
                          <td
                            className={cn(
                              "px-2 py-1.5 text-right font-medium",
                              c.points === 0 && "text-destructive"
                            )}
                          >
                            {c.grade ?? "–"}
                          </td>
                          <td className="px-2 py-1.5 text-right tabular-nums">
                            {c.points ?? "–"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </section>
        )}
        {data.exams.length === 0 ? (
          <p className="py-8 text-center text-body-sm text-muted-foreground">
            No results published for {data.year.name} yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table
              className="w-full border-collapse text-body-sm"
              data-testid="report-table"
            >
              <thead>
                <tr className="border-b border-hairline text-left">
                  <th className="py-2 pr-3 font-semibold">Subject</th>
                  {data.exams.map((e) => (
                    <th
                      key={e.id}
                      className="px-2 py-2 text-right font-semibold"
                      colSpan={2}
                    >
                      {e.name}
                      {!e.published && (
                        <span className="ml-1 font-normal text-muted-foreground">
                          (draft)
                        </span>
                      )}
                      {e.weight > 0 && (
                        <div className="font-normal text-muted-foreground">
                          weight {e.weight}
                        </div>
                      )}
                    </th>
                  ))}
                  {weighted && (
                    <th
                      className="px-2 py-2 text-right font-semibold"
                      colSpan={2}
                    >
                      Year
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {data.subjects.map((s) => (
                  <tr
                    key={s.subjectId}
                    className="border-b border-hairline/60"
                    data-testid="report-subject"
                  >
                    <td className="py-2 pr-3 font-medium text-ink">{s.name}</td>
                    {data.exams.map((e) => {
                      const p = e.papers.find(
                        (x) => x.subjectId === s.subjectId
                      )
                      return (
                        <Fragment key={e.id}>
                          <td
                            className={cn(
                              "px-2 py-2 text-right tabular-nums",
                              (p?.outcome === "fail" ||
                                p?.outcome === "absent") &&
                                "text-destructive"
                            )}
                          >
                            {!p
                              ? ""
                              : p.absent
                                ? "AB"
                                : p.marks == null
                                  ? "–"
                                  : `${fmt(p.marks)}/${p.maxMarks}`}
                          </td>
                          <td className="px-2 py-2 text-right text-muted-foreground">
                            {p?.grade ?? ""}
                          </td>
                        </Fragment>
                      )
                    })}
                    {weighted && (
                      <>
                        <td className="px-2 py-2 text-right tabular-nums">
                          {s.final == null ? "–" : `${fmt(s.final)}%`}
                        </td>
                        <td className="px-2 py-2 text-right font-medium">
                          {s.grade ?? ""}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink/20 font-medium">
                  <td className="py-2 pr-3">Total</td>
                  {data.exams.map((e) => (
                    <Fragment key={e.id}>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {e.maxMarks ? `${fmt(e.obtained)}/${e.maxMarks}` : "–"}
                      </td>
                      <td className="px-2 py-2 text-right">{e.grade ?? ""}</td>
                    </Fragment>
                  ))}
                  {weighted && (
                    <>
                      <td
                        className="px-2 py-2 text-right tabular-nums"
                        data-testid="report-final"
                      >
                        {data.final ? `${fmt(data.final.percent)}%` : "–"}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {data.final?.grade ?? ""}
                      </td>
                    </>
                  )}
                </tr>
                <tr className="text-muted-foreground">
                  <td className="py-1 pr-3">Percentage</td>
                  {data.exams.map((e) => (
                    <td
                      key={e.id}
                      className="px-2 py-1 text-right tabular-nums"
                      colSpan={2}
                    >
                      {e.percent == null ? "–" : `${fmt(e.percent)}%`}
                    </td>
                  ))}
                  {weighted && <td colSpan={2} />}
                </tr>
                <tr className="text-muted-foreground">
                  <td className="py-1 pr-3">Rank in class</td>
                  {data.exams.map((e) => (
                    <td
                      key={e.id}
                      className="px-2 py-1 text-right tabular-nums"
                      colSpan={2}
                    >
                      {e.rank == null ? "–" : `${e.rank} of ${e.of}`}
                    </td>
                  ))}
                  {weighted && <td colSpan={2} />}
                </tr>
                <tr>
                  <td className="py-1 pr-3 text-muted-foreground">Result</td>
                  {data.exams.map((e) => (
                    <td
                      key={e.id}
                      className={cn(
                        "px-2 py-1 text-right",
                        RESULT[e.result]?.tone
                      )}
                      colSpan={2}
                      data-testid="report-result"
                    >
                      {RESULT[e.result]?.label}
                    </td>
                  ))}
                  {weighted && <td colSpan={2} />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        {data.exams.some((e) => e.remark || e.subjectRemarks.length > 0) && (
          <section className="grid gap-3" data-testid="report-remarks">
            <h2 className="text-title-sm text-ink">Remarks</h2>
            {data.exams
              .filter((e) => e.remark || e.subjectRemarks.length > 0)
              .map((e) => (
                <div key={e.id} className="grid gap-1 text-body-sm">
                  <div className="font-medium text-ink">{e.name}</div>
                  {e.remark && <p className="text-ink">{e.remark}</p>}
                  {e.subjectRemarks.length > 0 && (
                    <ul className="grid gap-0.5 text-muted-foreground">
                      {e.subjectRemarks.map((r) => (
                        <li key={r.subject}>
                          <span className="font-medium text-ink">
                            {r.subject}:
                          </span>{" "}
                          {r.text}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
          </section>
        )}
        <footer className="grid gap-1 border-t border-hairline pt-3 text-caption text-muted-foreground">
          <div>
            Grades: {data.scale.map((b) => `${b.grade} ${b.min}%+`).join(" · ")}
            . AB: absent.
          </div>
        </footer>
      </article>
    </>
  )
}
