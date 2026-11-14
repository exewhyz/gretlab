"use client"

import { DotsThreeIcon, UserIcon } from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

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
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@workspace/ui/components/sheet"
import { Skeleton } from "@workspace/ui/components/skeleton"
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
  Check,
  Field,
  FormMessage,
  SelectInput,
  TextArea,
  TextInput,
} from "@/components/form"
import { Loading } from "@/features/admin/components/shell"
import { CampusSummary } from "@/features/campus/components/campus"
import { GroupPicker } from "@/features/orgs/components/group-picker"
import { api } from "@/lib/api/client"
import { orgPages } from "@/lib/paths"
import type { ApiResult } from "@/lib/api/types"
import type { getStudent } from "@/features/records/server"
import type { nextNumber } from "@/features/records/server"

import { GENDER, longDate } from "./records-parts"
import type { List } from "./students"

export type Profile = ApiResult<typeof getStudent>

/** Add or edit a student, in a sheet from the side. */
export function StudentSheet({
  slug,
  list,
  student,
  onDone,
}: {
  slug: string
  list: Pick<List, "groups" | "levels" | "choosable" | "year">
  student: Profile | null
  onDone: () => void
}) {
  const client = useQueryClient()
  const next = useQuery({
    queryKey: ["org", slug, "students", "next-number"],
    queryFn: () =>
      api<ApiResult<typeof nextNumber>>(`/orgs/${slug}/students/next-number`),
    enabled: !student,
  })
  const [form, setForm] = useState({
    name: student?.name ?? "",
    email: student?.email ?? "",
    admissionNo: student?.admissionNo ?? "",
    gender: student?.gender ?? "",
    birthDate: student?.birthDate ?? "",
    phone: student?.phone ?? "",
    address: student?.address ?? "",
    groupId:
      student?.current?.status === "active"
        ? (student.current.group?.id ?? "")
        : "",
    rollNo:
      student?.current?.rollNo != null ? String(student.current.rollNo) : "",
  })
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [k]: e.target.value })
  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        admissionNo: form.admissionNo || next.data?.admissionNo || "",
        groupId: form.groupId || null,
        rollNo: form.rollNo ? Number(form.rollNo) : null,
      }
      return student
        ? api(`/orgs/${slug}/students/${student.id}`, { method: "PUT", body })
        : api(`/orgs/${slug}/students`, { body })
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["org", slug] })
      onDone()
    },
  })
  return (
    <Sheet open onOpenChange={(open) => !open && onDone()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {student ? `Edit ${student.name}` : "Add student"}
          </SheetTitle>
          <SheetDescription>
            {student
              ? "Update the record, or move them to another class."
              : "Their record, and the class they join this year."}
          </SheetDescription>
        </SheetHeader>
        <form
          className="grid gap-4 px-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-caption font-semibold text-ink">
              Student
            </legend>
            <Field label="Full name">
              <TextInput value={form.name} onChange={set("name")} autoFocus />
            </Field>
            <Field
              label="Email for signing in"
              help={
                student?.email
                  ? undefined
                  : "Leave empty for a student who won't sign in, such as a young child."
              }
            >
              <TextInput
                type="email"
                value={form.email}
                onChange={set("email")}
                disabled={Boolean(student?.email)}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Admission number">
                <TextInput
                  value={form.admissionNo}
                  onChange={set("admissionNo")}
                  placeholder={next.data?.admissionNo}
                />
              </Field>
              <Field label="Gender">
                <SelectInput value={form.gender} onChange={set("gender")}>
                  <option value="">—</option>
                  <option value="female">Female</option>
                  <option value="male">Male</option>
                  <option value="other">Other</option>
                </SelectInput>
              </Field>
              <Field label="Date of birth">
                <TextInput
                  type="date"
                  value={form.birthDate}
                  onChange={set("birthDate")}
                />
              </Field>
              <Field label="Phone">
                <TextInput
                  type="tel"
                  value={form.phone}
                  onChange={set("phone")}
                />
              </Field>
            </div>
            <Field label="Address">
              <TextArea
                rows={2}
                value={form.address}
                onChange={set("address")}
              />
            </Field>
            <p className="text-xs text-muted-foreground">
              Date of birth, phone and address are stored encrypted.
            </p>
          </fieldset>
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-caption font-semibold text-ink">
              Class{list.year ? ` for ${list.year.name}` : ""}
            </legend>
            {list.year ? (
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                <Field label="Class">
                  <GroupPicker
                    label="Class"
                    groups={list.groups}
                    levels={list.levels}
                    value={form.groupId}
                    onChange={(id) => setForm({ ...form, groupId: id })}
                    placeholder="Not yet"
                    extra={[{ value: "", label: "Not yet" }]}
                    isDisabled={(id) => !list.choosable.includes(id)}
                  />
                </Field>
                <Field label="Roll number">
                  <TextInput
                    type="number"
                    min={1}
                    value={form.rollNo}
                    onChange={set("rollNo")}
                  />
                </Field>
              </div>
            ) : (
              <p className="text-body-sm text-muted-foreground">
                Add a current academic year to place students in classes.
              </p>
            )}
          </fieldset>
          {save.error && (
            <FormMessage message={{ text: save.error.message, kind: "err" }} />
          )}
          <SheetFooter className="px-0">
            <Button
              type="submit"
              disabled={!form.name.trim() || save.isPending}
            >
              {student ? "Save changes" : "Add student"}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  )
}

