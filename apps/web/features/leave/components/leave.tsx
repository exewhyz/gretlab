"use client"

import { PlusIcon } from "@phosphor-icons/react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState, type ReactNode } from "react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Card,
  CardAction,
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"
import { cn } from "@workspace/ui/lib/utils"

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

interface Request {
  id: string
  kind: "student" | "staff"
  userId: string
  name: string
  class: string | null
  type: string
  typeName: string
  startsOn: string
  endsOn: string
  halfDay: boolean
  days: number
  reason: string
  status: "pending" | "approved" | "rejected" | "cancelled"
  requestedBy: string | null
  decidedBy: string | null
  note: string
}

interface LeaveType {
  key: string
  name: string
  days: number | null
}

interface Home {
  today: string
  schoolDays: number[]
  students: { id: string; name: string; self: boolean }[]
  staff: boolean
  studentTypes: { key: string; name: string }[]
  staffTypes: LeaveType[]
  balances: {
    year: string
    types: (LeaveType & { used: number; left: number | null })[]
  } | null
  mine: Request[]
  waiting: Request[]
  canDecideStaff: boolean
  canDecide: boolean
  canSeeAll?: boolean
}

const STATUS: Record<Request["status"], { label: string; variant: "default" | "outline" | "secondary" | "destructive" }> = {
  pending: { label: "Waiting", variant: "outline" },
  approved: { label: "Approved", variant: "default" },
  rejected: { label: "Refused", variant: "destructive" },
  cancelled: { label: "Taken back", variant: "secondary" },
}

const when = (r: { startsOn: string; endsOn: string; halfDay: boolean }) => {
  const f = (d: string) =>
    new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, {
      weekday: "short",
      day: "numeric",
      month: "short",
    })
  return r.startsOn === r.endsOn
    ? `${f(r.startsOn)}${r.halfDay ? " (half day)" : ""}`
    : `${f(r.startsOn)} – ${f(r.endsOn)}`
}

const plural = (n: number) => `${n} ${n === 1 ? "day" : "days"}`

/** School days between two days, as the server counts them. */
function countDays(from: string, to: string, half: boolean, days: number[]) {
  if (!from || !to || to < from) return 0
  let n = 0
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) {
    if (days.includes(((new Date(t).getUTCDay() + 6) % 7) + 1)) n++
  }
  return half ? Math.min(n, 1) / 2 : n
}

