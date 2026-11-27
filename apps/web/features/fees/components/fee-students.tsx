"use client"

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useState } from "react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog"

import { ConfirmButton } from "@/components/confirm"
import { DetailSheet } from "@/components/detail-sheet"
import { Field, FormMessage, SelectInput, TextInput } from "@/components/form"
import { Loading, Pager, Table } from "@/features/admin/components/shell"
import type { feeStudents, studentFees } from "@/features/fees/ledger"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { useDebounced } from "@/lib/use-debounced"
import { formatDate, formatDay } from "@/lib/format"

import { rupees } from "./fees-setup"

type Students = ApiResult<typeof feeStudents>
type Fees = ApiResult<typeof studentFees>
type PlanFees = Fees["plans"][number]

const MODES = [
  ["cash", "Cash"],
  ["cheque", "Cheque"],
  ["dd", "Demand draft"],
  ["upi", "UPI"],
  ["transfer", "Bank transfer"],
] as const

/** Fees › Students: find a student, then their fees in a side sheet. */
export function FeeStudents({ slug }: { slug: string }) {
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<string | null>(null)
  const query = useDebounced(q)
  const { data, error, isPlaceholderData } = useQuery({
    queryKey: ["org", slug, "fees", "students", query, page],
    queryFn: () =>
      api<Students>(
        `/orgs/${slug}/fees/students?page=${page}&q=${encodeURIComponent(query)}`
      ),
    placeholderData: keepPreviousData,
  })
  return (
    <div className="grid min-w-0 gap-3">
      <div className="max-w-sm">
        <TextInput
          aria-label="Search students"
          placeholder="Name, email or admission number"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }}
        />
      </div>
      {!data ? (
        <Loading error={error} />
      ) : data.items.length === 0 ? (
        <p className="text-body-sm text-body">
          {query
            ? "No student matches."
            : "No students in the classes you see."}
        </p>
      ) : (
        <div className={isPlaceholderData ? "opacity-60" : undefined}>
          <Table headers={["Student", "Admission no.", ""]}>
            {data.items.map((s) => (
              <tr key={s.id} data-testid="fee-student">
                <td>
                  <span className="text-ink">{s.name ?? s.email}</span>
                  <span className="block text-caption text-body">
                    {s.email}
                  </span>
                </td>
                <td className="tabular-nums">{s.admissionNo ?? "—"}</td>
                <td className="text-right">
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Fees of ${s.name ?? s.email}`}
                    onClick={() => setOpen(s.id)}
                  >
                    Fees
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
          <Pager
            page={data.page}
            pages={data.pages}
            total={data.total}
            perPage={50}
            onPage={setPage}
          />
        </div>
      )}
      {open && (
        <StudentFeesSheet
          slug={slug}
          studentId={open}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}

function StudentFeesSheet({
  slug,
  studentId,
  onClose,
}: {
  slug: string
  studentId: string
  onClose: () => void
}) {
  const { data, error } = useQuery({
    queryKey: ["org", slug, "fees", "student", studentId],
    queryFn: () => api<Fees>(`/orgs/${slug}/fees/students/${studentId}`),
  })
  return (
    <DetailSheet
      title={data ? (data.student.name ?? data.student.email) : "Fees"}
      description={
        data
          ? `${data.student.admissionNo ? `Admission no. ${data.student.admissionNo} · ` : ""}${data.student.email}`
          : undefined
      }
      onClose={onClose}
      testId="student-fees"
    >
      {!data ? (
        <Loading error={error} />
      ) : data.plans.length === 0 ? (
        <p className="text-body-sm text-body">
          No fee plan covers this student&apos;s classes.
        </p>
      ) : (
        <div className="grid gap-6">
          {data.plans.map((p) => (
            <PlanLedger key={p.id} slug={slug} data={data} plan={p} />
          ))}
        </div>
      )}
    </DetailSheet>
  )
}

function PlanLedger({
  slug,
  data,
  plan,
}: {
  slug: string
  data: Fees
  plan: PlanFees
}) {
  const [collecting, setCollecting] = useState(false)
  const [conceding, setConceding] = useState(false)
  const client = useQueryClient()
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/orgs/${slug}/fees/concessions/${id}`, { method: "DELETE" }),
    onSuccess: () =>
      client.invalidateQueries({
        queryKey: ["org", slug, "fees", "student", data.student.id],
      }),
    meta: { success: "Removed." },
  })
  const [cancelling, setCancelling] = useState<string | null>(null)
  const l = plan.ledger
  return (
    <section className="grid gap-3" data-testid="plan-ledger">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-title-sm text-ink">{plan.name}</h3>
          <p className="text-caption text-body tabular-nums">
            Due {rupees(l.due)} · paid {rupees(l.paid)} ·{" "}
            <span className={l.overdue > 0 ? "text-destructive" : undefined}>
              owes {rupees(l.balance)}
              {l.overdue > 0 ? ` (${rupees(l.overdue)} overdue)` : ""}
            </span>
          </p>
        </div>
        {data.can.collect && l.balance > 0 && (
          <Button onClick={() => setCollecting(true)}>Collect</Button>
        )}
      </div>
      <Table
        headers={[
          "Instalment",
          "Due on",
          "Fee",
          "Concession",
          "Fine",
          "Paid",
          "Owes",
        ]}
      >
        {l.instalments.map((i) => (
          <tr key={i.id} data-testid="ledger-row">
            <td className="text-ink">{i.label}</td>
            <td>{formatDay(i.dueOn)}</td>
            <td className="tabular-nums">{rupees(i.gross)}</td>
            <td className="tabular-nums">
              {i.concession ? `−${rupees(i.concession)}` : "—"}
            </td>
            <td className="tabular-nums">{i.fine ? rupees(i.fine) : "—"}</td>
            <td className="tabular-nums">{rupees(i.paid)}</td>
            <td
              className={`tabular-nums ${i.overdue ? "text-destructive" : ""}`}
            >
              {rupees(i.balance)}
              {i.overdue && (
                <span className="block text-caption">
                  {i.daysOverdue} days late
                </span>
              )}
            </td>
          </tr>
        ))}
      </Table>
      {(plan.concessions.length > 0 || data.can.concede) && (
        <div className="grid gap-2" data-testid="concessions">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-body-sm font-medium text-ink">Concessions</h4>
            {data.can.concede && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConceding(true)}
              >
                Give a concession
              </Button>
            )}
          </div>
          {plan.concessions.length === 0 ? (
            <p className="text-caption text-body">None.</p>
          ) : (
            <ul className="grid gap-1">
              {plan.concessions.map((c) => (
                <li
                  key={c.id}
                  data-testid="concession"
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-hairline px-3 py-2 text-body-sm"
                >
                  <span className="text-ink">
                    {c.percent ? `${c.percent}%` : rupees(c.amount ?? 0)} off{" "}
                    {c.headId
                      ? (data.heads.find((h) => h.id === c.headId)?.name ??
                        "a head")
                      : "the whole plan"}
                    <span className="ml-2 text-caption text-body">
                      {REASONS.find(([k]) => k === c.reason)?.[1] ?? c.reason}
                      {c.note ? ` · ${c.note}` : ""}
                    </span>
                  </span>
                  {data.can.concede && (
                    <ConfirmButton
                      variant="ghost"
                      size="sm"
                      title="Remove this concession?"
                      description="What it took off is owed again."
                      confirmLabel="Remove"
                      onConfirm={() => remove.mutate(c.id)}
                    >
                      Remove
                    </ConfirmButton>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {plan.payments.length > 0 && (
        <div className="grid gap-2">
          <h4 className="text-body-sm font-medium text-ink">Receipts</h4>
          <Table headers={["Receipt", "Paid on", "Amount", "By", ""]}>
            {plan.payments.map((pay) => (
              <tr
                key={pay.id}
                data-testid="fee-receipt"
                className={
                  pay.status === "cancelled" ? "opacity-60" : undefined
                }
              >
                <td className="font-mono text-ink">
                  {pay.receiptNo}
                  {pay.status === "cancelled" && (
                    <Badge variant="destructive" className="ml-2">
                      Cancelled
                    </Badge>
                  )}
                </td>
                <td>{pay.paidAt ? formatDate(pay.paidAt) : "—"}</td>
                <td className="tabular-nums">{rupees(pay.amount)}</td>
                <td className="text-body-sm">
                  {MODES.find(([m]) => m === pay.mode)?.[1] ?? "Online"}
                  {pay.reference && (
                    <span className="block text-caption text-body">
                      {pay.reference}
                    </span>
                  )}
                </td>
                <td className="text-right">
                  <span className="inline-flex gap-1">
                    <a
                      className="rounded-md px-2 py-1 text-body-sm text-ink underline-offset-2 hover:underline"
                      href={`/api/v1/orgs/${slug}/fees/payments/${pay.id}/receipt`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Receipt
                    </a>
                    {data.can.collect && pay.status === "paid" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Cancel ${pay.receiptNo}`}
                        onClick={() => setCancelling(pay.id)}
                      >
                        Cancel
                      </Button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </Table>
        </div>
      )}
      {conceding && (
        <ConcessionDialog
          slug={slug}
          data={data}
          plan={plan}
          onClose={() => setConceding(false)}
        />
      )}
      {collecting && (
        <CollectDialog
          slug={slug}
          studentId={data.student.id}
          plan={plan}
          onClose={() => setCollecting(false)}
        />
      )}
      {cancelling && (
        <CancelDialog
          slug={slug}
          studentId={data.student.id}
          paymentId={cancelling}
          onClose={() => setCancelling(null)}
        />
      )}
    </section>
  )
}

const REASONS = [
  ["merit", "Merit"],
  ["scholarship", "Scholarship"],
  ["sibling", "Sibling"],
  ["staff_ward", "Staff ward"],
  ["other", "Other"],
] as const

function ConcessionDialog({
  slug,
  data,
  plan,
  onClose,
}: {
  slug: string
  data: Fees
  plan: PlanFees
  onClose: () => void
}) {
  const client = useQueryClient()
  const [headId, setHeadId] = useState("")
  const [kind, setKind] = useState<"percent" | "amount">("percent")
  const [value, setValue] = useState("")
  const [reason, setReason] = useState<(typeof REASONS)[number][0]>("merit")
  const [note, setNote] = useState("")
  const give = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/fees/students/${data.student.id}/concessions`, {
        body: {
          planId: plan.id,
          headId: headId || null,
          percent: kind === "percent" ? Number(value) : null,
          amount: kind === "amount" ? Number(value) : null,
          reason,
          note,
        },
      }),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["org", slug, "fees", "student", data.student.id],
      })
      onClose()
    },
    meta: { success: "Given.", quiet: true },
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Give a concession on {plan.name}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            give.mutate()
          }}
        >
          <Field label="Off">
            <SelectInput
              value={headId}
              onChange={(e) => setHeadId(e.target.value)}
            >
              <option value="">The whole plan</option>
              {data.heads.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </SelectInput>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="As">
              <SelectInput
                value={kind}
                onChange={(e) => setKind(e.target.value as typeof kind)}
              >
                <option value="percent">A percent</option>
                <option value="amount">An amount (₹)</option>
              </SelectInput>
            </Field>
            <Field label={kind === "percent" ? "Percent" : "Amount (₹)"}>
              <TextInput
                inputMode="numeric"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Reason">
            <SelectInput
              value={reason}
              onChange={(e) => setReason(e.target.value as typeof reason)}
            >
              {REASONS.map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Note (optional)">
            <TextInput
              value={note}
              placeholder="State merit scholarship 2026"
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          {give.error && (
            <FormMessage message={{ text: give.error.message, kind: "err" }} />
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={give.isPending || !(Number(value) > 0)}
            >
              Give concession
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CollectDialog({
  slug,
  studentId,
  plan,
  onClose,
}: {
  slug: string
  studentId: string
  plan: PlanFees
  onClose: () => void
}) {
  const client = useQueryClient()
  const [amount, setAmount] = useState(String(plan.ledger.balance))
  const [mode, setMode] = useState<(typeof MODES)[number][0]>("cash")
  const [reference, setReference] = useState("")
  const collect = useMutation({
    mutationFn: () =>
      api<{ id: string; receiptNo: string }>(
        `/orgs/${slug}/fees/students/${studentId}/payments`,
        {
          body: {
            planId: plan.id,
            amount: Number(amount),
            mode,
            reference,
          },
        }
      ),
    onSuccess: (r) => {
      void client.invalidateQueries({ queryKey: ["org", slug, "fees"] })
      window.open(
        `/api/v1/orgs/${slug}/fees/payments/${r.id}/receipt`,
        "_blank"
      )
      onClose()
    },
    meta: { success: "Collected.", quiet: true },
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Collect for {plan.name}</DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            collect.mutate()
          }}
        >
          <Field
            label="Amount (₹)"
            help={`Owes ${rupees(plan.ledger.balance)}. It pays the oldest dues first.`}
          >
            <TextInput
              autoFocus
              inputMode="numeric"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label="Paid by">
            <SelectInput
              value={mode}
              onChange={(e) => setMode(e.target.value as typeof mode)}
            >
              {MODES.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </SelectInput>
          </Field>
          {mode !== "cash" && (
            <Field
              label={
                mode === "cheque" || mode === "dd"
                  ? "Number and bank"
                  : "Transaction reference"
              }
            >
              <TextInput
                value={reference}
                onChange={(e) => setReference(e.target.value)}
              />
            </Field>
          )}
          {collect.error && (
            <FormMessage
              message={{ text: collect.error.message, kind: "err" }}
            />
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={collect.isPending || !(Number(amount) > 0)}
            >
              Collect and print receipt
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CancelDialog({
  slug,
  studentId,
  paymentId,
  onClose,
}: {
  slug: string
  studentId: string
  paymentId: string
  onClose: () => void
}) {
  const client = useQueryClient()
  const [reason, setReason] = useState("")
  const cancel = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/fees/payments/${paymentId}/cancel`, {
        body: { reason },
      }),
    onSuccess: () => {
      void client.invalidateQueries({
        queryKey: ["org", slug, "fees", "student", studentId],
      })
      onClose()
    },
    meta: { success: "Cancelled.", quiet: true },
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cancel this receipt?</DialogTitle>
        </DialogHeader>
        <p className="text-body-sm text-body">
          It keeps its number and is marked cancelled; what it paid is owed
          again.
        </p>
        <Field label="Why">
          <TextInput
            autoFocus
            value={reason}
            placeholder="The cheque bounced"
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        {cancel.error && (
          <FormMessage message={{ text: cancel.error.message, kind: "err" }} />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="destructive"
            disabled={cancel.isPending || reason.trim().length < 3}
            onClick={() => cancel.mutate()}
          >
            Cancel receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
