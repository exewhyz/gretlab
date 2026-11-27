"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"

import { Figure, Figures } from "@/components/figures"
import { Field, FormMessage, TextInput } from "@/components/form"
import {
  Card,
  Loading,
  PageTitle,
  Table,
} from "@/features/admin/components/shell"
import type { myFees } from "@/features/fees/online"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { formatDate, formatDay } from "@/lib/format"
import { loadRazorpay, type RazorpayAnswer } from "@/lib/razorpay-checkout"

import { rupees } from "./fees-setup"

type Data = ApiResult<typeof myFees>
type PlanFees = Data["plans"][number]

/** A student's fees, for them or a linked parent: what's due and when, receipts, paying online. */
export function MyFees({
  slug,
  studentId,
}: {
  slug: string
  studentId: string
}) {
  const { data, error } = useQuery({
    queryKey: ["org", slug, "fees", "mine", studentId],
    queryFn: () => api<Data>(`/orgs/${slug}/fees/mine/${studentId}`),
  })
  if (!data) return <Loading error={error} />
  const owes = data.plans.reduce((n, p) => n + p.ledger.balance, 0)
  const overdue = data.plans.reduce((n, p) => n + p.ledger.overdue, 0)
  const next = data.plans
    .flatMap((p) => p.ledger.instalments)
    .filter((i) => i.balance > 0 && !i.overdue)
    .sort((a, b) => (a.dueOn < b.dueOn ? -1 : 1))[0]
  return (
    <div className="grid min-w-0 gap-6 [&>*]:min-w-0" data-testid="my-fees">
      <PageTitle>
        {studentId === "me"
          ? "Fees"
          : `Fees: ${data.student.name ?? data.student.email}`}
      </PageTitle>
      <Figures>
        <Figure label="Owed" value={rupees(owes)} />
        <Figure
          label="Overdue"
          value={rupees(overdue)}
          tone={overdue > 0 ? "bad" : undefined}
        />
        <Figure
          label="Next due"
          value={next ? formatDay(next.dueOn) : "—"}
          hint={next ? rupees(next.balance) : undefined}
        />
      </Figures>
      {data.plans.length === 0 ? (
        <p className="text-body-sm text-body">No fees are set for you yet.</p>
      ) : (
        data.plans.map((p) => (
          <PlanCard
            key={p.id}
            slug={slug}
            data={data}
            plan={p}
            studentId={studentId}
          />
        ))
      )}
    </div>
  )
}