export function LeavePage({ slug }: { slug: string }) {
  const client = useQueryClient()
  const key = ["org", slug, "leave"]
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<Home>(`/orgs/${slug}/leave`),
  })
  const [asking, setAsking] = useState(false)
  const [types, setTypes] = useState(false)
  const [deciding, setDeciding] = useState<{ r: Request; status: "approved" | "rejected" } | null>(null)
  const refresh = () => client.invalidateQueries({ queryKey: ["org", slug] })
  const cancel = useMutation({
    mutationFn: (id: string) => api(`/orgs/${slug}/leave/${id}/cancel`, { body: {} }),
    onSuccess: () => void refresh(),
  })
  if (!data) return <Loading error={error} />
  const canAsk = data.staff || data.students.length > 0
  return (
    <>
      <PageTitle
        action={
          <div className="flex flex-wrap gap-2">
            {data.canDecideStaff && (
              <Button variant="outline" onClick={() => setTypes(true)}>
                Kinds of leave
              </Button>
            )}
            {canAsk && (
              <Button onClick={() => setAsking(true)}>
                <PlusIcon /> Ask for leave
              </Button>
            )}
          </div>
        }
      >
        Leave
      </PageTitle>
      {data.balances && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="leave-balances">
          {data.balances.types.map((t) => (
            <div key={t.key} className="rounded-lg border border-hairline bg-card p-3">
              <div className="text-caption text-muted-foreground">{t.name}</div>
              <div className="text-title-md tabular-nums text-ink">
                {t.left == null ? `${t.used} used` : `${t.left} left`}
              </div>
              {t.days != null && (
                <div className="text-caption text-muted-foreground">
                  {t.used} of {t.days} used in {data.balances!.year}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {cancel.error && <FormMessage message={{ text: cancel.error.message, kind: "err" }} />}
      <Tabs defaultValue={data.waiting.length ? "waiting" : "mine"}>
        <TabsList>
          {data.canDecide && (
            <TabsTrigger value="waiting">
              To decide
              {data.waiting.length > 0 && (
                <Badge className="ml-1.5" data-testid="waiting-count">
                  {data.waiting.length}
                </Badge>
              )}
            </TabsTrigger>
          )}
          <TabsTrigger value="mine">Mine</TabsTrigger>
          {data.canDecide && <TabsTrigger value="decided">Decided</TabsTrigger>}
          {!data.canDecide && data.canSeeAll && <TabsTrigger value="all">All requests</TabsTrigger>}
        </TabsList>
        {data.canDecide && (
          <TabsContent value="waiting" className="mt-3">
            <RequestList
              rows={data.waiting}
              empty="Nothing waits for you."
              testId="waiting"
              actions={(r) => (
                <>
                  <Button size="sm" variant="outline" onClick={() => setDeciding({ r, status: "rejected" })}>
                    Refuse
                  </Button>
                  <Button size="sm" onClick={() => setDeciding({ r, status: "approved" })}>
                    Approve
                  </Button>
                </>
              )}
            />
          </TabsContent>
        )}
        <TabsContent value="mine" className="mt-3">
          <RequestList
            rows={data.mine}
            empty={canAsk ? "You haven't asked for leave yet." : "Nothing here."}
            testId="mine"
            actions={(r) =>
              r.status === "pending" || (r.status === "approved" && r.startsOn > data.today) ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(r.id)}
                >
                  Take back
                </Button>
              ) : null
            }
          />
        </TabsContent>
        {data.canDecide && (
          <TabsContent value="decided" className="mt-3">
            <Decided slug={slug} />
          </TabsContent>
        )}
        {!data.canDecide && data.canSeeAll && (
          <TabsContent value="all" className="mt-3">
            <Decided slug={slug} />
          </TabsContent>
        )}
      </Tabs>
      {asking && (
        <AskDialog slug={slug} home={data} onDone={(changed) => (setAsking(false), changed && void refresh())} />
      )}
      {deciding && (
        <DecideDialog
          slug={slug}
          request={deciding.r}
          status={deciding.status}
          onDone={(changed) => (setDeciding(null), changed && void refresh())}
        />
      )}
      {types && <TypesDialog slug={slug} onDone={(changed) => (setTypes(false), changed && void refresh())} />}
    </>
  )
}

function RequestList({
  rows,
  empty,
  actions,
  testId,
}: {
  rows: Request[]
  empty: string
  actions?: (r: Request) => ReactNode
  testId: string
}) {
  if (rows.length === 0)
    return (
      <Empty className="border border-dashed border-hairline">
        <EmptyHeader>
          <EmptyTitle>{empty}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  return (
    <div className="grid gap-2" data-testid={testId}>
      {rows.map((r) => (
        <Card key={r.id} size="sm" data-testid="leave-row">
          <CardHeader>
            <CardTitle className="flex flex-wrap items-center gap-2">
              {r.name}
              <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
            </CardTitle>
            <CardDescription className="grid gap-0.5">
              <span>
                {when(r)} · {plural(r.days)} · {r.typeName}
                {r.class && ` · ${r.class}`}
                {r.kind === "staff" && " · staff"}
              </span>
              {r.reason && <span className="text-ink">{r.reason}</span>}
              {r.requestedBy && <span>Asked by {r.requestedBy}</span>}
              {r.decidedBy && (
                <span>
                  {r.status === "approved" ? "Approved" : r.status === "rejected" ? "Refused" : "Decided"} by{" "}
                  {r.decidedBy}
                  {r.note && `: ${r.note}`}
                </span>
              )}
            </CardDescription>
            {actions && (
              <CardAction className="flex flex-wrap justify-end gap-2">{actions(r)}</CardAction>
            )}
          </CardHeader>
        </Card>
      ))}
    </div>
  )
}

function Decided({ slug }: { slug: string }) {
  const [status, setStatus] = useState("approved")
  const [kind, setKind] = useState("")
  const { data, error } = useQuery({
    queryKey: ["org", slug, "leave", "requests", status, kind],
    queryFn: () =>
      api<{ total: number; requests: Request[] }>(
        `/orgs/${slug}/leave/requests?${new URLSearchParams({ status, kind })}`
      ),
  })
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-3">
        <div className="w-40">
          <Field label="Status">
            <SelectInput value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="approved">Approved</option>
              <option value="rejected">Refused</option>
              <option value="cancelled">Taken back</option>
              <option value="pending">Waiting</option>
            </SelectInput>
          </Field>
        </div>
        <div className="w-40">
          <Field label="Who">
            <SelectInput value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="">Everyone</option>
              <option value="student">Students</option>
              <option value="staff">Staff</option>
            </SelectInput>
          </Field>
        </div>
      </div>
      {!data ? (
        <Loading error={error} />
      ) : (
        <RequestList rows={data.requests} empty="None." testId="decided" />
      )}
    </div>
  )
}

function AskDialog({
  slug,
  home,
  onDone,
}: {
  slug: string
  home: Home
  onDone: (changed: boolean) => void
}) {
  const options = [
    ...(home.staff ? [{ id: "", name: "Myself (staff leave)" }] : []),
    ...home.students.map((s) => ({ id: s.id, name: s.self ? "Myself" : s.name })),
  ]
  const [form, setForm] = useState({
    studentId: options[0]?.id ?? "",
    type: "",
    startsOn: home.today,
    endsOn: home.today,
    halfDay: false,
    reason: "",
  })
  const staffLeave = form.studentId === ""
  const types = staffLeave ? home.staffTypes : home.studentTypes
  const type = form.type || types[0]?.key || ""
  const days = useMemo(
    () => countDays(form.startsOn, form.endsOn, form.halfDay && form.startsOn === form.endsOn, home.schoolDays),
    [form, home.schoolDays]
  )
  const balance = staffLeave ? home.balances?.types.find((t) => t.key === type) : null
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/leave`, {
        body: {
          ...(form.studentId ? { studentId: form.studentId } : {}),
          type,
          startsOn: form.startsOn,
          endsOn: form.endsOn,
          halfDay: form.halfDay && form.startsOn === form.endsOn,
          reason: form.reason,
        },
      }),
    onSuccess: () => onDone(true),
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(false)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Ask for leave</DialogTitle>
          <DialogDescription>
            {staffLeave
              ? "It goes to those who approve staff leave."
              : "It goes to the class teacher."}
          </DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" onSubmit={(e) => (e.preventDefault(), save.mutate())}>
          {options.length > 1 && (
            <Field label="For">
              <SelectInput
                value={form.studentId}
                onChange={(e) => setForm({ ...form, studentId: e.target.value, type: "" })}
              >
                {options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </SelectInput>
            </Field>
          )}
          <Field label={staffLeave ? "Kind of leave" : "Reason"}>
            <SelectInput value={type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {types.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First day">
              <TextInput
                type="date"
                value={form.startsOn}
                onChange={(e) =>
                  setForm({
                    ...form,
                    startsOn: e.target.value,
                    endsOn: form.endsOn < e.target.value ? e.target.value : form.endsOn,
                  })
                }
              />
            </Field>
            <Field label="Last day">
              <TextInput
                type="date"
                min={form.startsOn}
                value={form.endsOn}
                onChange={(e) => setForm({ ...form, endsOn: e.target.value })}
              />
            </Field>
          </div>
          {form.startsOn === form.endsOn && (
            <Check
              label="Half day"
              checked={form.halfDay}
              onCheckedChange={(v) => setForm({ ...form, halfDay: v })}
            />
          )}
          <Field label="Details (optional)">
            <TextArea
              maxLength={500}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder={staffLeave ? "Anything the office should know" : "Fever since last night"}
            />
          </Field>
          <p className={cn("text-body-sm", days === 0 ? "text-destructive" : "text-muted-foreground")} data-testid="leave-days">
            {days === 0
              ? "Those are all days off."
              : `${plural(days)} of school${balance && balance.left != null ? `; ${balance.left} left` : ""}.`}
          </p>
          {save.error && <FormMessage message={{ text: save.error.message, kind: "err" }} />}
          <DialogFooter>
            <Button type="submit" disabled={days === 0 || save.isPending}>
              Ask for leave
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DecideDialog({
  slug,
  request,
  status,
  onDone,
}: {
  slug: string
  request: Request
  status: "approved" | "rejected"
  onDone: (changed: boolean) => void
}) {
  const [note, setNote] = useState("")
  const save = useMutation({
    mutationFn: () => api(`/orgs/${slug}/leave/${request.id}/decision`, { body: { status, note } }),
    onSuccess: () => onDone(true),
  })
  const approve = status === "approved"
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(false)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {approve ? "Approve" : "Refuse"} {request.name}&apos;s leave?
          </DialogTitle>
          <DialogDescription>
            {when(request)} · {plural(request.days)} · {request.typeName}
            {approve && request.kind === "student" && ". Any absences on those days become excused."}
          </DialogDescription>
        </DialogHeader>
        <Field label={approve ? "Note (optional)" : "Why (optional)"}>
          <TextArea maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        {save.error && <FormMessage message={{ text: save.error.message, kind: "err" }} />}
        <DialogFooter>
          <Button
            variant={approve ? "default" : "destructive"}
            onClick={() => save.mutate()}
            disabled={save.isPending}
          >
            {approve ? "Approve" : "Refuse"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TypesDialog({ slug, onDone }: { slug: string; onDone: (changed: boolean) => void }) {
  const { data, error } = useQuery({
    queryKey: ["org", slug, "leave", "types"],
    queryFn: () => api<{ types: LeaveType[] }>(`/orgs/${slug}/leave/types`),
  })
  const [rows, setRows] = useState<{ key?: string; name: string; days: string }[] | null>(null)
  const list =
    rows ?? data?.types.map((t) => ({ key: t.key, name: t.name, days: t.days == null ? "" : String(t.days) })) ?? []
  const set = (i: number, patch: Partial<(typeof list)[number]>) =>
    setRows(list.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/leave/types`, {
        method: "PUT",
        body: {
          types: list.map((r) => ({
            ...(r.key ? { key: r.key } : {}),
            name: r.name,
            days: r.days === "" ? null : Number(r.days),
          })),
        },
      }),
    onSuccess: () => onDone(true),
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onDone(false)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Kinds of staff leave</DialogTitle>
          <DialogDescription>Days a year for each; leave it blank for no limit.</DialogDescription>
        </DialogHeader>
        {!data ? (
          <Loading error={error} />
        ) : (
          <div className="grid gap-2">
            {list.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_6rem_auto] gap-2">
                <TextInput aria-label={`Leave ${i + 1} name`} value={r.name} onChange={(e) => set(i, { name: e.target.value })} />
                <TextInput
                  aria-label={`Leave ${i + 1} days`}
                  type="number"
                  min={0}
                  placeholder="No limit"
                  value={r.days}
                  onChange={(e) => set(i, { days: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove leave ${i + 1}`}
                  onClick={() => setRows(list.filter((_, j) => j !== i))}
                >
                  ×
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              className="justify-self-start"
              onClick={() => setRows([...list, { name: "", days: "" }])}
            >
              <PlusIcon /> Add a kind
            </Button>
          </div>
        )}
        {save.error && <FormMessage message={{ text: save.error.message, kind: "err" }} />}
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={!rows || save.isPending}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
