"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import Link from "next/link"
import { useState } from "react"

import { ORG_STANDINGS } from "@workspace/judge"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { Switch } from "@workspace/ui/components/switch"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs"

import { EditorSheet } from "@/components/editor-sheet"
import { Field, FormMessage, SelectInput, TextInput } from "@/components/form"
import {
  Card,
  Loading,
  PageTitle,
  Stats,
  Table,
} from "@/features/admin/components/shell"
import { rupees } from "@/features/billing/components/plan-builder"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { formatDate } from "@/lib/format"
import { orgPages } from "@/lib/paths"

import type { adminReferrals } from "@/features/referrals/server"
import { STAGE_LABEL } from "./refer-and-earn"

type Data = ApiResult<typeof adminReferrals>
type Code = Data["codes"][number]

type Standing = (typeof ORG_STANDINGS)[number]

/** Where an organization stands, for "who can use it" (packages/judge/src/referrals.ts). */
const STANDING: Record<Standing, string> = {
  new: "New",
  existing: "Existing",
  inactive: "Inactive",
}
const STANDING_HELP: Record<Standing, string> = {
  new: "Has never paid.",
  existing: "Has paid, and its plan is active.",
  inactive: "Has paid before; its plan is now past due or paused.",
}

const KIND_LABEL: Record<string, string> = {
  personal: "Personal link",
  creator: "Creator link",
  campaign: "Campaign coupon",
}

/**
 * Dashboard › Referrals: what's owed to referrers and marking it paid (paid by hand), the
 * creator links and campaign coupons, every referred organization, and the rules.
 */
