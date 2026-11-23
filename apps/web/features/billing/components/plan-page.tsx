"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import type { PlanChoice } from "@workspace/judge"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"

import { Field, FormMessage, TextArea, TextInput } from "@/components/form"
import {
  Card,
  Loading,
  PageTitle,
  PercentBar,
  Table,
} from "@/features/admin/components/shell"
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
  active: { label: "Paid", tone: "default" },
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
    <div className="mx-auto grid w-full max-w-6xl min-w-0 gap-4">
      <PageTitle>Plan and billing</PageTitle>
      {!data.enabled && (
        <p className="text-body-sm text-body" data-testid="billing-off">
          Billing isn&apos;t switched on yet: nothing is limited and nothing is
          charged.
        </p>
      )}
      <CurrentPlan data={data} />
      <ChangePlan data={data} />
      <BillingDetails slug={slug} data={data} />
      <Invoices data={data} />
    </div>
  )
}

function CurrentPlan({ data }: { data: Billing }) {
  const plan = data.plan
  const status = STATUS[plan?.status ?? "custom"] ?? STATUS.custom!
  const names = new Map(data.catalogue.features.map((f) => [f.key, f.name]))
  const limitless = !plan || plan.features === null
  const bar = (used: number, bought: number) =>
    bought > 0 ? Math.round((100 * used) / bought) : null
  return (
    <Card data-testid="current-plan" className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-title-sm text-ink">Your plan</h2>
        <Badge variant={status.tone}>{status.label}</Badge>
      </div>
      <p>
        {limitless
          ? "Every feature, with no limits (your plan from before billing, or one set by GretLab)."
          : (plan?.features ?? []).map((k) => names.get(k) ?? k).join(" · ")}
      </p>
      {plan && !limitless && (
        <p className="text-caption text-body">
          {PERIOD_LABEL[plan.period]} ·{" "}
          {plan.price ? `${rupees(plan.price)} before GST` : "no charge"}
          {plan.periodEnd && ` · renews ${formatDate(plan.periodEnd)}`}
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-1">
          <span className="text-caption text-body">
            Students: {data.usage.students.toLocaleString("en-IN")}
            {!limitless && ` of ${plan!.students.toLocaleString("en-IN")}`}
          </span>
          {!limitless && (
            <PercentBar
              value={bar(data.usage.students, plan!.students)}
              low={-1}
            />
          )}
        </div>
        <div className="grid gap-1">
          <span className="text-caption text-body">
            Staff: {data.usage.staff.toLocaleString("en-IN")}
            {!limitless && ` of ${plan!.staff.toLocaleString("en-IN")}`}
          </span>
          {!limitless && (
            <PercentBar value={bar(data.usage.staff, plan!.staff)} low={-1} />
          )}
        </div>
      </div>
    </Card>
  )
}

function ChangePlan({ data }: { data: Billing }) {
  const plan = data.plan
  const start = (): PlanChoice =>
    plan && plan.features
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
  return (
    <Card data-testid="change-plan" className="grid gap-4">
      <div>
        <h2 className="text-title-sm text-ink">Change your plan</h2>
        <p className="text-caption text-body">
          Choose features, students and staff, and see the price as you go.
          Adding mid-period costs only the days left; a smaller plan starts at
          your next period.
        </p>
      </div>
      <PlanBuilder
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
      <p className="text-body-sm text-body" data-testid="pay-note">
        {data.canPay
          ? "Paying online opens in the next step."
          : "Paying online isn't set up yet. To change your plan, contact GretLab with the plan above; we'll set it for you."}
      </p>
    </Card>
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
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          Save billing details
        </Button>
        {save.error && (
          <FormMessage message={{ text: save.error.message, kind: "err" }} />
        )}
      </div>
    </Card>
  )
}

function Invoices({ data }: { data: Billing }) {
  return (
    <Card data-testid="invoices" className="grid gap-3">
      <h2 className="text-title-sm text-ink">Payments and invoices</h2>
      {data.payments.length === 0 ? (
        <p>No payments yet.</p>
      ) : (
        <Table headers={["Date", "For", "Amount", "Status", "Invoice"]}>
          {data.payments.map((p) => (
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
                {p.status === "paid"
                  ? "Paid"
                  : p.status === "failed"
                    ? "Failed"
                    : "Not paid"}
              </td>
              <td className="text-body">{p.invoiceNumber ?? "—"}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  )
}
