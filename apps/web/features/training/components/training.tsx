"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { KindTerms, TrainingStatus } from "@workspace/judge"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"
import { cn } from "@workspace/ui/lib/utils"

import { ConfirmButton } from "@/components/confirm"
import { Field, FormMessage, SelectInput, TextInput } from "@/components/form"
import {
  Card,
  Loading,
  PageTitle,
  Table,
} from "@/features/admin/components/shell"
import { GroupPicker } from "@/features/orgs/components/group-picker"
import { api } from "@/lib/api/client"
import { formatDay } from "@/lib/format"
import { orgPages } from "@/lib/paths"
import type { ApiResult } from "@/lib/api/types"
import type { listTraining } from "@/features/training/server"
import type { issueCertificates } from "@/features/certificates/server"

/*
 * Training (the "training" module): courses assigned to departments and teams with due
 * dates, renewed every few months for compliance. L&D admins assign and follow
 * everything; a manager sees their teams. Each training opens to every person it reaches:
 * where they are, reminders, and certificates (which expire with the renewal).
 */

type Counts = Record<TrainingStatus, number>

type List = ApiResult<typeof listTraining>

interface Detail {
  day: string
  terms: KindTerms
  training: {
    courseId: string
    groupId: string
    course: string
    group: string
    dueOn: string | null
    renewMonths: number | null
    whole: boolean
  }
  people: {
    id: string
    name: string
    email: string
    team: string
    status: TrainingStatus
    validUntil: string | null
    needBy: string | null
    completedOn: string | null
    certificate: string | null
    progress: { done: number; total: number }
  }[]
  counts: Counts
  canManage: boolean
}

export const STATUS: Record<
  TrainingStatus,
  { label: string; tone: "bad" | "warn" | "ok" | "plain" }
> = {
  overdue: { label: "Overdue", tone: "bad" },
  expired: { label: "Expired", tone: "bad" },
  due: { label: "Due soon", tone: "warn" },
  expiring: { label: "Renew soon", tone: "warn" },
  todo: { label: "To do", tone: "plain" },
  done: { label: "Done", tone: "ok" },
}

export function StatusBadge({ status }: { status: TrainingStatus }) {
  const s = STATUS[status]
  return (
    <span
      data-testid="training-status"
      className={cn(
        "rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        s.tone === "bad" && "bg-destructive/10 text-destructive",
        s.tone === "warn" && "bg-primary/10 text-primary-active",
        s.tone === "ok" && "bg-success/10 text-success",
        s.tone === "plain" && "bg-muted text-ink"
      )}
    >
      {s.label}
    </span>
  )
}

const renewText = (m: number | null) =>
  m == null
    ? "Once"
    : m === 12
      ? "Every year"
      : m % 12 === 0
        ? `Every ${m / 12} years`
        : `Every ${m} months`

