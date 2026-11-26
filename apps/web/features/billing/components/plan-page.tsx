"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import { RENEW_WINDOW_DAYS, samePlan, type PlanChoice } from "@workspace/judge"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"

import { Field, FormMessage, TextArea, TextInput } from "@/components/form"
import { Figure, Figures } from "@/components/figures"
import {
  Card,
  Loading,
  PageTitle,
  Table,
} from "@/features/admin/components/shell"
import { Meter } from "@/features/home/components/home-parts"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { formatDate, formatDateTime } from "@/lib/format"
import type { orgBilling } from "@/features/billing/server"

import { PERIOD_LABEL, PlanBuilder, rupees } from "./plan-builder"

type Billing = ApiResult<typeof orgBilling>

export const STATUS: Record<
  string,
  { label: string; tone: "default" | "secondary" | "destructive" | "outline" }
> = {
  free: { label: "Free plan", tone: "secondary" },
  active: { label: "Paid", tone: "secondary" },
  past_due: { label: "Payment due", tone: "destructive" },
  paused: { label: "Paused", tone: "destructive" },
  custom: { label: "Set by GretLab", tone: "outline" },
}

/** Manage › Plan and billing: the plan, its use, changing it, billing details and invoices. */
export function PlanAndBilling({ slug }: { slug: string }) {
  const { data, error } = useQuery({
    queryKey: ["billing", slug],
    queryFn: () => api<Billing>(`/orgs/${slug}/billing`),
  })
  if (!data) return <Loading error={error} />
  return (
    <div className="mx-auto grid w-full max-w-6xl min-w-0 gap-6">
      <PageTitle>Plan and billing</PageTitle>
      {!data.enabled && (
        <p className="text-body-sm text-body" data-testid="billing-off">
          Billing isn&apos;t switched on yet: nothing is limited and nothing is
          charged.
        </p>
      )}
      <CurrentPlan slug={slug} data={data} />
      <ChangePlan slug={slug} data={data} />
      <BillingDetails slug={slug} data={data} />
      <Invoices slug={slug} data={data} />
    </div>
  )
}

/** The plan in force: what it is, when it renews, and how much of it is used. */
function CurrentPlan({ slug, data }: { slug: string; data: Billing }) {
  const client = useQueryClient()
  const plan = data.plan
  const status = STATUS[plan?.status ?? "custom"] ?? STATUS.custom!
  const names = new Map(data.catalogue.features.map((f) => [f.key, f.name]))
  const limitless = !plan || plan.features === null
  const share = (used: number, bought: number) =>
    bought > 0 ? (100 * used) / bought : 0
  const daysLeft = plan?.periodEnd
    ? Math.ceil((new Date(plan.periodEnd).getTime() - Date.now()) / 86_400_000)
    : null
  const keep = useMutation({
    mutationFn: () => api(`/orgs/${slug}/billing/next`, { method: "DELETE" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["billing", slug] }),
    meta: { success: "Your plan renews as it is." },
  })
  const usage = (label: string, used: number, bought: number) => (
    <Figure
      label={label}
      value={
        <span className="tabular-nums">
          {used.toLocaleString("en-IN")}
          {!limitless && (
            <span className="text-body-sm font-normal text-muted-foreground">
              {" "}
              of {bought.toLocaleString("en-IN")}
            </span>
          )}
        </span>
      }
      tone={!limitless && used > bought ? "bad" : undefined}
      hint={
        limitless ? (
          "No limit"
        ) : (
          <Meter value={share(used, bought)} bad={used > bought} />
        )
      }
    />
  )
  return (
    <section data-testid="current-plan" className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-title-sm text-ink">Your plan</h2>
        <Badge variant={status.tone}>{status.label}</Badge>
      </div>
      <Figures>
        <Figure
          label="Plan"
          value={
            limitless ? "Everything" : plan?.price ? rupees(plan.price) : "Free"
          }
          hint={
            limitless
              ? "No limits: from before billing, or set by GretLab"
              : `${PERIOD_LABEL[plan!.period]}${plan?.price ? ", before GST" : ""}`
          }
        />
        <Figure
          label="Renews"
          value={plan?.periodEnd ? formatDate(plan.periodEnd) : "—"}
          hint={
            daysLeft === null
              ? undefined
              : daysLeft > 0
                ? `In ${daysLeft} day${daysLeft === 1 ? "" : "s"}`
                : "Ended"
          }
          tone={daysLeft !== null && daysLeft <= 0 ? "bad" : undefined}
        />
        {usage("Students", data.usage.students, plan?.students ?? 0)}
        {usage("Staff", data.usage.staff, plan?.staff ?? 0)}
      </Figures>
      {!limitless && (
        <p className="text-caption text-body">
          <span className="text-muted-foreground">Included: </span>
          {(plan?.features ?? []).map((k) => names.get(k) ?? k).join(" · ")}
        </p>
      )}
      {data.limits && <LimitNote limits={data.limits} />}
      {plan?.next && (
        <div
          className="flex flex-wrap items-center gap-3 rounded-lg bg-card px-4 py-3 ring-1 ring-foreground/10"
          data-testid="next-plan"
        >
          <p className="min-w-0 flex-1 text-body-sm text-ink">
            <span className="font-medium">
              Changing on{" "}
              {plan.periodEnd ? formatDate(plan.periodEnd) : "your next period"}
              :
            </span>{" "}
            <span className="text-body">
              {plan.next.students.toLocaleString("en-IN")} students,{" "}
              {plan.next.staff.toLocaleString("en-IN")} staff,{" "}
              {plan.next.features.map((k) => names.get(k) ?? k).join(" · ")}.
              The plan below starts from it.
            </span>
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={keep.isPending}
            onClick={() => keep.mutate()}
          >
            Keep my current plan
          </Button>
        </div>
      )}
    </section>
  )
}

