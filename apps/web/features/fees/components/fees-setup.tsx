"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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
import { EditorSheet } from "@/components/editor-sheet"
import { Field, FormMessage, SelectInput, TextInput } from "@/components/form"
import { Card, Loading, Table } from "@/features/admin/components/shell"
import type { feeSetup } from "@/features/fees/server"
import { GroupChecklist } from "@/features/orgs/components/group-checklist"
import { useGroups } from "@/features/orgs/components/manage-shared"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { formatDay } from "@/lib/format"

type Setup = ApiResult<typeof feeSetup>
type Head = Setup["heads"][number]
type Plan = Setup["plans"][number]
type Instalment = Plan["instalments"][number]

const APPLIES: Record<Head["appliesTo"], string> = {
  everyone: "Everyone",
  hostel: "Hostel residents",
  transport: "Bus riders",
}

export const rupees = (n: number) => `₹${n.toLocaleString("en-IN")}`

export function useFeeSetup(slug: string) {
  return useQuery({
    queryKey: ["org", slug, "fees", "setup"],
    queryFn: () => api<Setup>(`/orgs/${slug}/fees/setup`),
  })
}

/** Fees › Setup: fee heads, each year's plans, and receipts and online payments. */
export function FeesSetup({ slug }: { slug: string }) {
  const { data, error } = useFeeSetup(slug)
  if (!data) return <Loading error={error} />
  return (
    // min-w-0: a grid item won't shrink below its table otherwise, and the page would scroll
    // sideways on a phone instead of the table in its own box.
    <div className="grid min-w-0 gap-6 [&>*]:min-w-0">
      <Heads slug={slug} data={data} />
      <Plans slug={slug} data={data} />
      {data.can.setup && <SettingsCard slug={slug} data={data} />}
    </div>
  )
}

/* ---------- heads ---------- */