/** How many are done of everyone it reaches, as a bar with its numbers. */
function Compliance({ counts, people }: { counts: Counts; people: number }) {
  const ok = counts.done + counts.expiring
  const pct = people ? Math.round((100 * ok) / people) : 0
  return (
    <div className="grid min-w-36 gap-1">
      <div className="flex justify-between text-caption">
        <span>
          {ok} of {people} done
        </span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div
          className="h-full rounded-full bg-success"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

export function TrainingList({ slug }: { slug: string }) {
  const { data, error } = useQuery({
    queryKey: ["org", slug, "training"],
    queryFn: () => api<List>(`/orgs/${slug}/training`),
  })
  const [assigning, setAssigning] = useState(false)
  if (!data) return <Loading error={error} />
  const total = (k: TrainingStatus) =>
    data.trainings.reduce((n, t) => n + t.counts[k], 0)
  const people = data.trainings.reduce((n, t) => n + t.people, 0)
  return (
    <>
      <PageTitle
        action={
          data.canAssign && (
            <Button
              onClick={() => setAssigning(true)}
              disabled={!data.courses.length}
            >
              Assign training
            </Button>
          )
        }
      >
        Training
      </PageTitle>
      <p className="-mt-2 mb-4 max-w-3xl text-body-sm text-body">
        Courses assigned to{" "}
        {data.levels.map((l) => l.toLowerCase() + "s").join(" and ")}, with due
        dates and, for compliance, renewal. People take them on their{" "}
        {data.terms.group.toLowerCase()}&apos;s page.
        {data.canAssign &&
          !data.courses.length &&
          " Make a course ready under Courses to assign it."}
      </p>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ["Assigned", people, "assigned"],
            ["Overdue", total("overdue"), "overdue"],
            ["Expired", total("expired"), "expired"],
            ["Due or renew soon", total("due") + total("expiring"), "soon"],
          ] as const
        ).map(([label, n, id]) => (
          <Card
            key={id}
            className="grid gap-0.5 p-4"
            data-testid={`training-tile-${id}`}
          >
            <div className="text-caption">{label}</div>
            <div
              className={cn(
                "text-title-md font-semibold",
                (id === "overdue" || id === "expired") && n
                  ? "text-destructive"
                  : "text-ink"
              )}
            >
              {n}
            </div>
          </Card>
        ))}
      </div>
      {data.trainings.length === 0 ? (
        <Card>
          <p data-testid="no-training">No training assigned yet.</p>
        </Card>
      ) : (
        <Table
          headers={[
            "Training",
            "For",
            "Due",
            "Renewal",
            "Done",
            "Needs attention",
          ]}
        >
          {data.trainings.map((t) => {
            const late = t.counts.overdue + t.counts.expired
            const soon = t.counts.due + t.counts.expiring
            return (
              <tr key={`${t.groupId}:${t.courseId}`} data-testid="training-row">
                <td>
                  <Link
                    className="font-medium text-ink hover:underline"
                    href={orgPages(slug).manage(
                      `/training/${t.groupId}/${t.courseId}`
                    )}
                  >
                    {t.course}
                  </Link>
                </td>
                <td className="whitespace-nowrap">
                  {t.group}
                  {!t.whole && (
                    <span className="ml-1 text-caption">(your teams)</span>
                  )}
                </td>
                <td className="whitespace-nowrap">
                  {t.dueOn ? formatDay(t.dueOn) : "—"}
                </td>
                <td className="whitespace-nowrap">
                  {renewText(t.renewMonths)}
                </td>
                <td>
                  <Compliance counts={t.counts} people={t.people} />
                </td>
                <td
                  className="whitespace-nowrap"
                  data-testid="training-attention"
                >
                  {late > 0 && (
                    <span className="font-medium text-destructive">
                      {late} late
                    </span>
                  )}
                  {late > 0 && soon > 0 && " · "}
                  {soon > 0 && (
                    <span className="text-primary-active">{soon} soon</span>
                  )}
                  {late + soon === 0 && <span className="text-caption">—</span>}
                </td>
              </tr>
            )
          })}
        </Table>
      )}
      {assigning && (
        <AssignDialog
          slug={slug}
          data={data}
          onClose={() => setAssigning(false)}
        />
      )}
    </>
  )
}

