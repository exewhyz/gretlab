"use client"

import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"

import { Figure, Figures } from "@/components/figures"
import { Check, SelectInput, TextInput } from "@/components/form"
import { Loading, Table } from "@/features/admin/components/shell"
import type { feeReport } from "@/features/fees/reports"
import { useGroups } from "@/features/orgs/components/manage-shared"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { formatDate } from "@/lib/format"

import { rupees } from "./fees-setup"

type Report = ApiResult<typeof feeReport>
type Kind = Report["kind"]

const KINDS: [Kind, string][] = [
  ["collection", "Collection"],
  ["dues", "Dues and defaulters"],
  ["concessions", "Concessions"],
]

const monthStart = () => new Date().toISOString().slice(0, 8) + "01"
const todayIso = () => new Date().toISOString().slice(0, 10)

/** Fees › Reports: collection over a range, who owes and is late, and concessions given. */
export function FeeReports({ slug }: { slug: string }) {
  const [kind, setKind] = useState<Kind>("collection")
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(todayIso())
  const [groupId, setGroupId] = useState("")
  const [overdueOnly, setOverdueOnly] = useState(false)
  const groups = useGroups(slug)
  const params = new URLSearchParams({ kind })
  if (kind === "collection") {
    params.set("from", from)
    params.set("to", to)
  }
  if (kind === "dues") {
    if (groupId) params.set("groupId", groupId)
    if (overdueOnly) params.set("overdueOnly", "true")
  }
  const address = `/orgs/${slug}/fees/reports?${params}`
  const { data, error, isPlaceholderData } = useQuery({
    queryKey: ["org", slug, "fees", "report", params.toString()],
    queryFn: () => api<Report>(address),
    placeholderData: keepPreviousData,
  })
  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <div
          role="group"
          aria-label="Report"
          className="flex flex-wrap gap-1.5"
        >
          {KINDS.map(([k, label]) => (
            <Button
              key={k}
              size="sm"
              variant={kind === k ? "secondary" : "outline"}
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
            >
              {label}
            </Button>
          ))}
        </div>
        {kind === "collection" && (
          <>
            <TextInput
              type="date"
              aria-label="From"
              className="w-40"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
            <TextInput
              type="date"
              aria-label="To"
              className="w-40"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </>
        )}
        {kind === "dues" && groups.data && (
          <>
            <SelectInput
              aria-label="Class"
              className="w-48"
              value={groupId}
              onChange={(e) => setGroupId(e.target.value)}
            >
              <option value="">Every class</option>
              {groups.data.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </SelectInput>
            <Check
              label="Overdue only"
              checked={overdueOnly}
              onCheckedChange={setOverdueOnly}
            />
          </>
        )}
        <a
          className="ml-auto text-body-sm text-ink underline-offset-2 hover:underline"
          href={`/api/v1${address}&format=csv`}
          data-testid="report-csv"
        >
          Download CSV
        </a>
      </div>
      {!data ? (
        <Loading error={error} />
      ) : (
        <div
          className={isPlaceholderData ? "opacity-60" : undefined}
          data-testid="fee-report"
        >
          {data.kind === "collection" && (
            <div className="grid gap-4">
              <Figures>
                <Figure
                  label="Collected"
                  value={rupees(data.total)}
                  hint={`${formatDate(data.from)} – ${formatDate(data.to)}`}
                />
                <Figure label="Receipts" value={data.count} />
                {data.byMode.slice(0, 2).map((m) => (
                  <Figure
                    key={m.label}
                    label={m.label}
                    value={rupees(m.amount)}
                  />
                ))}
              </Figures>
              <div className="grid gap-4 md:grid-cols-2 [&>*]:min-w-0">
                <Table headers={["Fee head", "Collected"]}>
                  {data.byHead.map((h) => (
                    <tr key={h.label}>
                      <td className="text-ink">{h.label}</td>
                      <td className="tabular-nums">{rupees(h.amount)}</td>
                    </tr>
                  ))}
                </Table>
                <Table headers={["Collected by", "Amount"]}>
                  {data.byCollector.map((c) => (
                    <tr key={c.label}>
                      <td className="text-ink">{c.label}</td>
                      <td className="tabular-nums">{rupees(c.amount)}</td>
                    </tr>
                  ))}
                </Table>
              </div>
              <Table
                headers={[
                  "Receipt",
                  "Paid on",
                  "Student",
                  "Plan",
                  "Mode",
                  "Amount",
                ]}
              >
                {data.rows.map((r) => (
                  <tr key={r.id} data-testid="report-row">
                    <td className="font-mono text-ink">{r.receiptNo}</td>
                    <td>{r.paidAt ? formatDate(r.paidAt) : "—"}</td>
                    <td>
                      {r.student}
                      {r.admissionNo && (
                        <span className="block text-caption text-body">
                          {r.admissionNo}
                        </span>
                      )}
                    </td>
                    <td>{r.plan}</td>
                    <td>{r.mode}</td>
                    <td className="tabular-nums">{rupees(r.amount)}</td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
          {data.kind === "dues" && (
            <div className="grid gap-4">
              <Figures>
                <Figure
                  label="Owed"
                  value={rupees(data.owed)}
                  hint={`${data.students} ${data.students === 1 ? "student" : "students"}`}
                />
                <Figure
                  label="Overdue"
                  value={rupees(data.overdue)}
                  hint={`${data.overdueStudents} ${data.overdueStudents === 1 ? "student" : "students"}`}
                  tone={data.overdue > 0 ? "bad" : undefined}
                />
              </Figures>
              {data.rows.length === 0 ? (
                <p className="text-body-sm text-body">
                  Nobody owes anything here.
                </p>
              ) : (
                <Table
                  headers={["Student", "Plans", "Owed", "Overdue", "Days late"]}
                >
                  {data.rows.map((r) => (
                    <tr key={r.studentId} data-testid="report-row">
                      <td>
                        <span className="text-ink">{r.student}</span>
                        <span className="block text-caption text-body">
                          {r.admissionNo ?? r.email}
                        </span>
                      </td>
                      <td className="text-body-sm">{r.plans}</td>
                      <td className="tabular-nums">{rupees(r.owed)}</td>
                      <td
                        className={`tabular-nums ${r.overdue > 0 ? "text-destructive" : ""}`}
                      >
                        {r.overdue > 0 ? rupees(r.overdue) : "—"}
                      </td>
                      <td className="tabular-nums">{r.daysLate || "—"}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </div>
          )}
          {data.kind === "concessions" && (
            <div className="grid gap-4">
              <Figures>
                <Figure label="Concessions" value={data.count} />
              </Figures>
              <Table
                headers={[
                  "Student",
                  "Plan",
                  "Off",
                  "Concession",
                  "Reason",
                  "Given by",
                ]}
              >
                {data.rows.map((r) => (
                  <tr key={r.id} data-testid="report-row">
                    <td>
                      {r.student}
                      {r.admissionNo && (
                        <span className="block text-caption text-body">
                          {r.admissionNo}
                        </span>
                      )}
                    </td>
                    <td>{r.plan}</td>
                    <td>{r.head}</td>
                    <td className="tabular-nums">
                      {r.percent ? `${r.percent}%` : rupees(r.amount ?? 0)}
                    </td>
                    <td>
                      {r.reason}
                      {r.note && (
                        <span className="block text-caption text-body">
                          {r.note}
                        </span>
                      )}
                    </td>
                    <td>{r.givenBy ?? "—"}</td>
                  </tr>
                ))}
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