function PlanCard({
  slug,
  data,
  plan,
  studentId,
}: {
  slug: string
  data: Data
  plan: PlanFees
  studentId: string
}) {
  const l = plan.ledger
  const paid = plan.payments.filter(
    (p) => p.status === "paid" || p.status === "cancelled"
  )
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-title-sm text-ink">{plan.name}</h2>
          <p className="text-caption text-body tabular-nums">
            {rupees(l.paid)} paid of {rupees(l.due)}
            {l.balance > 0 ? ` · ${rupees(l.balance)} to pay` : " · all paid"}
          </p>
        </div>
      </div>
      <Table headers={["Instalment", "Due on", "Amount", "Paid", "To pay"]}>
        {l.instalments.map((i) => (
          <tr key={i.id} data-testid="my-instalment">
            <td className="text-ink">{i.label}</td>
            <td>{formatDay(i.dueOn)}</td>
            <td className="tabular-nums">
              {rupees(i.due)}
              {(i.concession > 0 || i.fine > 0) && (
                <span className="block text-caption text-body">
                  {i.concession > 0 ? `${rupees(i.concession)} concession` : ""}
                  {i.concession > 0 && i.fine > 0 ? " · " : ""}
                  {i.fine > 0 ? `${rupees(i.fine)} late fine` : ""}
                </span>
              )}
            </td>
            <td className="tabular-nums">{rupees(i.paid)}</td>
            <td
              className={`tabular-nums ${i.overdue ? "text-destructive" : ""}`}
            >
              {i.balance > 0 ? rupees(i.balance) : "—"}
              {i.overdue && (
                <span className="block text-caption">
                  {i.daysOverdue} days late
                </span>
              )}
            </td>
          </tr>
        ))}
      </Table>
      {l.balance > 0 &&
        (data.online ? (
          <PayOnline
            slug={slug}
            studentId={studentId}
            data={data}
            plan={plan}
          />
        ) : (
          <p className="mt-3 text-body-sm text-body">
            Pay at the fee counter. Paying online isn&apos;t set up here yet.
          </p>
        ))}
      {paid.length > 0 && (
        <div className="mt-4 grid gap-2">
          <h3 className="text-body-sm font-medium text-ink">Receipts</h3>
          <ul className="grid gap-1">
            {paid.map((p) => (
              <li
                key={p.id}
                data-testid="my-receipt"
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-hairline px-3 py-2 text-body-sm"
              >
                <span className="font-mono text-ink">
                  {p.receiptNo}
                  {p.status === "cancelled" && (
                    <Badge variant="destructive" className="ml-2">
                      Cancelled
                    </Badge>
                  )}
                </span>
                <span className="text-body tabular-nums">
                  {rupees(p.amount)} · {p.paidAt ? formatDate(p.paidAt) : ""}
                </span>
                <a
                  className="text-ink underline-offset-2 hover:underline"
                  href={`/api/v1/orgs/${slug}/fees/payments/${p.id}/receipt`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Download
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  )
}

type Order = {
  orderId: string
  keyId: string
  amount: number
  currency: string
  name: string
  description: string
  prefill: { name: string; email: string }
}

function PayOnline({
  slug,
  studentId,
  data,
  plan,
}: {
  slug: string
  studentId: string
  data: Data
  plan: PlanFees
}) {
  const client = useQueryClient()
  const first =
    plan.ledger.overdue > 0 ? plan.ledger.overdue : plan.ledger.balance
  const [amount, setAmount] = useState(String(first))
  const [message, setMessage] = useState<{
    text: string
    kind: "ok" | "err"
  } | null>(null)
  const pay = useMutation({
    mutationFn: async () => {
      const order = await api<Order>(`/orgs/${slug}/fees/pay`, {
        body: {
          studentId: data.student.id,
          planId: plan.id,
          amount: Number(amount),
        },
      })
      const Razorpay = await loadRazorpay()
      return new Promise<string>((resolve, reject) => {
        const checkout = new Razorpay({
          key: order.keyId,
          amount: order.amount,
          currency: order.currency,
          order_id: order.orderId,
          name: order.name,
          description: order.description,
          prefill: order.prefill,
          handler: (answer: RazorpayAnswer) => {
            api<{ paid: boolean; receiptNo: string | null }>(
              `/orgs/${slug}/fees/pay/confirm`,
              {
                body: {
                  orderId: answer.razorpay_order_id,
                  paymentId: answer.razorpay_payment_id,
                  signature: answer.razorpay_signature,
                },
              }
            )
              .then((r) => resolve(`Paid. Receipt ${r.receiptNo ?? ""}.`))
              .catch(reject)
          },
          modal: {
            ondismiss: () =>
              reject(new Error("Payment closed: nothing was charged.")),
          },
        })
        checkout.on("payment.failed", (e) =>
          reject(
            new Error(e.error?.description ?? "The payment didn't go through.")
          )
        )
        checkout.open()
      })
    },
    onMutate: () => setMessage(null),
    onSuccess: (text) => {
      setMessage({ text, kind: "ok" })
      void client.invalidateQueries({
        queryKey: ["org", slug, "fees", "mine", studentId],
      })
    },
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
    meta: { quiet: true },
  })
  return (
    <form
      className="mt-4 flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        pay.mutate()
      }}
    >
      <Field label="Amount (₹)" help={`Up to ${rupees(plan.ledger.balance)}.`}>
        <TextInput
          inputMode="numeric"
          className="w-40"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      </Field>
      <Button
        type="submit"
        disabled={pay.isPending || !(Number(amount) > 0)}
        data-testid="pay-fees"
      >
        {pay.isPending ? "Opening the payment…" : "Pay online"}
      </Button>
      {message && <FormMessage message={message} />}
    </form>
  )
}