function ChangePlan({ slug, data }: { slug: string; data: Billing }) {
  const client = useQueryClient()
  const plan = data.plan
  const start = (): PlanChoice =>
    // A smaller plan already chosen for the next period is where renewing starts.
    plan?.next
      ? {
          ...plan.next,
          students: Math.max(plan.next.students, data.usage.students),
          staff: Math.max(plan.next.staff, data.usage.staff),
        }
      : plan && plan.features
        ? {
            features: plan.features,
            students: Math.max(plan.students, data.usage.students),
            staff: Math.max(plan.staff, data.usage.staff),
            judges: plan.judges,
            storagePacks: plan.storagePacks,
            period: plan.period,
          }
        : {
            features: data.catalogue.presets[0]?.features ?? [],
            students: Math.max(data.usage.students, 50),
            staff: Math.max(data.usage.staff, 5),
            judges: 0,
            storagePacks: 0,
            period: "year",
          }
  const [choice, setChoice] = useState<PlanChoice>(start)
  const [coupon, setCoupon] = useState("")
  const footer =
    data.enabled && data.canPay ? (
      <PayButton
        slug={slug}
        choice={choice}
        coupon={coupon}
        onCoupon={setCoupon}
        mode={payMode(data, choice)}
        onDone={() => client.invalidateQueries({ queryKey: ["billing", slug] })}
      />
    ) : (
      <p className="text-caption text-body" data-testid="pay-note">
        {data.enabled
          ? "Paying online isn't set up yet. To change your plan, contact GretLab with this plan; we'll set it for you."
          : "Billing isn't switched on, so there's nothing to pay."}
      </p>
    )
  return (
    <section data-testid="change-plan" className="grid gap-3">
      <div>
        <h2 className="text-title-sm text-ink">Change your plan</h2>
        <p className="text-caption text-body">
          What you add applies now, for the days left in this period. What you
          remove or lower waits for renewal; nothing is refunded.
        </p>
      </div>
      <PlanBuilder
        kindLabel={data.kind.label}
        footer={footer}
        catalogue={data.catalogue}
        value={choice}
        onChange={setChoice}
        gst={data.gst}
        buyerGstin={data.billing.gstin}
        current={
          plan && plan.features
            ? {
                choice: {
                  features: plan.features,
                  students: plan.students,
                  staff: plan.staff,
                  judges: plan.judges,
                  storagePacks: plan.storagePacks,
                  period: plan.period,
                },
                periodStart: plan.periodStart,
                periodEnd: plan.periodEnd,
              }
            : null
        }
      />
    </section>
  )
}

