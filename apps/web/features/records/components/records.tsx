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
import { Button } from "@workspace/ui/components/button"
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
import { api } from "@/lib/api/client"

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
      api<{ can: { years: boolean }; years: Year[] }>(
        `/orgs/${slug}/academic-years`
      ),
  })
  const [editing, setEditing] = useState<Year | "new" | null>(null)
  const [current, setCurrent] = useState<Year | null>(null)
  const [removing, setRemoving] = useState<Year | null>(null)
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
            <Button onClick={() => setEditing("new")}>
              <PlusIcon /> Add academic year
            </Button>
          )
        }
      >
        Academic years
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

interface List {
  can: { view: boolean; edit: boolean; years: boolean }
  year: { id: string; name: string } | null
  total: number
  page: number
  pages: number
  students: Row[]
  groups: { id: string; name: string; parentId: string | null }[]
  levels: string[]
  choosable: string[]
}

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
          data.can.edit && (
            <Button onClick={() => setAdding(true)}>
              <PlusIcon /> Add student
            </Button>
          )
        }
      >
        Students
      </PageTitle>
      {!data.year && (
        <Alert className="mb-4">
          <AlertTitle>No current academic year</AlertTitle>
          <AlertDescription>
            Students can be added, but placed in a class only once there&apos;s
            a current year.{" "}
            {data.can.years && (
              <Link
                href={`/orgs/${slug}/manage/academic-years`}
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
                      href={`/orgs/${slug}/manage/students/${s.id}`}
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

interface Profile {
  id: string
  name: string
  email: string | null
  admissionNo: string
  gender: string
  birthDate: string
  phone: string
  address: string
  admittedOn: string
  current: {
    year: string
    group: { id: string; path: string } | null
    rollNo: number | null
    status: string | null
  } | null
  history: {
    year: string
    group: string | null
    rollNo: number | null
    status: string
  }[]
  parents: { name: string; email: string; relation: string }[]
  attendance: { marked: number; percent: number } | null
  campus: CampusData
  can: { edit: boolean }
}

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
      api<{ admissionNo: string }>(`/orgs/${slug}/students/next-number`),
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
        href={`/orgs/${slug}/manage/students`}
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
