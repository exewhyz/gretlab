"use client"

import { ScrollX } from "@workspace/ui/components/scroll-x"
import { cn } from "@workspace/ui/lib/utils"

import type { ReportCardData } from "@/features/results/components/report-card"

type Results = NonNullable<ReportCardData["university"]>

const OUTCOME: Record<string, string> = {
  pass: "Pass",
  fail: "Fail",
  absent: "Absent",
  pending: "Waiting",
}

/** The report card's University results: each published semester, with SGPA and the CGPA. */
export function UniversityResults({ data }: { data: Results }) {
  return (
    <section className="grid gap-4" data-testid="university-results">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-title-sm text-ink">University results</h2>
          <p className="text-body-sm text-muted-foreground">
            {data.university}
            {data.regNo && (
              <>
                {" · "}
                <span className="font-mono text-ink">{data.regNo}</span>
              </>
            )}
          </p>
        </div>
        <span className="text-body-sm">
          CGPA{" "}
          <span
            className="text-title-md font-semibold text-ink tabular-nums"
            data-testid="university-cgpa"
          >
            {data.cgpa == null ? "–" : data.cgpa.toFixed(2)}
          </span>
        </span>
      </div>
      {data.exams.map((e) => (
        <div
          key={e.id}
          className="grid gap-2"
          data-testid="university-semester"
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-medium text-ink">
              Semester {e.semester} · {e.name}
            </h3>
            <span className="text-body-sm text-muted-foreground">
              SGPA{" "}
              <span
                className="font-semibold text-ink tabular-nums"
                data-testid="university-sgpa"
              >
                {e.result.sgpa == null ? "–" : e.result.sgpa.toFixed(2)}
              </span>
              {e.result.complete && (
                <>
                  {" · "}
                  {e.result.earned} of {e.result.credits} credits
                  {e.result.backlogs > 0 && (
                    <span className="text-destructive">
                      {" "}
                      · {e.result.backlogs} backlog
                      {e.result.backlogs === 1 ? "" : "s"}
                    </span>
                  )}
                </>
              )}
            </span>
          </div>
          <ScrollX pinFirst>
            <table className="w-full border-collapse text-body-sm">
              <thead>
                <tr className="border-b border-hairline text-left text-caption text-muted-foreground">
                  <th className="py-1.5 pr-3 font-medium">Course</th>
                  <th className="px-2 py-1.5 text-right font-medium">
                    Credits
                  </th>
                  <th className="px-2 py-1.5 text-right font-medium">
                    Internal
                  </th>
                  <th className="px-2 py-1.5 text-right font-medium">
                    External
                  </th>
                  <th className="px-2 py-1.5 text-right font-medium">Total</th>
                  <th className="px-2 py-1.5 text-right font-medium">Grade</th>
                  <th className="px-2 py-1.5 text-right font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {e.courses.map((c) => (
                  <tr
                    key={c.code + c.name}
                    className="border-b border-hairline/60"
                  >
                    <td className="py-1.5 pr-3 text-ink">
                      {c.name}
                      {c.code && (
                        <span className="ml-2 font-mono text-xs text-muted-foreground">
                          {c.code}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {c.credits}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {c.internalMax === 0
                        ? "–"
                        : `${c.internal ?? "–"}/${c.internalMax}`}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {c.absent
                        ? "AB"
                        : `${c.external ?? "–"}/${c.externalMax}`}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {c.total ?? "–"}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-1.5 text-right font-medium",
                        c.points === 0 && "text-destructive"
                      )}
                    >
                      {c.grade ?? "–"}
                    </td>
                    <td
                      className={cn(
                        "px-2 py-1.5 text-right",
                        (c.outcome === "fail" || c.outcome === "absent") &&
                          "text-destructive"
                      )}
                    >
                      {OUTCOME[c.outcome]}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollX>
        </div>
      ))}
    </section>
  )
}