function BillingDetails({ slug, data }: { slug: string; data: Billing }) {
  const client = useQueryClient()
  const [form, setForm] = useState(data.billing)
  useEffect(() => setForm(data.billing), [data.billing])
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/billing/profile`, { method: "PUT", body: form }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["billing", slug] }),
    meta: { success: "Billing details saved", quiet: true },
  })
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm({ ...form, [key]: e.target.value })
  return (
    <Card data-testid="billing-details" className="grid gap-3">
      <h2 className="text-title-sm text-ink">Billing details</h2>
      <p className="text-caption text-body">
        On your invoices. With a GSTIN, GST is charged as CGST and SGST in our
        state, or IGST from another.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Legal name">
          <TextInput
            value={form.legalName}
            onChange={set("legalName")}
            maxLength={200}
          />
        </Field>
        <Field label="GSTIN" help="Optional, 15 characters">
          <TextInput
            value={form.gstin}
            onChange={set("gstin")}
            maxLength={15}
          />
        </Field>
        <Field label="Billing email">
          <TextInput
            type="email"
            value={form.billingEmail}
            onChange={set("billingEmail")}
          />
        </Field>
        <Field label="Address">
          <TextArea
            rows={2}
            value={form.address}
            onChange={set("address")}
            maxLength={500}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          onClick={() => save.mutate()}
          disabled={save.isPending}
        >
          Save billing details
        </Button>
        {save.error && (
          <FormMessage message={{ text: save.error.message, kind: "err" }} />
        )}
      </div>
    </Card>
  )
}

const PAYMENT_STATUS: Record<string, string> = {
  paid: "Paid",
  failed: "Failed",
  created: "Not paid",
  refund_due: "Refund due (replaced by a later change)",
}

function Invoices({ slug, data }: { slug: string; data: Billing }) {
  // Orders replaced before they were paid are nothing to anyone; one paid anyway is a refund.
  const shown = data.payments.filter((p) => p.status !== "abandoned")
  return (
    <Card data-testid="invoices" className="grid gap-3">
      <h2 className="text-title-sm text-ink">Payments and invoices</h2>
      {shown.length === 0 ? (
        <p>No payments yet.</p>
      ) : (
        <Table headers={["Date", "For", "Amount", "Status", "Invoice"]}>
          {shown.map((p) => (
            <tr key={p.id}>
              <td className="text-body">
                {formatDateTime(p.paidAt ?? p.createdAt)}
              </td>
              <td className="text-body">
                {p.kind === "upgrade"
                  ? "Addition"
                  : p.kind === "renew"
                    ? "Renewal"
                    : "New plan"}
              </td>
              <td className="text-ink tabular-nums">{rupees(p.total)}</td>
              <td className="text-body">
                {PAYMENT_STATUS[p.status] ?? "Not paid"}
              </td>
              <td className="text-body">
                {p.invoiceNumber ? (
                  <a
                    href={`/api/v1/orgs/${slug}/billing/invoices/${p.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary underline"
                  >
                    {p.invoiceNumber}
                  </a>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  )
}

/** What the plan's limits mean right now, in words. */
function LimitNote({ limits }: { limits: NonNullable<Billing["limits"]> }) {
  const states = [limits.students, limits.staff]
  const grace = limits.graceEnds ? formatDate(limits.graceEnds) : null
  const text = states.includes("paused")
    ? "Adding people is paused: more are in use than the plan has, and the 30 days' grace are over. Add more below; everything else keeps working."
    : states.includes("over")
      ? `More are in use than the plan has. Adding people works until ${grace}; add more below before then.`
      : states.includes("near")
        ? "Nearly full: 90% of the plan's students or staff are in use."
        : null
  if (!text) return null
  return (
    <p
      className="rounded-lg bg-chart-4/15 px-3 py-2 text-body-sm text-ink ring-1 ring-chart-4/40"
      data-testid="limit-note"
    >
      {text}
    </p>
  )
}

type Checkout =
  | { scheduled: true; from: string }
  | {
      scheduled: false
      orderId: string
      amount: number
      currency: string
      keyId: string
      name: string
      description: string
      prefill: { name: string; email: string }
      total: number
    }

interface RazorpayAnswer {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}
type RazorpayCheckout = new (options: Record<string, unknown>) => {
  open(): void
  on(event: string, f: (e: { error?: { description?: string } }) => void): void
}

