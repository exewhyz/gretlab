"use client"

import { PlusIcon } from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useEffect, useState } from "react"

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert"
import { Badge } from "@workspace/ui/components/badge"
import { Button, buttonVariants } from "@workspace/ui/components/button"
import { Card } from "@workspace/ui/components/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@workspace/ui/components/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table"

import { ConfirmDialog } from "@/components/confirm"
import {
  FormMessage,
  SelectInput,
  TextArea,
  TextInput,
} from "@/components/form"
import { Loading, PageTitle } from "@/features/admin/components/shell"
import { GroupPicker } from "@/features/orgs/components/group-picker"
import { parseCsv } from "@/features/orgs/components/manage"
import { api } from "@/lib/api/client"
import { orgPages } from "@/lib/paths"
import type { ApiResult } from "@/lib/api/types"
import type { importStudents, listStudents } from "@/features/records/server"
import type { recordEveryone, unrecordedCount } from "@/features/records/server"

import { GENDER } from "./records-parts"
import { StudentSheet } from "./student-profile"

export type List = ApiResult<typeof listStudents>

/** Manage › Students: the admission register. */
export function Students({ slug }: { slug: string }) {
  const [q, setQ] = useState("")
  const [search, setSearch] = useState("")
  const [groupId, setGroupId] = useState("")
  const [status, setStatus] = useState("")
  const [page, setPage] = useState(1)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => (setSearch(q), setPage(1)), 300)
    return () => clearTimeout(t)
  }, [q])
  const params = new URLSearchParams(
    Object.entries({ q: search, groupId, status, page: String(page) }).filter(
      ([, v]) => v
    ) as [string, string][]
  )
  const { data, error } = useQuery({
    queryKey: ["org", slug, "students", params.toString()],
    queryFn: () => api<List>(`/orgs/${slug}/students?${params}`),
    placeholderData: (prev) => prev,
  })
  if (!data) return <Loading error={error} />
  return (
    <>
      <PageTitle
        action={
          <div className="flex flex-wrap gap-2">
            {groupId &&
              !data.groups.some((g) => g.parentId === groupId) &&
              data.year && (
                <a
                  href={`/api/v1/orgs/${slug}/students/id-cards/pdf?groupId=${groupId}`}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonVariants({ variant: "outline" })}
                  data-testid="id-cards"
                >
                  ID cards (PDF)
                </a>
              )}
            {data.can.edit && (
              <>
                <Button variant="outline" onClick={() => setImporting(true)}>
                  Import
                </Button>
                <Button onClick={() => setAdding(true)}>
                  <PlusIcon /> Add student
                </Button>
              </>
            )}
          </div>
        }
      >
        {data.terms?.learners ?? "Students"}
      </PageTitle>
      {data.year && <Unrecorded slug={slug} />}
      {!data.year && (
        <Alert className="mb-4">
          <AlertTitle>No current academic year</AlertTitle>
          <AlertDescription>
            Students can be added, but placed in a class only once there&apos;s
            a current year.{" "}
            {data.can.years && (
              <Link
                href={orgPages(slug).manage(`/academic-years`)}
                className="font-medium underline"
              >
                Add one
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}
      <div
        className="mb-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_minmax(0,11rem)]"
        data-testid="student-filters"
      >
        <TextInput
          aria-label="Search students"
          placeholder="Name, email or admission number"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <GroupPicker
          label="Class"
          groups={data.groups}
          levels={data.levels}
          value={groupId}
          onChange={(id) => (setGroupId(id), setPage(1))}
          placeholder="All classes"
          extra={[{ value: "", label: "All classes" }]}
        />
        <SelectInput
          aria-label="Status"
          value={status}
          onChange={(e) => (setStatus(e.target.value), setPage(1))}
        >
          <option value="">Any status</option>
          <option value="active">In a class</option>
          <option value="unplaced">Not placed</option>
          <option value="transferred">Transferred</option>
          <option value="graduated">Graduated</option>
          <option value="withdrawn">Withdrawn</option>
        </SelectInput>
      </div>
      {data.students.length === 0 ? (
        <Empty className="border border-dashed border-hairline">
          <EmptyHeader>
            <EmptyTitle>
              {search || groupId || status
                ? "No students match"
                : "No students yet"}
            </EmptyTitle>
            <EmptyDescription>
              {data.can.edit && !search && !groupId && !status
                ? "Add the first student to start the register."
                : "Try other filters."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="py-0">
          <Table data-testid="students">
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>
                  Class{data.year ? ` (${data.year.name})` : ""}
                </TableHead>
                <TableHead className="hidden md:table-cell">Gender</TableHead>
                <TableHead className="hidden md:table-cell">Sign-in</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.students.map((s) => (
                <TableRow key={s.id} data-testid="student-row">
                  <TableCell>
                    <Link
                      href={orgPages(slug).manage(`/students/${s.id}`)}
                      className="font-medium hover:text-primary-active"
                    >
                      {s.name}
                    </Link>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {s.admissionNo}
                    </div>
                  </TableCell>
                  <TableCell>
                    {s.group && s.status === "active" ? (
                      <span>
                        {s.group.path}
                        {s.rollNo != null && (
                          <span className="text-muted-foreground">
                            {" "}
                            · #{s.rollNo}
                          </span>
                        )}
                      </span>
                    ) : s.status && s.status !== "active" ? (
                      <Badge variant="secondary" className="capitalize">
                        {s.status}
                      </Badge>
                    ) : (
                      <Badge variant="outline">Not placed</Badge>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {GENDER[s.gender] ?? s.gender}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {s.login ? (
                      <span className="text-muted-foreground">Signs in</span>
                    ) : (
                      <Badge variant="secondary">No sign-in</Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      <div className="mt-3 flex items-center justify-between gap-2 text-body-sm text-muted-foreground">
        <span>
          {data.total} student{data.total === 1 ? "" : "s"} · page {data.page}{" "}
          of {data.pages}
        </span>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={data.page <= 1}
            onClick={() => setPage(page - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={data.page >= data.pages}
            onClick={() => setPage(page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
      {importing && (
        <ImportStudents slug={slug} onDone={() => setImporting(false)} />
      )}
      {adding && (
        <StudentSheet
          slug={slug}
          list={data}
          student={null}
          onDone={() => setAdding(false)}
        />
      )}
    </>
  )
}

export function Unrecorded({ slug }: { slug: string }) {
  const client = useQueryClient()
  const { data } = useQuery({
    queryKey: ["org", slug, "students", "unrecorded"],
    queryFn: () =>
      api<ApiResult<typeof unrecordedCount>>(
        `/orgs/${slug}/students/unrecorded`
      ),
  })
  const [asking, setAsking] = useState(false)
  const run = useMutation({
    mutationFn: () =>
      api<ApiResult<typeof recordEveryone>>(
        `/orgs/${slug}/students/unrecorded`,
        {
          method: "POST",
        }
      ),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["org", slug] }),
  })
  if (!data?.count)
    return run.data ? (
      <FormMessage
        message={{ text: `Created ${run.data.added} records.`, kind: "ok" }}
      />
    ) : null
  return (
    <Alert className="mb-4" data-testid="unrecorded">
      <AlertTitle>
        {data.count} {data.count === 1 ? "person is" : "people are"} in a class
        with no student record
      </AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>
          Give each a record and an admission number, in their class for this
          year.
        </span>
        <Button
          size="sm"
          onClick={() => setAsking(true)}
          disabled={run.isPending}
        >
          Create records
        </Button>
        {run.error && (
          <FormMessage message={{ text: run.error.message, kind: "err" }} />
        )}
      </AlertDescription>
      {asking && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setAsking(false)}
          title={`Create ${data.count} student records?`}
          description="Each gets the next admission number and stays in their class. Staff (anyone with a role) are left out."
          confirmLabel="Create records"
          tone="default"
          onConfirm={() => run.mutate()}
        />
      )}
    </Alert>
  )
}

export type ImportReport = ApiResult<typeof importStudents>

export const COLUMNS: Record<string, string> = {
  name: "name",
  "full name": "name",
  student: "name",
  email: "email",
  "e-mail": "email",
  "admission number": "admissionNo",
  "admission no": "admissionNo",
  "admission no.": "admissionNo",
  admission: "admissionNo",
  gender: "gender",
  sex: "gender",
  "date of birth": "birthDate",
  dob: "birthDate",
  "birth date": "birthDate",
  birthday: "birthDate",
  phone: "phone",
  mobile: "phone",
  address: "address",
  class: "class",
  section: "class",
  group: "class",
  roll: "rollNo",
  "roll number": "rollNo",
  "roll no": "rollNo",
  "roll no.": "rollNo",
}

/** Spreadsheet rows to the import's fields, by their header line. */
export function toRows(text: string) {
  const [head, ...lines] = parseCsv(text).filter((r) => r.some((c) => c.trim()))
  if (!head) return { rows: [], unknown: [] as string[] }
  const keys = head.map((h) => COLUMNS[h.trim().toLowerCase()] ?? null)
  return {
    unknown: head
      .filter((_, i) => !keys[i])
      .map((h) => h.trim())
      .filter(Boolean),
    rows: lines.map((cells) => {
      const row: Record<string, string> = {}
      keys.forEach((k, i) => {
        if (k) row[k] = (cells[i] ?? "").trim()
      })
      return row
    }),
  }
}

export function ImportStudents({
  slug,
  onDone,
}: {
  slug: string
  onDone: () => void
}) {
  const client = useQueryClient()
  const [text, setText] = useState("")
  const parsed = toRows(text)
  const check = useMutation({
    mutationFn: (commit: boolean) =>
      api<ImportReport>(`/orgs/${slug}/students/import`, {
        body: { rows: parsed.rows, commit },
      }),
    onSuccess: (r) => {
      if (r.committed)
        void client.invalidateQueries({ queryKey: ["org", slug] })
    },
  })
  const report = check.data
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Import students</DialogTitle>
          <DialogDescription>
            A spreadsheet saved as CSV, with a header line. Columns: name, email
            (leave empty for no sign-in), admission number (empty: the next
            one), gender, date of birth, phone, address, class (like Grade 3 /
            A), roll.
          </DialogDescription>
        </DialogHeader>
        {!report?.committed && (
          <div className="grid gap-2">
            <input
              type="file"
              accept=".csv,text/csv"
              aria-label="CSV file"
              className="text-body-sm"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                if (file) setText(await file.text())
              }}
            />
            <TextArea
              aria-label="Or paste the CSV"
              rows={6}
              mono
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                "name,email,gender,date of birth,class,roll\nAsha K,,female,02/04/2019,Grade 1 / A,1"
              }
            />
            {parsed.unknown.length > 0 && (
              <p className="text-caption text-muted-foreground">
                Ignored columns: {parsed.unknown.join(", ")}
              </p>
            )}
          </div>
        )}
        {report && (
          <div className="grid gap-2" data-testid="import-report">
            <p className="text-body-sm">
              {report.committed
                ? `Added ${report.summary.add} students.`
                : `${report.summary.add} to add, ${report.summary.error} with problems.`}
            </p>
            <div className="max-h-72 overflow-auto rounded-md border border-hairline">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Line</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Result</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.rows.map((r) => (
                    <TableRow key={r.line} data-testid="import-line">
                      <TableCell className="tabular-nums">{r.line}</TableCell>
                      <TableCell>{r.name || "—"}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            r.result === "add" ? "secondary" : "destructive"
                          }
                        >
                          {r.result === "add" ? "Add" : "Problem"}
                        </Badge>{" "}
                        <span className="text-xs text-muted-foreground">
                          {r.note}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
        {check.error && (
          <FormMessage message={{ text: check.error.message, kind: "err" }} />
        )}
        <DialogFooter>
          {report?.committed ? (
            <Button onClick={onDone}>Done</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={onDone}>
                Cancel
              </Button>
              <Button
                variant="outline"
                disabled={parsed.rows.length === 0 || check.isPending}
                onClick={() => check.mutate(false)}
              >
                Check {parsed.rows.length || ""} lines
              </Button>
              <Button
                disabled={
                  !report || report.summary.add === 0 || check.isPending
                }
                onClick={() => check.mutate(true)}
              >
                Add {report?.summary.add ?? ""} students
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