function AssignDialog({
  slug,
  data,
  onClose,
  initial,
}: {
  slug: string
  data: Pick<List, "courses" | "groups" | "levels" | "day">
  onClose: () => void
  initial?: {
    courseId: string
    groupId: string
    dueOn: string | null
    renewMonths: number | null
  }
}) {
  const client = useQueryClient()
  const router = useRouter()
  const [courseId, setCourseId] = useState(initial?.courseId ?? "")
  const [groupId, setGroupId] = useState(initial?.groupId ?? "")
  const [dueOn, setDueOn] = useState(initial?.dueOn ?? "")
  const [renew, setRenew] = useState(
    initial?.renewMonths ? String(initial.renewMonths) : ""
  )
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/training`, {
        body: {
          courseId,
          groupId,
          dueOn: dueOn || null,
          renewMonths: renew ? Number(renew) : null,
        },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["org", slug, "training"] })
      onClose()
      if (!initial)
        router.push(orgPages(slug).manage(`/training/${groupId}/${courseId}`))
    },
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {initial ? "Change training" : "Assign training"}
          </DialogTitle>
          <DialogDescription>
            Everyone in the group, and the groups inside it, gets the course.
            With renewal, it has to be done again before it expires, and
            certificates expire with it.
          </DialogDescription>
        </DialogHeader>
        <form
          id="assign-form"
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          {!initial && (
            <>
              <Field label="Course">
                <SelectInput
                  value={courseId}
                  onChange={(e) => setCourseId(e.target.value)}
                >
                  <option value="">Choose a course</option>
                  {data.courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </SelectInput>
              </Field>
              <div className="grid gap-1.5">
                <span className="text-caption font-semibold text-ink">For</span>
                <GroupPicker
                  groups={data.groups}
                  levels={data.levels}
                  value={groupId}
                  onChange={setGroupId}
                  label="Assign to"
                  placeholder="Choose a department or team"
                />
              </div>
            </>
          )}
          <Field label="Due" help="Leave empty for no due date.">
            <TextInput
              type="date"
              min={data.day}
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
            />
          </Field>
          <Field label="Renewal">
            <SelectInput
              value={renew}
              onChange={(e) => setRenew(e.target.value)}
            >
              <option value="">Once: no renewal</option>
              <option value="3">Every 3 months</option>
              <option value="6">Every 6 months</option>
              <option value="12">Every year</option>
              <option value="24">Every 2 years</option>
              <option value="36">Every 3 years</option>
            </SelectInput>
          </Field>
        </form>
        {save.error && (
          <FormMessage message={{ text: save.error.message, kind: "err" }} />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form="assign-form"
            disabled={!courseId || !groupId || save.isPending}
          >
            {initial ? "Save" : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TrainingDetail({
  slug,
  groupId,
  courseId,
}: {
  slug: string
  groupId: string
  courseId: string
}) {
  const client = useQueryClient()
  const router = useRouter()
  const key = ["org", slug, "training", groupId, courseId]
  const base = `/orgs/${slug}/training/${groupId}/${courseId}`
  const { data, error } = useQuery({
    queryKey: key,
    queryFn: () => api<Detail>(base),
  })
  const [filter, setFilter] = useState<"" | "attention" | TrainingStatus>("")
  const [editing, setEditing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const refresh = () =>
    void client.invalidateQueries({ queryKey: ["org", slug, "training"] })
  const remind = useMutation({
    mutationFn: () => api<{ reminded: number }>(`${base}/remind`, { body: {} }),
    onSuccess: (r) =>
      setMessage(
        r.reminded
          ? `Reminded ${r.reminded}.`
          : "Everyone's done: nobody to remind."
      ),
  })
  const certify = useMutation({
    mutationFn: () =>
      api<ApiResult<typeof issueCertificates>>(
        `/orgs/${slug}/classes/${groupId}/certificates`,
        {
          body: { kind: "course", courseId },
        }
      ),
    onSuccess: (r) => {
      setMessage(
        r.issued
          ? `Issued ${r.issued} certificate${r.issued === 1 ? "" : "s"}.`
          : "Everyone who finished has a valid one."
      )
      refresh()
    },
  })
  const remove = useMutation({
    mutationFn: () => api(base, { method: "DELETE" }),
    onSuccess: () => {
      refresh()
      router.push(orgPages(slug).manage(`/training`))
    },
  })
  if (!data) return <Loading error={error} />
  const t = data.training
  const rows = data.people.filter((p) =>
    !filter
      ? true
      : filter === "attention"
        ? ["overdue", "expired", "due", "expiring"].includes(p.status)
        : p.status === filter
  )
  const pending = data.people.filter((p) => p.status !== "done").length
  const uncertified = data.people.filter(
    (p) => (p.status === "done" || p.status === "expiring") && !p.certificate
  ).length
  return (
    <div data-testid="training-detail">
      <PageTitle>{t.course}</PageTitle>
      <p className="-mt-2 mb-4 text-body-sm text-body">
        For {t.group}
        {!t.whole && " (the teams you see)"} ·{" "}
        {t.dueOn ? `due ${formatDay(t.dueOn)}` : "no due date"} ·{" "}
        {renewText(t.renewMonths).toLowerCase()}
      </p>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <Field label="Show">
          <SelectInput
            value={filter}
            onChange={(e) => setFilter(e.target.value as typeof filter)}
          >
            <option value="">Everyone ({data.people.length})</option>
            <option value="attention">
              Needs attention (
              {data.counts.overdue +
                data.counts.expired +
                data.counts.due +
                data.counts.expiring}
              )
            </option>
            {(Object.keys(STATUS) as TrainingStatus[]).map((s) => (
              <option key={s} value={s}>
                {STATUS[s].label} ({data.counts[s]})
              </option>
            ))}
          </SelectInput>
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!pending || remind.isPending}
            onClick={() => remind.mutate()}
          >
            Remind {pending ? pending : ""} not done
          </Button>
          {data.canManage && (
            <>
              <Button
                variant="outline"
                disabled={!uncertified || certify.isPending}
                onClick={() => certify.mutate()}
              >
                Certify {uncertified ? uncertified : ""} finished
              </Button>
              <Button variant="outline" onClick={() => setEditing(true)}>
                Change
              </Button>
              <ConfirmButton
                variant="outline"
                title={`Take ${t.course} off ${t.group}?`}
                description="People keep what they've done and any certificates; it's no longer assigned."
                confirmLabel="Remove"
                onConfirm={() => remove.mutate()}
              >
                Remove
              </ConfirmButton>
            </>
          )}
        </div>
      </div>
      {message && <FormMessage message={{ text: message, kind: "ok" }} />}
      {(remind.error ?? certify.error ?? remove.error) && (
        <FormMessage
          message={{
            text: (remind.error ?? certify.error ?? remove.error)!.message,
            kind: "err",
          }}
        />
      )}
      {rows.length === 0 ? (
        <Card>Nobody here.</Card>
      ) : (
        <Table
          headers={[
            data.terms.learner,
            "Team",
            "Progress",
            "Status",
            "Needed by",
            "Done on",
            "Certificate",
          ]}
        >
          {rows.map((p) => (
            <tr key={p.id} data-testid="training-person">
              <td>
                <div className="font-medium">{p.name}</div>
                <div className="text-caption">{p.email}</div>
              </td>
              <td className="whitespace-nowrap">{p.team}</td>
              <td className="whitespace-nowrap tabular-nums">
                {p.progress.done} of {p.progress.total}
              </td>
              <td>
                <StatusBadge status={p.status} />
              </td>
              <td className="whitespace-nowrap">
                {p.needBy ? formatDay(p.needBy) : "—"}
              </td>
              <td className="whitespace-nowrap">
                {p.completedOn ? formatDay(p.completedOn) : "—"}
                {p.validUntil && (
                  <div className="text-caption">
                    valid until {formatDay(p.validUntil)}
                  </div>
                )}
              </td>
              <td className="whitespace-nowrap">
                {p.certificate ? (
                  <Link
                    className="font-mono text-xs text-primary hover:underline"
                    href={`/certificates/${p.certificate}`}
                  >
                    {p.certificate}
                  </Link>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {editing && (
        <AssignDialog
          slug={slug}
          data={{ courses: [], groups: [], levels: [], day: data.day }}
          initial={{
            courseId,
            groupId,
            dueOn: t.dueOn,
            renewMonths: t.renewMonths,
          }}
          onClose={() => {
            setEditing(false)
            void client.invalidateQueries({ queryKey: key })
          }}
        />
      )}
    </div>
  )
}