/** Razorpay's checkout script, loaded once, when someone pays. */
function loadRazorpay(): Promise<RazorpayCheckout> {
  const w = window as unknown as { Razorpay?: RazorpayCheckout }
  if (w.Razorpay) return Promise.resolve(w.Razorpay)
  return new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = "https://checkout.razorpay.com/v1/checkout.js"
    script.onload = () =>
      w.Razorpay
        ? resolve(w.Razorpay)
        : reject(new Error("Razorpay didn't load."))
    script.onerror = () =>
      reject(
        new Error(
          "Razorpay's checkout couldn't load. Check the connection and try again."
        )
      )
    document.body.appendChild(script)
  })
}

/**
 * Pays for the plan built above: the server prices it and makes an order, Razorpay's checkout
 * takes the payment (UPI, cards, net banking), and the answer is confirmed on the server. A
 * smaller plan mid-period isn't paid for: it's kept for the next period.
 */
/**
 * What paying for the plan built above would do: renew it (within the week before the period
 * ends), switch to it, or nothing (it's the plan in force, mid-period).
 */
function payMode(data: Billing, choice: PlanChoice): "pay" | "renew" | "same" {
  const plan = data.plan
  if (!plan?.features || !plan.periodEnd || plan.status !== "active")
    return "pay"
  const left = new Date(plan.periodEnd).getTime() - Date.now()
  if (left <= 0) return "pay"
  const current: PlanChoice = {
    features: plan.features,
    students: plan.students,
    staff: plan.staff,
    judges: plan.judges,
    storagePacks: plan.storagePacks,
    period: plan.period,
  }
  if (left <= RENEW_WINDOW_DAYS * 86_400_000) return "renew"
  return samePlan(data.catalogue.list, current, choice) ? "same" : "pay"
}

function PayButton({
  slug,
  choice,
  coupon,
  onCoupon,
  mode,
  onDone,
}: {
  slug: string
  choice: PlanChoice
  /** A referral code or coupon, worked out on the server. */
  coupon: string
  onCoupon: (code: string) => void
  mode: "pay" | "renew" | "same"
  onDone: () => void
}) {
  const [message, setMessage] = useState<{
    text: string
    kind: "ok" | "err"
  } | null>(null)
  const pay = useMutation({
    mutationFn: async () => {
      const order = await api<Checkout>(`/orgs/${slug}/billing/checkout`, {
        body: { ...choice, coupon: coupon.trim() || undefined },
      })
      if (order.scheduled)
        return `Your new plan starts on ${formatDate(order.from)}. Nothing to pay now.`
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
          theme: { color: "#f54e00" },
          handler: (answer: RazorpayAnswer) => {
            api<{ paid: boolean; replaced: boolean }>(
              `/orgs/${slug}/billing/confirm`,
              {
                body: {
                  orderId: answer.razorpay_order_id,
                  paymentId: answer.razorpay_payment_id,
                  signature: answer.razorpay_signature,
                },
              }
            )
              .then((result) =>
                result.replaced
                  ? reject(
                      new Error(
                        "That payment was for a change you replaced in another tab. It wasn't applied, and GretLab will refund it."
                      )
                    )
                  : resolve(
                      `Paid ${rupees(order.total)}. Your plan is updated.`
                    )
              )
              .catch(reject)
          },
          modal: {
            ondismiss: () =>
              reject(new Error("Payment closed: nothing was charged.")),
          },
        })
        checkout.on("payment.failed", (e) =>
          reject(
            new Error(
              e.error?.description ??
                "The payment didn't go through. Nothing was charged."
            )
          )
        )
        checkout.open()
      })
    },
    onMutate: () => setMessage(null),
    onSuccess: (text) => {
      setMessage({ text, kind: "ok" })
      onDone()
    },
    onError: (e) => setMessage({ text: e.message, kind: "err" }),
    meta: { quiet: true },
  })
  return (
    <div className="grid gap-2">
      <TextInput
        aria-label="Referral code or coupon"
        placeholder="Have a code?"
        value={coupon}
        onChange={(e) => onCoupon(e.target.value.toUpperCase())}
        className="font-mono"
      />
      <Button
        onClick={() => pay.mutate()}
        disabled={pay.isPending || mode === "same"}
        data-testid="pay"
        className="w-full"
      >
        {pay.isPending
          ? "Opening the payment…"
          : mode === "renew"
            ? "Pay for the next period"
            : "Pay and switch"}
      </Button>
      <span className="text-caption text-body">
        UPI, cards or net banking, through Razorpay.
      </span>
      {message && <FormMessage message={message} />}
    </div>
  )
}
