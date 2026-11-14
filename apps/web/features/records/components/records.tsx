"use client"

import { DotsThreeIcon, PlusIcon, UserIcon } from "@phosphor-icons/react"
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
import { Loading, PageTitle } from "@/features/admin/components/shell"
import {
  CampusSummary,
  type CampusData,
} from "@/features/campus/components/campus"
import { GroupPicker } from "@/features/orgs/components/group-picker"
import { parseCsv } from "@/features/orgs/components/manage"
import { api } from "@/lib/api/client"
import { orgPages } from "@/lib/paths"
import type { ApiResult } from "@/lib/api/types"
import type {
  getStudent,
  importStudents,
  listStudents,
} from "@/features/records/server"
import type { promotionPlan } from "@/features/records/server"
import type {
  listYears,
  nextNumber,
  promote,
  recordEveryone,
  unrecordedCount,
} from "@/features/records/server"

/* ---------- academic years ---------- */

interface Year {
  id: string
  name: string
  startsOn: string
  endsOn: string
  isCurrent: boolean
  enrolled: number
}

const longDate = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })

/** Manage › Academic years. */
export function AcademicYears({ slug }: { slug: string }) {
  const client = useQueryClient()
  const key = ["org", slug, "academic-years"]
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () =>
      api<ApiResult<typeof listYears>>(`/orgs/${slug}/academic-years`),
  })
  const [editing, setEditing] = useState<Year | "new" | null>(null)
  const [current, setCurrent] = useState<Year | null>(null)
  const [removing, setRemoving] = useState<Year | null>(null)
  const [leads, setLeads] = useState<Year | null>(null)
  const refresh = () => client.invalidateQueries({ queryKey: ["org", slug] })
  const act = useMutation({
    mutationFn: (v: { year: Year; kind: "current" | "delete" }) =>
      v.kind === "current"
        ? api(`/orgs/${slug}/academic-years/${v.year.id}`, {
            method: "PATCH",
            body: { isCurrent: true },
          })
        : api(`/orgs/${slug}/academic-years/${v.year.id}`, {
            method: "DELETE",
          }),
    onSuccess: () => void refresh(),
  })
  if (!data) return <Loading error={error} />
  const can = data.can.years
  return (
    <>
      <PageTitle
        action={
          can && (
            <div className="flex flex-wrap gap-2">
              {data.years.length > 1 && (
                <Link
                  href={orgPages(slug).manage(`/academic-years/promote`)}
                  className={buttonVariants({ variant: "outline" })}
                >
                  Promote students
                </Link>
              )}
              <Button onClick={() => setEditing("new")}>
                <PlusIcon /> Add academic year
              </Button>
            </div>
          )
        }
      >
        {data.terms?.periods ?? "Academic years"}
      </PageTitle>
      <p className="mb-4 max-w-2xl text-body-sm text-muted-foreground">
        Each student has a class for each year. The current year&apos;s classes
        are where students sit now: registers, timetables and parents follow
        them. Making another year current moves everyone to their class in it.
      </p>
      {act.error && (
        <FormMessage message={{ text: act.error.message, kind: "err" }} />
      )}
      {data.years.length === 0 ? (
        <Empty className="border border-dashed border-hairline">
          <EmptyHeader>
            <EmptyTitle>No academic years yet</EmptyTitle>
            <EmptyDescription>
              Add this year, like 2026-2027, and make it current.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="py-0">
          <Table data-testid="years">
            <TableHeader>
              <TableRow>
                <TableHead>Year</TableHead>
                <TableHead>Starts</TableHead>
                <TableHead className="hidden sm:table-cell">Ends</TableHead>
                <TableHead className="text-right">Students</TableHead>
                {can && (
                  <TableHead className="w-10">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.years.map((y) => (
                <TableRow key={y.id} data-testid="year-row">
                  <TableCell className="font-medium">
                    {y.name}{" "}
                    {y.isCurrent && <Badge className="ml-1">Current</Badge>}
                  </TableCell>
                  <TableCell>{longDate(y.startsOn)}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {longDate(y.endsOn)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {y.enrolled}
                  </TableCell>
                  {can && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Actions for ${y.name}`}
                            />
                          }
                        >
                          <DotsThreeIcon />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setEditing(y)}>
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setLeads(y)}>
                            Class teachers
                          </DropdownMenuItem>
                          {!y.isCurrent && (
                            <DropdownMenuItem onClick={() => setCurrent(y)}>
                              Make current
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setRemoving(y)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {editing && (
        <YearDialog
          slug={slug}
          year={editing === "new" ? null : editing}
          onDone={(changed) => (setEditing(null), changed && void refresh())}
        />
      )}
      {leads && (
        <ClassTeachersDialog
          slug={slug}
          year={leads}
          onDone={() => setLeads(null)}
        />
      )}
      {current && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setCurrent(null)}
          title={`Make ${current.name} the current year?`}
          description={`Every student moves to their class in ${current.name}; students with no class in it are left without one. Their classes in other years are kept.`}
          confirmLabel="Make current"
          tone="default"
          onConfirm={() => act.mutate({ year: current, kind: "current" })}
        />
      )}
      {removing && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setRemoving(null)}
          title={`Delete ${removing.name}?`}
          description="Only a year with no students in it can be deleted."
          confirmLabel="Delete"
          onConfirm={() => act.mutate({ year: removing, kind: "delete" })}
        />
      )}
    </>
  )
}

interface LeadSection {
  groupId: string
  name: string
  teacherId: string | null
  options: { id: string; name: string }[]
}

/** Each section's class teacher for a year: they write the report card remarks. */
function ClassTeachersDialog({
  slug,
  year,
  onDone,
}: {
  slug: string
  year: Year
  onDone: () => void
}) {
  const url = `/orgs/${slug}/academic-years/${year.id}/class-teachers`
  const { data, error } = useQuery({
    queryKey: ["org", slug, "class-teachers", year.id],
    queryFn: () => api<{ sections: LeadSection[] }>(url),
  })
  const [chosen, setChosen] = useState<Record<string, string>>({})
  const save = useMutation({
    mutationFn: () =>
      api(url, {
        method: "PUT",
        body: {
          assignments: Object.entries(chosen).map(([groupId, teacherId]) => ({
            groupId,
            teacherId: teacherId || null,
          })),
        },
      }),
    onSuccess: onDone,
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Class teachers, {year.name}</DialogTitle>
          <DialogDescription>
            The class teacher writes each student&apos;s report card remarks.
            Choose from those who teach the section.
          </DialogDescription>
        </DialogHeader>
        {!data ? (
          <Loading error={error} />
        ) : data.sections.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">No sections yet.</p>
        ) : (
          <div
            className="grid max-h-[55vh] gap-3 overflow-y-auto pr-1"
            data-testid="class-teachers"
          >
            {data.sections.map((sec) => (
              <Field key={sec.groupId} label={sec.name}>
                <SelectInput
                  value={chosen[sec.groupId] ?? sec.teacherId ?? ""}
                  onChange={(e) =>
                    setChosen({ ...chosen, [sec.groupId]: e.target.value })
                  }
                >
                  <option value="">
                    {sec.options.length
                      ? "No class teacher"
                      : "Nobody teaches it yet"}
                  </option>
                  {sec.options.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </SelectInput>
              </Field>
            ))}
          </div>
        )}
        {save.error && (
          <FormMessage message={{ text: save.error.message, kind: "err" }} />
        )}
        <DialogFooter>
          <Button
            onClick={() => save.mutate()}
            disabled={Object.keys(chosen).length === 0 || save.isPending}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function YearDialog({
  slug,
  year,
  onDone,
}: {
  slug: string
  year: Year | null
  onDone: (changed: boolean) => void
}) {
  const thisYear = new Date().getFullYear()
  const [form, setForm] = useState({
    name: year?.name ?? `${thisYear}-${thisYear + 1}`,
    startsOn: year?.startsOn ?? `${thisYear}-06-01`,
    endsOn: year?.endsOn ?? `${thisYear + 1}-05-31`,
    isCurrent: year?.isCurrent ?? false,
  })
  const save = useMutation({
    mutationFn: () =>
      year
        ? api(`/orgs/${slug}/academic-years/${year.id}`, {
            method: "PATCH",
            body: form,
          })
        : api(`/orgs/${slug}/academic-years`, { body: form }),
    onSuccess: () => onDone(true),
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {year ? `Edit ${year.name}` : "Add academic year"}
          </DialogTitle>
          <DialogDescription>
            Groups each student&apos;s class for the year.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Field label="Name">
            <TextInput
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="2026-2027"
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Starts">
              <TextInput
                type="date"
                value={form.startsOn}
                onChange={(e) => setForm({ ...form, startsOn: e.target.value })}
              />
            </Field>
            <Field label="Ends">
              <TextInput
                type="date"
                value={form.endsOn}
                onChange={(e) => setForm({ ...form, endsOn: e.target.value })}
              />
            </Field>
          </div>
          {!year?.isCurrent && (
            <label className="flex items-center gap-2 text-body-sm">
              <Checkbox
                checked={form.isCurrent}
                onCheckedChange={(on) => setForm({ ...form, isCurrent: on })}
              />
              Make this the current academic year
            </label>
          )}
          {save.error && (
            <FormMessage message={{ text: save.error.message, kind: "err" }} />
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onDone(false)}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate()}>
            {year ? "Save changes" : "Add year"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- students ---------- */

interface Row {
  id: string
  name: string
  admissionNo: string
  gender: string
  login: boolean
  group: { id: string; path: string } | null
  rollNo: number | null
  status: string | null
}

type List = ApiResult<typeof listStudents>

const GENDER: Record<string, string> = {
  female: "Female",
  male: "Male",
  other: "Other",
  "": "—",
}

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

type Profile = ApiResult<typeof getStudent>

/** Add or edit a student, in a sheet from the side. */
function StudentSheet({
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

/* ---------- people in classes without a record ---------- */

function Unrecorded({ slug }: { slug: string }) {
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

/* ---------- import ---------- */

type ImportReport = ApiResult<typeof importStudents>

const COLUMNS: Record<string, string> = {
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
function toRows(text: string) {
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

function ImportStudents({
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

/* ---------- promotion ---------- */

type Plan = ApiResult<typeof promotionPlan>

type Counts = {
  moved: number
  repeated: number
  graduated: number
  withdrawn: number
  skipped: number
}

/** Manage › Academic years › Promote: move a year's students on to the next. */
export function Promotion({ slug }: { slug: string }) {
  const client = useQueryClient()
  const years = useQuery({
    queryKey: ["org", slug, "academic-years"],
    queryFn: () =>
      api<ApiResult<typeof listYears>>(`/orgs/${slug}/academic-years`),
  })
  const list = years.data?.years ?? []
  const current = list.find((y) => y.isCurrent) ?? list[0]
  const [fromId, setFromId] = useState("")
  const [toId, setToId] = useState("")
  const from = fromId || current?.id || ""
  const later = list
    .filter((y) => y.id !== from)
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn))
  const to =
    toId ||
    later.find(
      (y) => y.startsOn > (list.find((x) => x.id === from)?.startsOn ?? "")
    )?.id ||
    later[0]?.id ||
    ""
  const plan = useQuery({
    queryKey: ["org", slug, "promotion", from, to],
    queryFn: () =>
      api<Plan>(`/orgs/${slug}/academic-years/promotion?from=${from}&to=${to}`),
    enabled: Boolean(from && to && from !== to),
  })
  const [sections, setSections] = useState<Record<string, string>>({})
  const [exceptions, setExceptions] = useState<Record<string, string>>({})
  const [makeCurrent, setMakeCurrent] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const body = (apply: boolean) => ({
    fromYearId: from,
    toYearId: to,
    sections: Object.fromEntries(
      (plan.data?.sections ?? []).map((s) => [
        s.groupId,
        sections[s.groupId] ?? s.suggested,
      ])
    ),
    exceptions,
    makeCurrent,
    apply,
  })
  const preview = useMutation({
    mutationFn: () =>
      api<ApiResult<typeof promote>>(`/orgs/${slug}/academic-years/promotion`, {
        body: body(false),
      }),
  })
  const apply = useMutation({
    mutationFn: () =>
      api<ApiResult<typeof promote>>(`/orgs/${slug}/academic-years/promotion`, {
        body: body(true),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ["org", slug] }),
  })
  if (!years.data) return <Loading error={years.error} />
  if (list.length < 2) {
    return (
      <>
        <PageTitle>Promote students</PageTitle>
        <p className="text-body-sm text-muted-foreground">
          Add next year under Academic years first.
        </p>
      </>
    )
  }
  const options = (keepSame: string) => (
    <>
      <option value="repeat">{keepSame}</option>
      <option value="graduate">Graduate</option>
      <option value="withdraw">Leaves the school</option>
      {(plan.data?.targets ?? []).map((t) => (
        <option key={t.id} value={t.id}>
          {t.path}
        </option>
      ))}
    </>
  )
  const describe = (c: Counts) =>
    `${c.moved} move up, ${c.repeated} stay in their class, ${c.graduated} graduate, ${c.withdrawn} leave${c.skipped ? `; ${c.skipped} already have a class in ${plan.data?.to.name}` : ""}.`
  return (
    <div className="grid gap-5" data-testid="promotion">
      <Link
        href={orgPages(slug).manage(`/academic-years`)}
        className="text-body-sm text-muted-foreground hover:text-ink"
      >
        ‹ Academic years
      </Link>
      <PageTitle>Promote students</PageTitle>
      <p className="-mt-3 max-w-2xl text-body-sm text-muted-foreground">
        Each class moves on together; change a class&apos;s destination, or one
        student&apos;s. Nobody moves until the new year is current, unless you
        make it current here. Running it again skips anyone already placed.
      </p>
      <div className="grid max-w-xl gap-3 sm:grid-cols-2">
        <Field label="From">
          <SelectInput
            value={from}
            onChange={(e) => (
              setFromId(e.target.value),
              setSections({}),
              setExceptions({}),
              preview.reset()
            )}
          >
            {list.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
                {y.isCurrent ? " (current)" : ""}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="To">
          <SelectInput
            value={to}
            onChange={(e) => (setToId(e.target.value), preview.reset())}
          >
            {list
              .filter((y) => y.id !== from)
              .map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                  {y.isCurrent ? " (current)" : ""}
                </option>
              ))}
          </SelectInput>
        </Field>
      </div>
      {!plan.data ? (
        <Loading error={plan.error} />
      ) : plan.data.sections.length === 0 ? (
        <Empty className="border border-dashed border-hairline">
          <EmptyHeader>
            <EmptyTitle>
              No one is in a class in {plan.data.from.name}
            </EmptyTitle>
            <EmptyDescription>
              Place students in classes for that year first.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="py-0">
          <Table data-testid="promotion-sections">
            <TableHeader>
              <TableRow>
                <TableHead>Class in {plan.data.from.name}</TableHead>
                <TableHead className="text-right">Students</TableHead>
                <TableHead>Goes to in {plan.data.to.name}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {plan.data.sections.map((s) => (
                <TableRow
                  key={s.groupId}
                  data-testid="promotion-row"
                  className="align-top"
                >
                  <TableCell className="font-medium">
                    {s.path}
                    <details className="mt-1 font-normal">
                      <summary className="cursor-pointer text-xs text-muted-foreground">
                        One student differently
                      </summary>
                      <ul className="mt-2 grid gap-1.5">
                        {s.students.map((st) => (
                          <li
                            key={st.id}
                            className="grid grid-cols-[minmax(0,1fr)_minmax(0,12rem)] items-center gap-2 text-body-sm"
                          >
                            <span className="truncate">
                              {st.name}
                              {st.already && (
                                <span className="text-xs text-muted-foreground">
                                  {" "}
                                  · already placed
                                </span>
                              )}
                            </span>
                            <SelectInput
                              aria-label={`${st.name} goes to`}
                              value={exceptions[st.id] ?? ""}
                              onChange={(e) => {
                                const next = { ...exceptions }
                                if (e.target.value) next[st.id] = e.target.value
                                else delete next[st.id]
                                setExceptions(next)
                                preview.reset()
                              }}
                            >
                              <option value="">With the class</option>
                              {options("Stays in this class")}
                            </SelectInput>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {s.students.length}
                  </TableCell>
                  <TableCell>
                    <SelectInput
                      aria-label={`${s.path} goes to`}
                      value={sections[s.groupId] ?? s.suggested}
                      onChange={(e) => (
                        setSections({
                          ...sections,
                          [s.groupId]: e.target.value,
                        }),
                        preview.reset()
                      )}
                    >
                      {options("Stays in the same class")}
                    </SelectInput>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {plan.data && plan.data.sections.length > 0 && (
        <div className="grid gap-3">
          {!plan.data.to.isCurrent && (
            <label className="flex items-center gap-2 text-body-sm">
              <Checkbox
                checked={makeCurrent}
                onCheckedChange={(on) => setMakeCurrent(on)}
              />
              Make {plan.data.to.name} the current year afterwards (everyone
              moves to their new class now)
            </label>
          )}
          {preview.data && (
            <Alert data-testid="promotion-preview">
              <AlertTitle>What will happen</AlertTitle>
              <AlertDescription>
                {describe(preview.data.counts)}
              </AlertDescription>
            </Alert>
          )}
          {apply.data && (
            <Alert data-testid="promotion-done">
              <AlertTitle>Done</AlertTitle>
              <AlertDescription>{describe(apply.data.counts)}</AlertDescription>
            </Alert>
          )}
          {(preview.error ?? apply.error) && (
            <FormMessage
              message={{
                text: (preview.error ?? apply.error)!.message,
                kind: "err",
              }}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={preview.isPending}
              onClick={() => preview.mutate()}
            >
              Preview
            </Button>
            <Button
              disabled={!preview.data || apply.isPending || Boolean(apply.data)}
              onClick={() => setConfirming(true)}
            >
              Promote
            </Button>
          </div>
        </div>
      )}
      {confirming && preview.data && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirming(false)}
          title={`Promote ${plan.data?.from.name} to ${plan.data?.to.name}?`}
          description={describe(preview.data.counts)}
          confirmLabel="Promote"
          tone="default"
          onConfirm={() => apply.mutate()}
        />
      )}
    </div>
  )
}

/* ---------- transfer certificates ---------- */

function TransferCertificates({
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