export function ReferralsAdmin() {
  const { data, error } = useQuery({
    queryKey: ["admin", "referrals"],
    queryFn: () => api<Data>("/admin/referrals"),
  })
  if (!data) return <Loading error={error} />
  return (
    <div className="mx-auto grid w-full max-w-6xl min-w-0 gap-5">
      <PageTitle>Referrals</PageTitle>
      <Stats
        items={[
          { label: "Owed to referrers", value: rupees(data.owed) },
          { label: "Paid out", value: rupees(data.paid) },
          { label: "Organizations referred", value: data.referrals.length },
          {
            label: "Codes in use",
            value: data.codes.filter((c) => c.active).length,
          },
        ]}
      />
      <Tabs defaultValue="earnings">
        <TabsList>
          <TabsTrigger value="earnings">Earnings</TabsTrigger>
          <TabsTrigger value="codes">Links and coupons</TabsTrigger>
          <TabsTrigger value="referrals">Referred organizations</TabsTrigger>
          <TabsTrigger value="rules">Rules</TabsTrigger>
        </TabsList>
        <TabsContent value="earnings" className="pt-4">
          <Earnings data={data} />
        </TabsContent>
        <TabsContent value="codes" className="pt-4">
          <Codes data={data} />
        </TabsContent>
        <TabsContent value="referrals" className="pt-4">
          <Referred data={data} />
        </TabsContent>
        <TabsContent value="rules" className="pt-4">
          <Rules data={data} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Earnings({ data }: { data: Data }) {
  const client = useQueryClient()
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [note, setNote] = useState("")
  const settle = useMutation({
    mutationFn: (status: "paid" | "void") =>
      api("/admin/referrals/payouts", {
        body: { ids: [...chosen], status, note },
      }),
    onSuccess: () => {
      setChosen(new Set())
      setNote("")
      void client.invalidateQueries({ queryKey: ["admin", "referrals"] })
    },
    meta: { success: "Earnings updated." },
  })
  const owed = data.earnings.filter((e) => e.status === "owed")
  const chosenTotal = data.earnings
    .filter((e) => chosen.has(e.id))
    .reduce((n, e) => n + e.amount, 0)
  if (data.earnings.length === 0)
    return (
      <p className="text-body-sm text-body">
        Nothing earned yet. Earnings appear when a referred organization pays.
      </p>
    )
  return (
    <div className="grid gap-3">
      {owed.length > 0 && (
        <Card
          className="flex flex-wrap items-end gap-3"
          data-testid="payout-bar"
        >
          <p className="min-w-0 flex-1 text-body-sm text-body">
            {chosen.size
              ? `${chosen.size} chosen: ${rupees(chosenTotal)}. Pay them by UPI or bank, then mark them paid.`
              : "Tick what you've paid out, then mark it paid."}
          </p>
          <Field label="Payout note (optional)">
            <TextInput
              value={note}
              placeholder="UPI reference"
              onChange={(e) => setNote(e.target.value)}
              className="w-56"
            />
          </Field>
          <Button
            variant="outline"
            disabled={chosen.size === 0 || settle.isPending}
            onClick={() => settle.mutate("void")}
          >
            Mark cancelled
          </Button>
          <Button
            disabled={chosen.size === 0 || settle.isPending}
            onClick={() => settle.mutate("paid")}
          >
            Mark paid
          </Button>
        </Card>
      )}
      <Table
        headers={[
          "",
          "Date",
          "Referrer",
          "From",
          "Code",
          "Payment",
          "Earned",
          "Status",
        ]}
      >
        {data.earnings.map((e) => (
          <tr key={e.id}>
            <td>
              {e.status === "owed" && (
                <Checkbox
                  aria-label={`Choose ${rupees(e.amount)} for ${e.referrerName ?? e.referrer ?? "the referrer"}`}
                  checked={chosen.has(e.id)}
                  onCheckedChange={(on) => {
                    const next = new Set(chosen)
                    if (on) next.add(e.id)
                    else next.delete(e.id)
                    setChosen(next)
                  }}
                />
              )}
            </td>
            <td className="text-body tabular-nums">
              {formatDate(e.createdAt)}
            </td>
            <td className="text-ink">
              {e.referrerName ?? "—"}
              <span className="block text-caption text-muted-foreground">
                {e.referrer ?? "account removed"}
              </span>
            </td>
            <td className="text-body">{e.org}</td>
            <td className="font-mono text-caption text-body">{e.code}</td>
            <td className="text-right text-body tabular-nums">
              {rupees(e.payment)}
            </td>
            <td className="text-right text-ink tabular-nums">
              {rupees(e.amount)}{" "}
              <span className="text-caption text-muted-foreground">
                {e.percent}%
              </span>
            </td>
            <td>
              <Badge variant={e.status === "paid" ? "secondary" : "outline"}>
                {e.status === "owed"
                  ? "Owed"
                  : e.status === "paid"
                    ? "Paid"
                    : "Cancelled"}
              </Badge>
              {e.paidAt && (
                <span className="block text-caption text-muted-foreground">
                  {formatDate(e.paidAt)}
                  {e.payoutNote && ` · ${e.payoutNote}`}
                </span>
              )}
            </td>
          </tr>
        ))}
      </Table>
    </div>
  )
}

function Codes({ data }: { data: Data }) {
  const [editing, setEditing] = useState<Code | "new" | null>(null)
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-body-sm text-body">
          Creator links earn their creator; campaign coupons give a discount and
          earn nobody. Everyone also has their own link under Account › Refer
          and earn.
        </p>
        <Button variant="outline" onClick={() => setEditing("new")}>
          New link or coupon
        </Button>
      </div>
      <Table
        headers={["Code", "Kind", "Earns", "Discount", "Valid", "Used", "", ""]}
      >
        {data.codes.map((c) => (
          <tr key={c.code} className={c.active ? undefined : "opacity-60"}>
            <td className="font-mono text-ink">{c.code}</td>
            <td className="text-body">
              {KIND_LABEL[c.kind]}
              {c.owner && (
                <span className="block text-caption text-muted-foreground">
                  {c.ownerName ?? c.owner}
                </span>
              )}
            </td>
            <td className="text-body tabular-nums">
              {c.kind === "campaign"
                ? "—"
                : `${c.percent ?? data.settings.percent}% · ${c.months ?? data.settings.months} mo`}
            </td>
            <td className="text-body tabular-nums">
              {c.discountPercent ? `${c.discountPercent}%` : "—"}
              <span className="block text-caption text-muted-foreground">
                {c.forOrgs.length
                  ? `For ${c.forOrgs.map((s) => STANDING[s].toLowerCase()).join(", ")}`
                  : "For everyone"}
                {c.combines && " · combines"}
              </span>
            </td>
            <td className="text-caption text-body">
              {c.validFrom || c.validTo
                ? `${c.validFrom ? formatDate(c.validFrom) : "Now"} – ${c.validTo ? formatDate(c.validTo) : "open"}`
                : "Always"}
            </td>
            <td className="text-body tabular-nums">
              {c.uses}
              {c.maxUses !== null && ` of ${c.maxUses}`}
            </td>
            <td>{!c.active && <Badge variant="outline">Paused</Badge>}</td>
            <td>
              {c.kind !== "personal" && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Edit ${c.code}`}
                  onClick={() => setEditing(c)}
                >
                  Edit
                </Button>
              )}
            </td>
          </tr>
        ))}
      </Table>
      {editing && (
        <CodeSheet
          code={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "")
const startOf = (d: string) =>
  d ? new Date(`${d}T00:00:00`).toISOString() : null
const endOf = (d: string) =>
  d ? new Date(`${d}T23:59:59`).toISOString() : null
const intOr = (s: string) => (s.trim() === "" ? null : Number(s))

function CodeSheet({
  code,
  onClose,
}: {
  code: Code | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const [form, setForm] = useState({
    code: code?.code ?? "",
    kind: (code?.kind === "creator"
      ? "creator"
      : code
        ? "campaign"
        : "creator") as "creator" | "campaign",
    ownerEmail: code?.owner ?? "",
    percent: code?.percent != null ? String(code.percent) : "",
    months: code?.months != null ? String(code.months) : "",
    discountPercent: String(code?.discountPercent ?? 0),
    validFrom: day(code?.validFrom ?? null),
    validTo: day(code?.validTo ?? null),
    maxUses: code?.maxUses != null ? String(code.maxUses) : "",
    active: code?.active ?? true,
    note: code?.note ?? "",
    forOrgs: code?.forOrgs ?? ([] as Standing[]),
    combines: code?.combines ?? false,
  })
  const set = (patch: Partial<typeof form>) => setForm({ ...form, ...patch })
  const save = useMutation({
    mutationFn: () =>
      api("/admin/referrals/codes", {
        body: {
          code: form.code,
          kind: form.kind,
          ownerEmail: form.kind === "creator" ? form.ownerEmail : null,
          percent: form.kind === "creator" ? intOr(form.percent) : null,
          months: form.kind === "creator" ? intOr(form.months) : null,
          discountPercent: Number(form.discountPercent) || 0,
          validFrom: startOf(form.validFrom),
          validTo: endOf(form.validTo),
          maxUses: intOr(form.maxUses),
          active: form.active,
          note: form.note,
          forOrgs: form.forOrgs,
          combines: form.combines,
        },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["admin", "referrals"] })
      onClose()
    },
    meta: { success: "Saved.", quiet: true },
  })
  return (
    <EditorSheet
      testId="code-sheet"
      title={code ? `Edit ${code.code}` : "New link or coupon"}
      description="A creator link earns its creator a share of what the organizations it brings pay; a campaign coupon only gives a discount."
      submitLabel={code ? "Save" : "Make it"}
      submitDisabled={save.isPending || !form.code.trim()}
      error={save.error?.message}
      onClose={onClose}
      onSubmit={() => save.mutate()}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Code"
          help="Letters, digits and dashes. People type it or follow /r/CODE."
        >
          <TextInput
            value={form.code}
            disabled={Boolean(code)}
            className="font-mono"
            onChange={(e) => set({ code: e.target.value.toUpperCase() })}
          />
        </Field>
        <Field label="Kind">
          <SelectInput
            value={form.kind}
            disabled={Boolean(code)}
            onChange={(e) =>
              set({ kind: e.target.value as "creator" | "campaign" })
            }
          >
            <option value="creator">Creator link (earns its creator)</option>
            <option value="campaign">Campaign coupon (a discount only)</option>
          </SelectInput>
        </Field>
      </div>
      {form.kind === "creator" && (
        <fieldset className="grid gap-4 rounded-lg p-3 ring-1 ring-foreground/10 sm:grid-cols-3">
          <legend className="px-1 text-caption font-medium text-ink">
            The creator
          </legend>
          <Field label="Creator's email" help="They need an account.">
            <TextInput
              type="email"
              value={form.ownerEmail}
              onChange={(e) => set({ ownerEmail: e.target.value })}
            />
          </Field>
          <Field label="Their share (%)" help={`Empty: ${"the rule's"}.`}>
            <TextInput
              inputMode="numeric"
              value={form.percent}
              onChange={(e) => set({ percent: e.target.value })}
            />
          </Field>
          <Field label="For months" help="Empty: the rule's.">
            <TextInput
              inputMode="numeric"
              value={form.months}
              onChange={(e) => set({ months: e.target.value })}
            />
          </Field>
        </fieldset>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Discount for the organization (%)"
          help="0 for none. Within the same window."
        >
          <TextInput
            inputMode="numeric"
            value={form.discountPercent}
            onChange={(e) => set({ discountPercent: e.target.value })}
          />
        </Field>
        <Field label="Uses at most" help="Organizations; empty for no limit.">
          <TextInput
            inputMode="numeric"
            value={form.maxUses}
            onChange={(e) => set({ maxUses: e.target.value })}
          />
        </Field>
        <Field label="Valid from">
          <TextInput
            type="date"
            value={form.validFrom}
            onChange={(e) => set({ validFrom: e.target.value })}
          />
        </Field>
        <Field label="Valid until">
          <TextInput
            type="date"
            value={form.validTo}
            onChange={(e) => set({ validTo: e.target.value })}
          />
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-body-sm font-medium text-ink">
          Who can use it at checkout
        </legend>
        {ORG_STANDINGS.map((s) => (
          <label
            key={s}
            className="flex items-start gap-2 text-body-sm text-ink"
          >
            <Checkbox
              className="mt-0.5"
              checked={form.forOrgs.includes(s)}
              onCheckedChange={(on) =>
                set({
                  forOrgs: on
                    ? [...form.forOrgs, s]
                    : form.forOrgs.filter((x) => x !== s),
                })
              }
            />
            <span>
              {STANDING[s]}
              <span className="block text-caption text-body">
                {STANDING_HELP[s]}
              </span>
            </span>
          </label>
        ))}
        <span className="text-caption text-body">
          None ticked: every organization.
        </span>
      </fieldset>
      <label className="flex items-start gap-2 text-body-sm text-ink">
        <Switch
          className="mt-0.5"
          checked={form.combines}
          onCheckedChange={(on) => set({ combines: on })}
          aria-label="Combine with a referral discount"
        />
        <span>
          Combine with a referral discount
          <span className="block text-caption text-body">
            On: an organization that came through a referral link keeps that
            discount and gets this one too. Off: this code replaces it for that
            payment.
          </span>
        </span>
      </label>
      <Field label="Note (for staff)">
        <TextInput
          value={form.note}
          placeholder="Diwali campaign, or the creator's channel"
          onChange={(e) => set({ note: e.target.value })}
        />
      </Field>
      <label className="flex items-center gap-2 text-body-sm text-ink">
        <Switch
          checked={form.active}
          onCheckedChange={(on) => set({ active: on })}
          aria-label="Active"
        />
        Active
      </label>
    </EditorSheet>
  )
}

function Referred({ data }: { data: Data }) {
  if (data.referrals.length === 0)
    return (
      <p className="text-body-sm text-body">
        No organization has been referred yet.
      </p>
    )
  return (
    <Table
      headers={[
        "Organization",
        "Code",
        "Referrer",
        "Where it is",
        "Since",
        "First paid",
      ]}
    >
      {data.referrals.map((r) => (
        <tr key={r.orgId}>
          <td>
            <Link
              href={orgPages(r.slug).home}
              className="font-medium text-ink underline-offset-2 hover:underline"
            >
              {r.org}
            </Link>
          </td>
          <td className="font-mono text-caption text-body">{r.code}</td>
          <td className="text-body">{r.referrer ?? "A campaign"}</td>
          <td className="text-body">{STAGE_LABEL[r.stage]}</td>
          <td className="text-body tabular-nums">{formatDate(r.since)}</td>
          <td className="text-body tabular-nums">
            {r.firstPaidAt ? formatDate(r.firstPaidAt) : "—"}
          </td>
        </tr>
      ))}
    </Table>
  )
}

function Rules({ data }: { data: Data }) {
  const client = useQueryClient()
  const [form, setForm] = useState({
    enabled: data.settings.enabled,
    percent: String(data.settings.percent),
    months: String(data.settings.months),
  })
  const save = useMutation({
    mutationFn: () =>
      api("/admin/referrals/settings", {
        method: "PATCH",
        body: {
          "referral.enabled": form.enabled,
          "referral.percent": Number(form.percent),
          "referral.months": Number(form.months),
        },
      }),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["admin", "referrals"] }),
    meta: { success: "Referral rules saved.", quiet: true },
  })
  return (
    <Card className="grid max-w-2xl gap-4" data-testid="referral-rules">
      <label className="flex items-start gap-2 text-body-sm text-ink">
        <Switch
          checked={form.enabled}
          onCheckedChange={(on) => setForm({ ...form, enabled: on })}
          aria-label="Refer and earn"
        />
        <span>
          Refer and earn is on
          <span className="block text-caption text-body">
            Off: no new referrals, discounts or earnings. What&apos;s owed stays
            owed.
          </span>
        </span>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Referrer's share (%)"
          help="Of each payment before GST, unless a code sets its own."
        >
          <TextInput
            inputMode="numeric"
            value={form.percent}
            onChange={(e) => setForm({ ...form, percent: e.target.value })}
          />
        </Field>
        <Field
          label="For how many months"
          help="From the organization's first payment."
        >
          <TextInput
            inputMode="numeric"
            value={form.months}
            onChange={(e) => setForm({ ...form, months: e.target.value })}
          />
        </Field>
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          Save rules
        </Button>
        {save.error && (
          <FormMessage message={{ text: save.error.message, kind: "err" }} />
        )}
      </div>
    </Card>
  )
}
