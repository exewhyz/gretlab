"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"

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
  Check,
  Field,
  FormMessage,
  SelectInput,
  TextArea,
  TextInput,
} from "@/components/form"
import { Loading, PageTitle } from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"

type Status =
  | "submitted"
  | "reviewing"
  | "waitlisted"
  | "rejected"
  | "admitted"
  | "withdrawn"

const STATUS: Record<Status, { label: string; variant: "default" | "outline" | "secondary" | "destructive" }> = {
  submitted: { label: "New", variant: "outline" },
  reviewing: { label: "Reviewing", variant: "secondary" },
  waitlisted: { label: "Waitlisted", variant: "secondary" },
  rejected: { label: "Not admitted", variant: "destructive" },
  admitted: { label: "Admitted", variant: "default" },
  withdrawn: { label: "Withdrawn", variant: "outline" },
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })

/* ---------- applying ---------- */

interface Form {
  org: { name: string; slug: string; type: string }
  open: boolean
  year: { id: string; name: string } | null
  grades: { id: string; name: string }[]
  instructions: string
  applicant: { name: string; email: string }
  mine: {
    id: string
    number: string
    studentName: string
    grade: string | null
    status: Status
    message: string
    createdAt: string
    canWithdraw: boolean
  }[]
}

/** /orgs/[slug]/apply: the admission form and your applications. */
export function ApplyPage({ slug }: { slug: string }) {
  const client = useQueryClient()
  const key = ["org", slug, "admission-form"]
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<Form>(`/orgs/${slug}/admissions/form`),
  })
  const [form, setForm] = useState({
    gradeId: "",
    studentName: "",
    birthDate: "",
    gender: "",
    previousSchool: "",
    parentName: "",
    relation: "mother",
    phone: "",
    address: "",
    notes: "",
  })
  const [withdrawing, setWithdrawing] = useState<string | null>(null)
  useEffect(() => {
    if (data && !form.parentName && data.applicant.name)
      setForm((f) => ({ ...f, parentName: data.applicant.name }))
  }, [data, form.parentName])
  const send = useMutation({
    mutationFn: () => api(`/orgs/${slug}/admissions`, { body: form }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: key })
      setForm((f) => ({ ...f, studentName: "", birthDate: "", gender: "", previousSchool: "", notes: "" }))
    },
  })
  const withdraw = useMutation({
    mutationFn: (id: string) => api(`/orgs/${slug}/admissions/${id}/withdraw`, { body: {} }),
    onSuccess: () => void client.invalidateQueries({ queryKey: key }),
  })
  if (!data) return <Loading error={error} />
  const set = (patch: Partial<typeof form>) => {
    setForm({ ...form, ...patch })
    send.reset()
  }
  const self = form.relation === "self"
  return (
    <div className="grid gap-6">
      <div>
        <div className="text-body-sm text-muted-foreground">{data.org.name}</div>
        <h1 className="text-display-sm text-ink">Apply for admission</h1>
        {data.year && (
          <p className="text-body-sm text-muted-foreground">For the academic year {data.year.name}.</p>
        )}
      </div>
      {data.mine.length > 0 && (
        <section className="grid gap-2" data-testid="my-applications">
          <h2 className="text-title-sm text-ink">Your applications</h2>
          {data.mine.map((a) => (
            <Card key={a.id} size="sm" data-testid="my-application">
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center gap-2">
                  {a.studentName}
                  <Badge variant={STATUS[a.status].variant}>{STATUS[a.status].label}</Badge>
                </CardTitle>
                <CardDescription>
                  {a.number}
                  {a.grade && ` · ${a.grade}`} · sent {shortDate(a.createdAt)}
                  {a.message && <span className="mt-1 block text-ink">“{a.message}”</span>}
                </CardDescription>
                {a.canWithdraw && (
                  <CardAction>
                    <Button size="sm" variant="ghost" onClick={() => setWithdrawing(a.id)}>
                      Withdraw
                    </Button>
                  </CardAction>
                )}
              </CardHeader>
            </Card>
          ))}
        </section>
      )}
      {!data.open ? (
        <Empty className="border border-dashed border-hairline">
          <EmptyHeader>
            <EmptyTitle>{data.org.name} isn&apos;t taking applications now</EmptyTitle>
            <EmptyDescription>Check back later, or contact the school.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>New application</CardTitle>
            {data.instructions && (
              <CardDescription className="whitespace-pre-line" data-testid="admission-instructions">
                {data.instructions}
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={(e) => (e.preventDefault(), send.mutate())}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Applying for">
                  <SelectInput value={form.gradeId} onChange={(e) => set({ gradeId: e.target.value })}>
                    <option value="">Choose a class</option>
                    {data.grades.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </SelectInput>
                </Field>
                <Field label="You are the student's">
                  <SelectInput value={form.relation} onChange={(e) => set({ relation: e.target.value })}>
                    <option value="mother">Mother</option>
                    <option value="father">Father</option>
                    <option value="guardian">Guardian</option>
                    <option value="self">I am the student</option>
                  </SelectInput>
                </Field>
              </div>
              <fieldset className="grid gap-3">
                <legend className="mb-1 text-caption font-semibold text-muted-foreground">The student</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Student's full name">
                    <TextInput value={form.studentName} onChange={(e) => set({ studentName: e.target.value })} />
                  </Field>
                  <Field label="Date of birth">
                    <TextInput type="date" value={form.birthDate} onChange={(e) => set({ birthDate: e.target.value })} />
                  </Field>
                  <Field label="Gender">
                    <SelectInput value={form.gender} onChange={(e) => set({ gender: e.target.value })}>
                      <option value="">Prefer not to say</option>
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                      <option value="other">Other</option>
                    </SelectInput>
                  </Field>
                  <Field label="Previous school (if any)">
                    <TextInput value={form.previousSchool} onChange={(e) => set({ previousSchool: e.target.value })} />
                  </Field>
                </div>
              </fieldset>
              <fieldset className="grid gap-3">
                <legend className="mb-1 text-caption font-semibold text-muted-foreground">
                  {self ? "You" : "Parent or guardian"}
                </legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={self ? "Your name" : "Parent's name"}>
                    <TextInput value={form.parentName} onChange={(e) => set({ parentName: e.target.value })} />
                  </Field>
                  <Field label="Phone">
                    <TextInput type="tel" value={form.phone} onChange={(e) => set({ phone: e.target.value })} />
                  </Field>
                </div>
                <Field label="Address">
                  <TextArea value={form.address} maxLength={300} onChange={(e) => set({ address: e.target.value })} />
                </Field>
                <Field label="Anything else the school should know">
                  <TextArea value={form.notes} maxLength={1000} onChange={(e) => set({ notes: e.target.value })} />
                </Field>
              </fieldset>
              <p className="text-caption text-muted-foreground">
                We&apos;ll reply to {data.applicant.email}. Birth date, phone and address are stored
                encrypted and seen only by the admissions office.
              </p>
              {send.error && <FormMessage message={{ text: send.error.message, kind: "err" }} />}
              {send.isSuccess && (
                <FormMessage message={{ text: "Application sent. You'll hear from the school here and by email.", kind: "ok" }} />
              )}
              <div>
                <Button type="submit" disabled={send.isPending}>
                  Send application
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
      {withdrawing && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setWithdrawing(null)}
          title="Withdraw this application?"
          description="The school stops considering it. You can apply again later."
          confirmLabel="Withdraw"
          onConfirm={() => withdraw.mutate(withdrawing)}
        />
      )}
    </div>
  )
}

/* ---------- the office ---------- */

interface List {
  total: number
  page: number
  counts: Partial<Record<Status, number>>
  settings: { open: boolean; yearId: string | null; gradeIds: string[]; instructions: string; yearName: string | null }
  grades: { id: string; name: string }[]
  applications: {
    id: string
    number: string
    studentName: string
    grade: string | null
    parentName: string
    email: string
    status: Status
    createdAt: string
  }[]
}

const FILTERS: { value: "" | Status; label: string }[] = [
  { value: "", label: "All" },
  { value: "submitted", label: "New" },
  { value: "reviewing", label: "Reviewing" },
  { value: "waitlisted", label: "Waitlisted" },
  { value: "admitted", label: "Admitted" },
  { value: "rejected", label: "Not admitted" },
  { value: "withdrawn", label: "Withdrawn" },
]

/** Manage › Admissions: open or close them, and the applications. */
export function Admissions({ slug }: { slug: string }) {
  const [status, setStatus] = useState<"" | Status>("")
  const [gradeId, setGradeId] = useState("")
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const params = new URLSearchParams({ status, gradeId, q, page: String(page) }).toString()
  const { data, error } = useQuery({
    queryKey: ["org", slug, "admissions", params],
    queryFn: () => api<List>(`/orgs/${slug}/admissions?${params}`),
  })
  if (!data) return <Loading error={error} />
  const link = typeof window === "undefined" ? `/orgs/${slug}/apply` : `${window.location.origin}/orgs/${slug}/apply`
  const all = Object.values(data.counts).reduce((s, n) => s + (n ?? 0), 0)
  return (
    <>
      <PageTitle
        action={
          <Button variant="outline" onClick={() => setSettingsOpen(true)}>
            Admission settings
          </Button>
        }
      >
        Admissions
      </PageTitle>
      <Card size="sm" className="mb-4" data-testid="admissions-state">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2">
            {data.settings.open ? <Badge>Open</Badge> : <Badge variant="outline">Closed</Badge>}
            {data.settings.open
              ? `Taking applications for ${data.settings.yearName ?? "the year"}`
              : "Not taking applications"}
          </CardTitle>
          <CardDescription className="break-all">
            {data.settings.open ? (
              <>
                Parents apply at <span className="text-ink">{link}</span>; it&apos;s on your public page
                too.
              </>
            ) : (
              "Open admissions in the settings to show an Apply button on your public page."
            )}
          </CardDescription>
          {data.settings.open && (
            <CardAction>
              <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(link)}>
                Copy link
              </Button>
            </CardAction>
          )}
        </CardHeader>
      </Card>
      <div className="mb-3 flex flex-wrap items-end gap-3">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Status">
          {FILTERS.map((f) => {
            const n = f.value ? (data.counts[f.value] ?? 0) : all
            return (
              <Button
                key={f.value}
                size="sm"
                variant={status === f.value ? "default" : "outline"}
                aria-pressed={status === f.value}
                onClick={() => (setStatus(f.value), setPage(1))}
              >
                {f.label}
                <span className="tabular-nums opacity-70">{n}</span>
              </Button>
            )
          })}
        </div>
        <div className="w-40">
          <Field label="Class">
            <SelectInput value={gradeId} onChange={(e) => (setGradeId(e.target.value), setPage(1))}>
              <option value="">All</option>
              {data.grades.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <div className="w-56">
          <Field label="Search">
            <TextInput value={q} placeholder="Name or number" onChange={(e) => (setQ(e.target.value), setPage(1))} />
          </Field>
        </div>
      </div>
      {data.applications.length === 0 ? (
        <Empty className="border border-dashed border-hairline">
          <EmptyHeader>
            <EmptyTitle>No applications{status ? ` that are ${STATUS[status].label.toLowerCase()}` : ""}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <Card className="overflow-x-auto py-0">
          <Table data-testid="applications">
            <TableHeader>
              <TableRow>
                <TableHead>Student</TableHead>
                <TableHead>Class</TableHead>
                <TableHead className="hidden md:table-cell">Parent</TableHead>
                <TableHead className="hidden sm:table-cell">Sent</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.applications.map((a) => (
                <TableRow key={a.id} data-testid="application-row">
                  <TableCell>
                    <Link href={`/orgs/${slug}/manage/admissions/${a.id}`} className="font-medium hover:underline">
                      {a.studentName}
                    </Link>
                    <div className="text-caption text-muted-foreground">{a.number}</div>
                  </TableCell>
                  <TableCell>{a.grade ?? "–"}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {a.parentName}
                    <div className="text-caption text-muted-foreground">{a.email}</div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{shortDate(a.createdAt)}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS[a.status].variant}>{STATUS[a.status].label}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {data.total > 50 && (
        <div className="mt-3 flex items-center justify-end gap-2 text-body-sm">
          <Button size="sm" variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span>
            Page {page} of {Math.ceil(data.total / 50)}
          </span>
          <Button size="sm" variant="outline" disabled={page * 50 >= data.total} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
      {settingsOpen && <SettingsDialog slug={slug} onDone={() => setSettingsOpen(false)} />}
    </>
  )
}

function SettingsDialog({ slug, onDone }: { slug: string; onDone: () => void }) {
  const client = useQueryClient()
  const { data, error } = useQuery({
    queryKey: ["org", slug, "admission-settings"],
    queryFn: () =>
      api<{
        settings: { open: boolean; yearId: string | null; gradeIds: string[]; instructions: string }
        years: { id: string; name: string; isCurrent: boolean }[]
        grades: { id: string; name: string }[]
      }>(`/orgs/${slug}/admissions/settings`),
  })
  const [form, setForm] = useState<{ open: boolean; yearId: string | null; gradeIds: string[]; instructions: string } | null>(null)
  useEffect(() => {
    if (data && !form) setForm(data.settings)
  }, [data, form])
  const save = useMutation({
    mutationFn: () => api(`/orgs/${slug}/admissions/settings`, { method: "PUT", body: form }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["org", slug] })
      onDone()
    },
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Admission settings</DialogTitle>
          <DialogDescription>Who can apply, for when, and what they should know.</DialogDescription>
        </DialogHeader>
        {!data || !form ? (
          <Loading error={error} />
        ) : (
          <div className="grid gap-3">
            <Check label="Taking applications" checked={form.open} onCheckedChange={(v) => setForm({ ...form, open: v })} />
            <Field label="For the academic year">
              <SelectInput value={form.yearId ?? ""} onChange={(e) => setForm({ ...form, yearId: e.target.value || null })}>
                <option value="">Choose a year</option>
                {data.years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                    {y.isCurrent ? " (current)" : ""}
                  </option>
                ))}
              </SelectInput>
            </Field>
            {data.years.length === 0 && (
              <p className="text-caption text-destructive">
                Add an academic year first, in{" "}
                <Link className="underline" href={`/orgs/${slug}/manage/academic-years`}>
                  Academic years
                </Link>
                .
              </p>
            )}
            <div className="grid gap-1">
              <span className="text-caption font-semibold text-ink">Classes taking applications</span>
              <span className="text-caption text-muted-foreground">None ticked: all of them.</span>
              <div className="grid max-h-40 grid-cols-2 gap-1 overflow-y-auto rounded-lg border border-hairline p-2">
                {data.grades.map((g) => (
                  <Check
                    key={g.id}
                    label={g.name}
                    checked={form.gradeIds.includes(g.id)}
                    onCheckedChange={(v) =>
                      setForm({
                        ...form,
                        gradeIds: v ? [...form.gradeIds, g.id] : form.gradeIds.filter((x) => x !== g.id),
                      })
                    }
                  />
                ))}
              </div>
            </div>
            <Field label="Instructions for parents">
              <TextArea
                maxLength={2000}
                value={form.instructions}
                placeholder="Documents to bring, test dates, fees…"
                onChange={(e) => setForm({ ...form, instructions: e.target.value })}
              />
            </Field>
          </div>
        )}
        {save.error && <FormMessage message={{ text: save.error.message, kind: "err" }} />}
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={!form || save.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface Application {
  id: string
  number: string
  status: Status
  message: string
  year: { id: string; name: string; isCurrent: boolean } | null
  grade: { id: string; name: string } | null
  studentName: string
  birthDate: string | null
  gender: string
  previousSchool: string
  parentName: string
  relation: string
  phone: string | null
  address: string | null
  notes: string
  applicant: { name: string | null; email: string }
  decidedBy: string | null
  decidedAt: string | null
  student: { id: string } | null
  createdAt: string
  admit: {
    sections: { id: string; name: string }[]
    admissionNo: string
    linksParent: boolean
  } | null
}

/** One application: its details, and moving it on or admitting. */
export function ApplicationPage({ slug, id }: { slug: string; id: string }) {
  const client = useQueryClient()
  const router = useRouter()
  const key = ["org", slug, "admission", id]
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<Application>(`/orgs/${slug}/admissions/${id}`),
  })
  const [moving, setMoving] = useState<"reviewing" | "waitlisted" | "rejected" | null>(null)
  const [admitting, setAdmitting] = useState(false)
  if (!data) return <Loading error={error} />
  const open = data.admit !== null
  const rows: [string, string | null][] = [
    ["Applying for", data.grade ? `${data.grade.name}, ${data.year?.name ?? ""}` : null],
    ["Date of birth", data.birthDate],
    ["Gender", data.gender || null],
    ["Previous school", data.previousSchool || null],
    [data.relation === "self" ? "Applicant" : `Parent (${data.relation || "guardian"})`, data.parentName],
    ["Signed in as", data.applicant.email],
    ["Phone", data.phone],
    ["Address", data.address],
    ["Notes", data.notes || null],
  ]
  return (
    <>
      <div className="mb-1 text-body-sm text-muted-foreground">
        <Link href={`/orgs/${slug}/manage/admissions`} className="hover:underline">
          Admissions
        </Link>{" "}
        · {data.number}
      </div>
      <PageTitle
        action={
          open && (
            <div className="flex flex-wrap gap-2">
              {data.status === "submitted" && (
                <Button variant="outline" onClick={() => setMoving("reviewing")}>
                  Start review
                </Button>
              )}
              {data.status !== "waitlisted" && (
                <Button variant="outline" onClick={() => setMoving("waitlisted")}>
                  Waitlist
                </Button>
              )}
              <Button variant="outline" onClick={() => setMoving("rejected")}>
                Don&apos;t admit
              </Button>
              <Button onClick={() => setAdmitting(true)}>Admit</Button>
            </div>
          )
        }
      >
        <span className="mr-2">{data.studentName}</span>
        <Badge variant={STATUS[data.status].variant} data-testid="application-status">
          {STATUS[data.status].label}
        </Badge>
      </PageTitle>
      {data.decidedBy && (
        <p className="mb-3 text-body-sm text-muted-foreground">
          {STATUS[data.status].label} by {data.decidedBy}
          {data.decidedAt && ` on ${shortDate(data.decidedAt)}`}
          {data.message && `: “${data.message}”`}
        </p>
      )}
      {data.student && (
        <p className="mb-3 text-body-sm">
          <Link className="font-medium text-primary hover:underline" href={`/orgs/${slug}/manage/students/${data.student.id}`}>
            Open the student&apos;s record ›
          </Link>
        </p>
      )}
      <Card className="max-w-3xl">
        <CardContent>
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2" data-testid="application-details">
            {rows
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className={k === "Address" || k === "Notes" ? "sm:col-span-2" : ""}>
                  <dt className="text-caption text-muted-foreground">{k}</dt>
                  <dd className="whitespace-pre-line text-body-sm text-ink">{v}</dd>
                </div>
              ))}
          </dl>
        </CardContent>
      </Card>
      {moving && (
        <MoveDialog
          slug={slug}
          id={id}
          to={moving}
          name={data.studentName}
          onDone={(changed) => (setMoving(null), changed && void client.invalidateQueries({ queryKey: ["org", slug] }))}
        />
      )}
      {admitting && data.admit && (
        <AdmitDialog
          slug={slug}
          app={data}
          onDone={(studentId) => {
            setAdmitting(false)
            if (studentId) {
              void client.invalidateQueries({ queryKey: ["org", slug] })
              router.refresh()
            }
          }}
        />
      )}
    </>
  )
}

function MoveDialog({
  slug,
  id,
  to,
  name,
  onDone,
}: {
  slug: string
  id: string
  to: "reviewing" | "waitlisted" | "rejected"
  name: string
  onDone: (changed: boolean) => void
}) {
  const [message, setMessage] = useState("")
  const save = useMutation({
    mutationFn: () => api(`/orgs/${slug}/admissions/${id}/status`, { body: { status: to, message } }),
    onSuccess: () => onDone(true),
  })
  const title = { reviewing: "Start reviewing", waitlisted: "Put on the waiting list", rejected: "Don't admit" }[to]
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {title}: {name}
          </DialogTitle>
          <DialogDescription>The applicant is told, with your message.</DialogDescription>
        </DialogHeader>
        <Field label="Message to the applicant (optional)">
          <TextArea
            maxLength={500}
            value={message}
            placeholder={to === "reviewing" ? "Please bring the birth certificate for an interview on…" : ""}
            onChange={(e) => setMessage(e.target.value)}
          />
        </Field>
        {save.error && <FormMessage message={{ text: save.error.message, kind: "err" }} />}
        <DialogFooter>
          <Button variant={to === "rejected" ? "destructive" : "default"} onClick={() => save.mutate()} disabled={save.isPending}>
            {title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AdmitDialog({
  slug,
  app,
  onDone,
}: {
  slug: string
  app: Application
  onDone: (studentId: string | null) => void
}) {
  const admit = app.admit!
  const [form, setForm] = useState({
    groupId: admit.sections.length === 1 ? admit.sections[0]!.id : "",
    rollNo: "",
    admissionNo: admit.admissionNo,
    email: "",
    message: "",
  })
  const save = useMutation({
    mutationFn: () =>
      api<{ studentId: string; admissionNo: string }>(`/orgs/${slug}/admissions/${app.id}/admit`, {
        body: { ...form, rollNo: form.rollNo ? Number(form.rollNo) : null },
      }),
    onSuccess: (r) => onDone(r.studentId),
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(null)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Admit {app.studentName}</DialogTitle>
          <DialogDescription>
            Creates their student record and enrols them in {app.year?.name}
            {app.year && !app.year.isCurrent && " (they join their class when that year becomes current)"}
            {admit.linksParent && `, and links ${app.parentName}'s account as their parent`}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Section">
              <SelectInput value={form.groupId} onChange={(e) => setForm({ ...form, groupId: e.target.value })}>
                <option value="">Choose</option>
                {admit.sections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Roll number (optional)">
              <TextInput type="number" min={1} value={form.rollNo} onChange={(e) => setForm({ ...form, rollNo: e.target.value })} />
            </Field>
          </div>
          <Field label="Admission number">
            <TextInput value={form.admissionNo} onChange={(e) => setForm({ ...form, admissionNo: e.target.value })} />
          </Field>
          {app.relation !== "self" && (
            <Field label="Student's own email (optional)" help="For older students who sign in themselves. Leave blank for young children.">
              <TextInput type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </Field>
          )}
          <Field label="Message to the applicant (optional)">
            <TextArea maxLength={500} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
          </Field>
        </div>
        {admit.sections.length === 0 && (
          <p className="text-caption text-destructive">That class has no sections. Add one in Classes first.</p>
        )}
        {save.error && <FormMessage message={{ text: save.error.message, kind: "err" }} />}
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={!form.groupId || save.isPending}>
            Admit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The Apply button on a school's public page. */
export function ApplyButton({ slug }: { slug: string }) {
  return (
    <Link href={`/orgs/${slug}/apply`} className={buttonVariants()} data-testid="apply-button">
      Apply for admission
    </Link>
  )
}