function Heads({ slug, data }: { slug: string; data: Setup }) {
  const [editing, setEditing] = useState<Head | "new" | null>(null)
  const client = useQueryClient()
  const remove = useMutation({
    mutationFn: (id: string) =>
      api(`/orgs/${slug}/fees/heads/${id}`, { method: "DELETE" }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["org", slug, "fees"] }),
    meta: { success: "Removed." },
  })
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-title-sm text-ink">Fee heads</h2>
          <p className="text-caption text-body">
            What fees are for. Plans set each head&apos;s amount per instalment.
          </p>
        </div>
        {data.can.setup && (
          <Button variant="outline" onClick={() => setEditing("new")}>
            Add a fee head
          </Button>
        )}
      </div>
      {data.heads.length === 0 ? (
        <p className="text-body-sm text-body">
          No fee heads yet: add tuition, exam, hostel and so on.
        </p>
      ) : (
        <Table headers={["Fee head", "GST", "Charged to", ""]}>
          {data.heads.map((h) => (
            <tr key={h.id} data-testid="fee-head">
              <td className="text-ink">{h.name}</td>
              <td className="tabular-nums">
                {h.gstRate ? `${h.gstRate}% included` : "None"}
              </td>
              <td>{APPLIES[h.appliesTo]}</td>
              <td className="text-right">
                {data.can.setup && (
                  <span className="inline-flex gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Edit ${h.name}`}
                      onClick={() => setEditing(h)}
                    >
                      Edit
                    </Button>
                    <ConfirmButton
                      variant="ghost"
                      size="sm"
                      aria-label={`Remove ${h.name}`}
                      title={`Remove ${h.name}?`}
                      description="Only a head no plan uses can be removed."
                      confirmLabel="Remove"
                      onConfirm={() => remove.mutate(h.id)}
                    >
                      Remove
                    </ConfirmButton>
                  </span>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {editing && (
        <HeadDialog
          slug={slug}
          head={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  )
}

function HeadDialog({
  slug,
  head,
  onClose,
}: {
  slug: string
  head: Head | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const [form, setForm] = useState({
    name: head?.name ?? "",
    gstRate: String(head?.gstRate ?? 0),
    appliesTo: head?.appliesTo ?? ("everyone" as Head["appliesTo"]),
  })
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/fees/heads${head ? `/${head.id}` : ""}`, {
        method: head ? "PATCH" : "POST",
        body: {
          name: form.name,
          gstRate: Number(form.gstRate) || 0,
          appliesTo: form.appliesTo,
        },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["org", slug, "fees"] })
      onClose()
    },
    meta: { quiet: true },
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {head ? `Edit ${head.name}` : "Add a fee head"}
          </DialogTitle>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            save.mutate()
          }}
        >
          <Field label="Name">
            <TextInput
              autoFocus
              value={form.name}
              placeholder="Tuition"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field
            label="GST included (%)"
            help="0 for none. Coaching fees usually carry 18%; most college fees carry none."
          >
            <TextInput
              inputMode="numeric"
              value={form.gstRate}
              onChange={(e) => setForm({ ...form, gstRate: e.target.value })}
            />
          </Field>
          <Field label="Charged to">
            <SelectInput
              value={form.appliesTo}
              onChange={(e) =>
                setForm({
                  ...form,
                  appliesTo: e.target.value as Head["appliesTo"],
                })
              }
            >
              <option value="everyone">Everyone on the plan</option>
              <option value="hostel">Hostel residents only</option>
              <option value="transport">Bus riders only</option>
            </SelectInput>
          </Field>
          {save.error && (
            <FormMessage message={{ text: save.error.message, kind: "err" }} />
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={save.isPending || !form.name.trim()}
            >
              {head ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ---------- plans ---------- */

const planTotal = (instalments: Instalment[]) =>
  instalments.reduce((n, i) => n + i.lines.reduce((m, l) => m + l.amount, 0), 0)

function Plans({ slug, data }: { slug: string; data: Setup }) {
  const current = data.years.find((y) => y.isCurrent) ?? data.years.at(-1)
  const [yearId, setYearId] = useState(current?.id ?? "")
  const [editing, setEditing] = useState<Plan | "new" | null>(null)
  const plans = data.plans.filter((p) => p.yearId === yearId)
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-title-sm text-ink">Fee plans</h2>
          <p className="text-caption text-body">
            A year&apos;s fees for chosen classes, in instalments.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {data.years.length > 0 && (
            <SelectInput
              aria-label="Academic year"
              className="w-40"
              value={yearId}
              onChange={(e) => setYearId(e.target.value)}
            >
              {data.years.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </SelectInput>
          )}
          {data.can.setup && data.years.length > 0 && data.heads.length > 0 && (
            <Button variant="outline" onClick={() => setEditing("new")}>
              New fee plan
            </Button>
          )}
        </div>
      </div>
      {data.years.length === 0 ? (
        <p className="text-body-sm text-body">
          Add an academic year first (Academic years): plans belong to a year.
        </p>
      ) : plans.length === 0 ? (
        <p className="text-body-sm text-body">
          No fee plans for this year yet.
        </p>
      ) : (
        <Table headers={["Plan", "Instalments", "Total", "Payments", ""]}>
          {plans.map((p) => (
            <tr key={p.id} data-testid="fee-plan">
              <td className="text-ink">{p.name}</td>
              <td className="text-body-sm">
                {p.instalments
                  .map((i) => `${i.label} · ${formatDay(i.dueOn)}`)
                  .join(", ")}
              </td>
              <td className="tabular-nums">
                {rupees(planTotal(p.instalments))}
              </td>
              <td className="tabular-nums">{p.payments}</td>
              <td className="text-right">
                {data.can.setup && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Edit ${p.name}`}
                    onClick={() => setEditing(p)}
                  >
                    Edit
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
      {editing && (
        <PlanSheet
          slug={slug}
          data={data}
          yearId={yearId}
          plan={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </Card>
  )
}

interface DraftInstalment {
  id: string
  label: string
  dueOn: string
  amounts: Record<string, string>
  fine: string
  graceDays: string
}

const newId = () => Math.random().toString(36).slice(2, 10)

function PlanSheet({
  slug,
  data,
  yearId,
  plan,
  onClose,
}: {
  slug: string
  data: Setup
  yearId: string
  plan: Plan | null
  onClose: () => void
}) {
  const client = useQueryClient()
  const groups = useGroups(slug)
  const [name, setName] = useState(plan?.name ?? "")
  const [audience, setAudience] = useState<string[]>(plan?.audience ?? [])
  const [rows, setRows] = useState<DraftInstalment[]>(
    plan?.instalments.map((i) => ({
      id: i.id,
      label: i.label,
      dueOn: i.dueOn,
      amounts: Object.fromEntries(
        i.lines.map((l) => [l.headId, String(l.amount)])
      ),
      fine: i.fine ? String(i.fine.amount) : "",
      graceDays: i.fine ? String(i.fine.graceDays) : "",
    })) ?? [
      {
        id: newId(),
        label: "Term 1",
        dueOn: "",
        amounts: {},
        fine: "",
        graceDays: "",
      },
    ]
  )
  const set = (index: number, patch: Partial<DraftInstalment>) =>
    setRows(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  const instalments = rows.map((r) => ({
    id: r.id,
    label: r.label,
    dueOn: r.dueOn,
    lines: data.heads
      .filter((h) => (r.amounts[h.id] ?? "").trim() !== "")
      .map((h) => ({ headId: h.id, amount: Number(r.amounts[h.id]) })),
    fine: r.fine.trim()
      ? { amount: Number(r.fine) || 0, graceDays: Number(r.graceDays) || 0 }
      : null,
  }))
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/fees/plans${plan ? `/${plan.id}` : ""}`, {
        method: plan ? "PUT" : "POST",
        body: {
          yearId: plan?.yearId ?? yearId,
          name,
          audience,
          instalments,
          expectedUpdatedAt: plan?.updatedAt,
        },
      }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["org", slug, "fees"] })
      onClose()
    },
    meta: { quiet: true },
  })
  const remove = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/fees/plans/${plan!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["org", slug, "fees"] })
      onClose()
    },
    meta: { quiet: true },
  })
  return (
    <EditorSheet
      title={plan ? `Edit ${plan.name}` : "New fee plan"}
      description={`For ${data.years.find((y) => y.id === (plan?.yearId ?? yearId))?.name ?? "the year"}. Amounts are what a student pays, GST included where a head carries it.`}
      testId="fee-plan-sheet"
      width="48rem"
      submitLabel={plan ? "Save plan" : "Make plan"}
      submitDisabled={save.isPending || !name.trim() || audience.length === 0}
      error={save.error?.message ?? remove.error?.message ?? null}
      onSubmit={() => save.mutate()}
      onClose={onClose}
      extra={
        plan && plan.payments === 0 ? (
          <ConfirmButton
            variant="ghost"
            title={`Delete ${plan.name}?`}
            description="Nobody has paid on it yet. This can't be undone."
            confirmLabel="Delete plan"
            onConfirm={() => remove.mutate()}
          >
            Delete plan
          </ConfirmButton>
        ) : undefined
      }
    >
      <div className="grid gap-5">
        <Field label="Name">
          <TextInput
            value={name}
            placeholder="B.Tech 1st year"
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="grid gap-2">
          <span className="text-body-sm font-medium text-ink">Classes</span>
          {groups.data ? (
            <GroupChecklist
              groups={groups.data.groups}
              levels={groups.data.levels}
              value={audience}
              onChange={setAudience}
              size="sm"
            />
          ) : (
            <Loading error={groups.error} />
          )}
        </div>
        <div className="grid gap-3">
          <span className="text-body-sm font-medium text-ink">Instalments</span>
          {rows.map((r, index) => (
            <fieldset
              key={r.id}
              data-testid="fee-instalment"
              className="grid gap-3 rounded-md border border-hairline p-3"
            >
              <legend className="sr-only">
                {r.label || `Instalment ${index + 1}`}
              </legend>
              <div className="grid gap-3 sm:grid-cols-[1fr_11rem_auto]">
                <Field label="Instalment">
                  <TextInput
                    value={r.label}
                    onChange={(e) => set(index, { label: e.target.value })}
                  />
                </Field>
                <Field label="Due on">
                  <TextInput
                    type="date"
                    value={r.dueOn}
                    onChange={(e) => set(index, { dueOn: e.target.value })}
                  />
                </Field>
                {rows.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="self-end"
                    aria-label={`Remove ${r.label || "this instalment"}`}
                    onClick={() => setRows(rows.filter((_, i) => i !== index))}
                  >
                    Remove
                  </Button>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {data.heads.map((h) => (
                  <Field key={h.id} label={`${h.name} (₹)`}>
                    <TextInput
                      inputMode="numeric"
                      value={r.amounts[h.id] ?? ""}
                      placeholder="—"
                      onChange={(e) =>
                        set(index, {
                          amounts: { ...r.amounts, [h.id]: e.target.value },
                        })
                      }
                    />
                  </Field>
                ))}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="Late fine (₹)" help="Empty for none.">
                  <TextInput
                    inputMode="numeric"
                    value={r.fine}
                    onChange={(e) => set(index, { fine: e.target.value })}
                  />
                </Field>
                <Field label="Days of grace before the fine">
                  <TextInput
                    inputMode="numeric"
                    value={r.graceDays}
                    disabled={!r.fine.trim()}
                    onChange={(e) => set(index, { graceDays: e.target.value })}
                  />
                </Field>
              </div>
            </fieldset>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setRows([
                  ...rows,
                  {
                    id: newId(),
                    label: `Term ${rows.length + 1}`,
                    dueOn: "",
                    amounts: {},
                    fine: "",
                    graceDays: "",
                  },
                ])
              }
            >
              Add an instalment
            </Button>
            <span className="text-body-sm text-ink tabular-nums">
              Total {rupees(planTotal(instalments))}
            </span>
          </div>
        </div>
      </div>
    </EditorSheet>
  )
}

/* ---------- settings ---------- */

function SettingsCard({ slug, data }: { slug: string; data: Setup }) {
  const client = useQueryClient()
  const s = data.settings
  const [prefix, setPrefix] = useState(s.prefix)
  const [gstin, setGstin] = useState(s.gstin)
  const [keyId, setKeyId] = useState(s.razorpay?.keyId ?? "")
  const [keySecret, setKeySecret] = useState("")
  const [webhookSecret, setWebhookSecret] = useState("")
  const save = useMutation({
    mutationFn: () =>
      api(`/orgs/${slug}/fees/settings`, {
        method: "PUT",
        body: {
          prefix,
          gstin,
          razorpay: keyId.trim() ? { keyId, keySecret, webhookSecret } : null,
        },
      }),
    onSuccess: () => {
      setKeySecret("")
      setWebhookSecret("")
      void client.invalidateQueries({ queryKey: ["org", slug, "fees"] })
    },
    meta: { success: "Saved.", quiet: true },
  })
  return (
    <Card>
      <h2 className="text-title-sm text-ink">Receipts and online payments</h2>
      <p className="mb-4 text-caption text-body">
        Receipts are numbered per financial year, as {prefix || "PREFIX"}
        /2026-27/000001. Online payments go straight to your institution&apos;s
        own Razorpay account.
      </p>
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          save.mutate()
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Receipt prefix"
            help="1 to 10 letters, digits or dashes."
          >
            <TextInput
              value={prefix}
              placeholder="GPC"
              onChange={(e) => setPrefix(e.target.value.toUpperCase())}
            />
          </Field>
          <Field label="GSTIN" help="Optional: shown on receipts with GST.">
            <TextInput
              value={gstin}
              onChange={(e) => setGstin(e.target.value.toUpperCase())}
            />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Razorpay key ID" help="Empty: no online payments.">
            <TextInput
              value={keyId}
              placeholder="rzp_live_…"
              onChange={(e) => setKeyId(e.target.value.trim())}
            />
          </Field>
          <Field
            label="Key secret"
            help={s.razorpay ? "Saved. Leave empty to keep it." : undefined}
          >
            <TextInput
              type="password"
              autoComplete="off"
              value={keySecret}
              onChange={(e) => setKeySecret(e.target.value)}
            />
          </Field>
          <Field
            label="Webhook secret"
            help={s.razorpay ? "Saved. Leave empty to keep it." : undefined}
          >
            <TextInput
              type="password"
              autoComplete="off"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            variant="outline"
            disabled={save.isPending || !prefix}
          >
            Save
          </Button>
          {s.razorpay && (
            <Badge variant="secondary">Online payments set up</Badge>
          )}
          {save.error && (
            <FormMessage message={{ text: save.error.message, kind: "err" }} />
          )}
        </div>
      </form>
    </Card>
  )
}