/** Manage › Students › one student: their record, classes by year, family, attendance, campus. */
export function StudentProfile({ slug, id }: { slug: string; id: string }) {
  const client = useQueryClient()
  const { data, error } = useQuery({
    queryKey: ["org", slug, "student", id],
    queryFn: () => api<Profile>(`/orgs/${slug}/students/${id}`),
  })
  const list = useQuery({
    queryKey: ["org", slug, "students", "for-sheet"],
    queryFn: () => api<List>(`/orgs/${slug}/students?page=1`),
    enabled: Boolean(data?.can.edit),
  })
  const [editing, setEditing] = useState(false)
  const [statusTo, setStatusTo] = useState<string | null>(null)
  const status = useMutation({
    mutationFn: (s: string) =>
      api(`/orgs/${slug}/students/${id}/status`, { body: { status: s } }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["org", slug] }),
  })
  if (!data)
    return error ? (
      <Loading error={error} />
    ) : (
      <div className="grid gap-4">
        <Skeleton className="h-16 w-80" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    )
  const cur = data.current
  const initials = data.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
  return (
    <div className="grid gap-5" data-testid="student-profile">
      <Link
        href={orgPages(slug).manage(`/students`)}
        className="text-body-sm text-muted-foreground hover:text-ink"
      >
        ‹ Students
      </Link>
      <div className="flex flex-wrap items-center gap-4">
        <span
          aria-hidden="true"
          className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary-active"
        >
          {initials || <UserIcon />}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-display-sm text-ink">{data.name}</h1>
          <p className="text-body-sm text-muted-foreground">
            {cur?.group && cur.status === "active"
              ? `${cur.group.path}${cur.rollNo != null ? ` · Roll ${cur.rollNo}` : ""}`
              : cur?.status && cur.status !== "active"
                ? `${cur.status[0]!.toUpperCase()}${cur.status.slice(1)} in ${cur.year}`
                : "Not placed in a class"}{" "}
            · {data.admissionNo}
          </p>
        </div>
        {data.can.results && (
          <Link
            href={orgPages(slug).results(id)}
            className={buttonVariants({ variant: "outline" })}
          >
            Report card
          </Link>
        )}
        {data.can.edit && (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setEditing(true)}
              disabled={!list.data}
            >
              Edit
            </Button>
            {cur?.status && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="ghost" size="icon" aria-label="More" />
                  }
                >
                  <DotsThreeIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {cur.status !== "active" && (
                    <DropdownMenuItem onClick={() => status.mutate("active")}>
                      Back in their class
                    </DropdownMenuItem>
                  )}
                  {cur.status === "active" && (
                    <>
                      <DropdownMenuItem
                        onClick={() => setStatusTo("transferred")}
                      >
                        Transferred out
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => setStatusTo("graduated")}
                      >
                        Graduated
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setStatusTo("withdrawn")}
                      >
                        Withdrawn
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
      </div>
      {status.error && (
        <FormMessage message={{ text: status.error.message, kind: "err" }} />
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-title-md">Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-body-sm">
              <dt className="text-muted-foreground">Gender</dt>
              <dd>{GENDER[data.gender] ?? data.gender}</dd>
              <dt className="text-muted-foreground">Date of birth</dt>
              <dd>{data.birthDate ? longDate(data.birthDate) : "—"}</dd>
              <dt className="text-muted-foreground">Phone</dt>
              <dd>{data.phone || "—"}</dd>
              <dt className="text-muted-foreground">Address</dt>
              <dd className="whitespace-pre-wrap">{data.address || "—"}</dd>
              <dt className="text-muted-foreground">Signs in</dt>
              <dd className="break-all">
                {data.email ?? <Badge variant="secondary">No sign-in</Badge>}
              </dd>
              <dt className="text-muted-foreground">Admitted</dt>
              <dd>{longDate(data.admittedOn)}</dd>
            </dl>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-title-md">
              Parents and guardians
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.parents.length === 0 ? (
              <p className="text-body-sm text-muted-foreground">
                No parent linked yet.
              </p>
            ) : (
              <ul className="grid gap-2 text-body-sm">
                {data.parents.map((p) => (
                  <li key={p.email}>
                    <div className="font-medium">
                      {p.name}
                      {p.relation && (
                        <span className="font-normal text-muted-foreground">
                          {" "}
                          · {p.relation}
                        </span>
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {p.email}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-title-md">Attendance</CardTitle>
            <CardDescription>All marked classes</CardDescription>
            {data.attendance && (
              <CardAction>
                <Badge
                  variant={
                    data.attendance.percent < 75 ? "destructive" : "secondary"
                  }
                >
                  {data.attendance.percent}%
                </Badge>
              </CardAction>
            )}
          </CardHeader>
          <CardContent className="text-body-sm text-muted-foreground">
            {data.attendance
              ? `${data.attendance.marked} classes marked`
              : "Not marked yet."}
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="pb-0">
          <CardHeader>
            <CardTitle className="text-title-md">Class by year</CardTitle>
          </CardHeader>
          {data.history.length === 0 ? (
            <CardContent className="pb-6 text-body-sm text-muted-foreground">
              Not enrolled in any year yet.
            </CardContent>
          ) : (
            <Table data-testid="student-history">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Year</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Roll</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.history.map((h) => (
                  <TableRow key={h.year}>
                    <TableCell className="pl-6 font-medium">{h.year}</TableCell>
                    <TableCell>{h.group ?? "—"}</TableCell>
                    <TableCell>{h.rollNo ?? "—"}</TableCell>
                    <TableCell className="capitalize">{h.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
        <div className="[&_[data-testid=campus]]:grid-cols-1">
          <CampusSummary data={data.campus} slug={slug} own={false} />
        </div>
        <TransferCertificates
          slug={slug}
          id={id}
          name={data.name}
          canIssue={data.can.edit}
          active={cur?.status === "active"}
        />
      </div>
      {editing && list.data && (
        <StudentSheet
          slug={slug}
          list={list.data}
          student={data}
          onDone={() => setEditing(false)}
        />
      )}
      {statusTo && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setStatusTo(null)}
          title={`Mark ${data.name} ${statusTo}?`}
          description={`They leave ${cur?.group?.path ?? "their class"} for ${cur?.year}: registers, the timetable and their class page stop including them. Their record and history stay.`}
          confirmLabel={`Mark ${statusTo}`}
          onConfirm={() => status.mutate(statusTo)}
        />
      )}
    </div>
  )
}

export function TransferCertificates({
  slug,
  id,
  name,
  canIssue,
  active,
}: {
  slug: string
  id: string
  name: string
  canIssue: boolean
  active: boolean
}) {
  const client = useQueryClient()
  const url = `/orgs/${slug}/students/${id}/transfer-certificates`
  const { data } = useQuery({
    queryKey: ["org", slug, "tcs", id],
    queryFn: () =>
      api<{
        certificates: {
          id: string
          number: string
          issuedOn: string
          leavingDate: string
        }[]
      }>(url),
  })
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    leavingDate: new Date().toISOString().slice(0, 10),
    reason: "",
    conduct: "Good",
    remarks: "",
    markTransferred: true,
  })
  const issue = useMutation({
    mutationFn: () => api<{ id: string; number: string }>(url, { body: form }),
    onSuccess: (tc) => {
      setOpen(false)
      void client.invalidateQueries({ queryKey: ["org", slug] })
      window.open(
        `/api/v1/orgs/${slug}/transfer-certificates/${tc.id}/pdf`,
        "_blank",
        "noopener"
      )
    },
  })
  const list = data?.certificates ?? []
  if (!canIssue && list.length === 0) return null
  return (
    <Card size="sm" data-testid="transfer-certificates">
      <CardHeader>
        <CardTitle>Transfer certificates</CardTitle>
        <CardDescription>
          {list.length ? `${list.length} issued` : "None issued."}
        </CardDescription>
        {canIssue && (
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
              Issue
            </Button>
          </CardAction>
        )}
      </CardHeader>
      {list.length > 0 && (
        <CardContent className="grid gap-1 text-body-sm">
          {list.map((t) => (
            <a
              key={t.id}
              className="flex justify-between gap-2 hover:underline"
              href={`/api/v1/orgs/${slug}/transfer-certificates/${t.id}/pdf`}
              target="_blank"
              rel="noreferrer"
              data-testid="tc-link"
            >
              <span className="font-medium">{t.number}</span>
              <span className="text-muted-foreground">
                left {longDate(t.leavingDate)}
              </span>
            </a>
          ))}
        </CardContent>
      )}
      {open && (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Transfer certificate for {name}</DialogTitle>
              <DialogDescription>
                It&apos;s numbered and kept as issued; reprints match it.
              </DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <Field label="Date of leaving">
                <TextInput
                  type="date"
                  value={form.leavingDate}
                  onChange={(e) =>
                    setForm({ ...form, leavingDate: e.target.value })
                  }
                />
              </Field>
              <Field label="Reason for leaving">
                <TextInput
                  value={form.reason}
                  placeholder="Family moving to Pune"
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                />
              </Field>
              <Field label="Conduct">
                <TextInput
                  value={form.conduct}
                  onChange={(e) =>
                    setForm({ ...form, conduct: e.target.value })
                  }
                />
              </Field>
              <Field label="Remarks">
                <TextArea
                  value={form.remarks}
                  maxLength={500}
                  onChange={(e) =>
                    setForm({ ...form, remarks: e.target.value })
                  }
                />
              </Field>
              {active && (
                <Check
                  label="Also mark them transferred"
                  checked={form.markTransferred}
                  onCheckedChange={(v) =>
                    setForm({ ...form, markTransferred: v })
                  }
                />
              )}
            </div>
            {issue.error && (
              <FormMessage
                message={{ text: issue.error.message, kind: "err" }}
              />
            )}
            <DialogFooter>
              <Button onClick={() => issue.mutate()} disabled={issue.isPending}>
                Issue and print
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  )
}
