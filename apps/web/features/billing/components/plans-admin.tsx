"use client"

import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useEffect, useState } from "react"

import type { BillingPeriod, PlanChoice } from "@workspace/judge"
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
import {
  Field,
  FormMessage,
  SelectInput,
  TextArea,
  TextInput,
} from "@/components/form"
import {
  Card,
  Loading,
  PageTitle,
  Pager,
  Table,
} from "@/features/admin/components/shell"
import { api } from "@/lib/api/client"
import type { ApiResult } from "@/lib/api/types"
import { formatDate } from "@/lib/format"
import { useDebounced } from "@/lib/use-debounced"
import type { allPlans } from "@/features/billing/server"

import { PlanBuilder, rupees } from "./plan-builder"
import { STATUS } from "./plan-page"

type Plans = ApiResult<typeof allPlans>
type Org = Plans["items"][number]

/** Dashboard › Plans: every organization's plan, setting one by hand, and the prices. */
export function PlansAdmin() {
  return (
    <div className="mx-auto grid w-full max-w-6xl min-w-0 gap-4">
      <PageTitle>Plans</PageTitle>
      <Tabs defaultValue="orgs">
        <TabsList>
          <TabsTrigger value="orgs">Organizations</TabsTrigger>
          <TabsTrigger value="prices">Prices</TabsTrigger>
        </TabsList>
        <TabsContent value="orgs" className="mt-4">
          <Organizations />
        </TabsContent>
        <TabsContent value="prices" className="mt-4">
          <Prices />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function Organizations() {
  const [q, setQ] = useState("")
  const [page, setPage] = useState(1)
  const search = useDebounced(q)
  const [editing, setEditing] = useState<Org | null>(null)
  const { data, error, isPlaceholderData } = useQuery({
    queryKey: ["admin", "plans", search, page],
    queryFn: () =>
      api<Plans>(
        `/admin/billing?${new URLSearchParams({ q: search, page: String(page) })}`
      ),
    placeholderData: keepPreviousData,
  })
  if (!data) return <Loading error={error} />
  return (
    <>
      <p className="mb-3 text-body-sm text-body" data-testid="billing-state">
        {data.enabled
          ? "Billing is on: new organizations start on the free plan, and organizations pay for their plans."
          : "Billing is off: nothing is limited or charged. Switch it on under Prices."}
      </p>
      <div className="mb-3 max-w-sm">
        <TextInput
          aria-label="Search organizations"
          placeholder="Search by name or address"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }}
        />
      </div>
      <Card className={isPlaceholderData ? "opacity-60" : undefined}>
        <Table
          headers={[
            "Organization",
            "Plan",
            "Students",
            "Staff",
            "Price",
            "Renews",
            "",
          ]}
        >
          {data.items.map((o) => {
            const status = STATUS[o.status] ?? STATUS.custom!
            return (
              <tr key={o.id} data-testid="plan-row">
                <td className="text-ink">
                  {o.name}
                  <div className="text-xs text-body">{o.slug}</div>
                </td>
                <td>
                  <Badge variant={status.tone}>{status.label}</Badge>
                  <div className="text-xs text-body">
                    {o.features ? `${o.features.length} features` : "No limits"}
                  </div>
                </td>
                <td className="tabular-nums">
                  {o.usage.students.toLocaleString("en-IN")}
                  {o.features && ` / ${o.students.toLocaleString("en-IN")}`}
                </td>
                <td className="tabular-nums">
                  {o.usage.staff}
                  {o.features && ` / ${o.staff}`}
                </td>
                <td className="tabular-nums">
                  {o.price ? rupees(o.price) : "—"}
                </td>
                <td>{o.periodEnd ? formatDate(o.periodEnd) : "—"}</td>
                <td>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing(o)}
                  >
                    Set plan
                  </Button>
                </td>
              </tr>
            )
          })}
        </Table>
        <Pager
          page={data.page}
          pages={data.pages}
          total={data.total}
          perPage={data.perPage}
          onPage={setPage}
        />
      </Card>
      {editing && (
        <SetPlan
          org={editing}
          catalogue={data.catalogue}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  )
}

function SetPlan({
  org,
  catalogue,
  onClose,
}: {
  org: Org
  catalogue: Plans["catalogue"]
  onClose: () => void
}) {
  const client = useQueryClient()
  const [limitless, setLimitless] = useState(org.features === null)
  const [choice, setChoice] = useState<PlanChoice>({
    features: org.features ?? catalogue.presets[0]?.features ?? [],
    students: Math.max(org.students, org.usage.students),
    staff: Math.max(org.staff, org.usage.staff),
    judges: org.judges,
    storagePacks: org.storagePacks,
    period: org.period as BillingPeriod,
  })
  const [status, setStatus] = useState(org.status)
  const [start, setStart] = useState(
    org.periodStart ? org.periodStart.slice(0, 10) : ""
  )
  const [end, setEnd] = useState(
    org.periodEnd ? org.periodEnd.slice(0, 10) : ""
  )
  const [discount, setDiscount] = useState(org.discountPercent)
  const [notes, setNotes] = useState(org.notes)
  const save = useMutation({
    mutationFn: () =>
      api(`/admin/billing/orgs/${org.id}`, {
        method: "PUT",
        body: {
          ...choice,
          features: limitless ? null : choice.features,
          status,
          periodStart: start ? new Date(start).toISOString() : null,
          periodEnd: end ? new Date(end).toISOString() : null,
          discountPercent: discount,
          notes,
        },
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["admin", "plans"] })
      onClose()
    },
    meta: { success: `Plan set for ${org.name}`, quiet: true },
  })
  return (
    <EditorSheet
      title={`Plan for ${org.name}`}
      description="For custom deals, pilots and payments taken outside GretLab. The organization sees it at once; it's in the activity log."
      submitLabel="Set plan"
      submitDisabled={save.isPending}
      onSubmit={() => save.mutate()}
      onClose={onClose}
      error={save.error?.message ?? null}
      width="64rem"
      testId="set-plan"
    >
      <div className="grid gap-4">
        <label className="flex items-center gap-2 text-body-sm text-ink">
          <Checkbox
            checked={limitless}
            onCheckedChange={(on) => setLimitless(Boolean(on))}
            aria-label="No limits"
          />
          No limits: every feature, any number of students (as before billing)
        </label>
        {!limitless && (
          <PlanBuilder
            catalogue={catalogue}
            value={choice}
            onChange={setChoice}
          />
        )}
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Status">
            <SelectInput
              value={status}
              onChange={(e) => setStatus(e.target.value as typeof status)}
            >
              {Object.entries(STATUS).map(([key, s]) => (
                <option key={key} value={key}>
                  {s.label}
                </option>
              ))}
            </SelectInput>
          </Field>
          <Field label="Period starts">
            <TextInput
              type="date"
              value={start}
              onChange={(e) => setStart(e.target.value)}
            />
          </Field>
          <Field label="Period ends">
            <TextInput
              type="date"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
            />
          </Field>
          <Field label="Discount %">
            <TextInput
              type="number"
              min={0}
              max={100}
              value={String(discount)}
              onChange={(e) =>
                setDiscount(
                  Math.min(
                    100,
                    Math.max(0, Math.floor(Number(e.target.value) || 0))
                  )
                )
              }
            />
          </Field>
        </div>
        <Field label="Notes" help="Only staff see these.">
          <TextArea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
          />
        </Field>
      </div>
    </EditorSheet>
  )
}

type Settings = Record<string, unknown>

function Prices() {
  const client = useQueryClient()
  const { data, error } = useQuery({
    queryKey: ["admin", "billing-settings"],
    queryFn: () => api<Settings>("/admin/billing/settings"),
  })
  // The features and their launch prices come with the organizations list.
  const { data: plans } = useQuery({
    queryKey: ["admin", "plans", "", 1],
    queryFn: () =>
      api<Plans>(`/admin/billing?${new URLSearchParams({ q: "", page: "1" })}`),
  })
  const [draft, setDraft] = useState<Settings>({})
  useEffect(() => {
    if (data) setDraft(data)
  }, [data])
  const save = useMutation({
    mutationFn: () =>
      api<Settings>("/admin/billing/settings", {
        method: "PATCH",
        body: draft,
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin"] }),
    meta: { success: "Prices saved", quiet: true },
  })
  if (!data) return <Loading error={error} />
  const num = (key: string) => Number(draft[key] ?? 0)
  const setNum = (key: string) => (e: { target: { value: string } }) =>
    setDraft({
      ...draft,
      [key]: Math.max(0, Math.floor(Number(e.target.value) || 0)),
    })
  const prices = (draft["billing.prices"] ?? {}) as Record<string, number>
  const steps = (draft["billing.steps"] ?? []) as [number | null, number][]
  const features = plans?.catalogue.features ?? []
  const numberField = (key: string, label: string, help?: string) => (
    <Field label={label} help={help}>
      <TextInput
        type="number"
        min={0}
        value={String(num(key))}
        onChange={setNum(key)}
      />
    </Field>
  )
  return (
    <div className="grid gap-4" data-testid="billing-prices">
      <Card className="grid gap-3">
        <label className="flex items-center justify-between gap-4">
          <span className="grid gap-0.5">
            <span className="text-body-sm text-ink">Billing</span>
            <span className="text-xs text-body">
              On: new organizations start on the free plan and pay for their
              plans. Organizations from before billing keep everything until you
              set their plan.
            </span>
          </span>
          <Switch
            aria-label="Billing"
            checked={Boolean(draft["billing.enabled"])}
            onCheckedChange={(on) =>
              setDraft({ ...draft, "billing.enabled": on })
            }
          />
        </label>
      </Card>
      <Card className="grid gap-3">
        <h2 className="text-title-sm text-ink">Feature prices</h2>
        <p className="text-caption text-body">
          Rupees per student per year. Organizations keep their price until
          their next period.
        </p>
        {features.length === 0 ? (
          <Loading />
        ) : (
          <Table headers={["Feature", "Group", "₹ per student a year"]}>
            {features.map((f) => (
              <tr key={f.key}>
                <td className="text-ink">{f.name}</td>
                <td className="text-body">{f.group}</td>
                <td>
                  <TextInput
                    type="number"
                    min={0}
                    aria-label={`Price of ${f.name}`}
                    className="w-28"
                    value={String(prices[f.key] ?? f.price)}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        "billing.prices": {
                          ...prices,
                          [f.key]: Math.max(
                            0,
                            Math.floor(Number(e.target.value) || 0)
                          ),
                        },
                      })
                    }
                  />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card className="grid gap-3">
        <h2 className="text-title-sm text-ink">Staff, extras and periods</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {numberField("billing.staff_price", "Staff price (₹ a year)")}
          {numberField(
            "billing.free_staff_per",
            "One free staff per … students"
          )}
          {numberField("billing.judge_price", "Own judge machine (₹ a year)")}
          {numberField("billing.storage_price", "50 GB of storage (₹ a year)")}
          {numberField("billing.semester_percent", "Semester surcharge %")}
          {numberField("billing.month_percent", "Monthly surcharge %")}
          {numberField("billing.quote_above", "Custom quote above … students")}
          {numberField("billing.free_students", "Free plan: students")}
          {numberField("billing.free_staff", "Free plan: staff")}
        </div>
      </Card>
      <Card className="grid gap-3">
        <h2 className="text-title-sm text-ink">Volume steps</h2>
        <p className="text-caption text-body">
          Percent off the student part past each number of students, like tax
          slabs. The last step covers the rest.
        </p>
        <div className="grid gap-2">
          {steps.map(([upTo, off], i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-2 text-body-sm"
            >
              <span>{i === steps.length - 1 ? "The rest" : "Up to"}</span>
              {i < steps.length - 1 && (
                <TextInput
                  type="number"
                  min={1}
                  aria-label={`Step ${i + 1}: up to`}
                  className="w-28"
                  value={String(upTo ?? "")}
                  onChange={(e) => {
                    const next = steps.map(
                      (s) => [...s] as [number | null, number]
                    )
                    next[i]![0] = Math.max(
                      1,
                      Math.floor(Number(e.target.value) || 1)
                    )
                    setDraft({ ...draft, "billing.steps": next })
                  }}
                />
              )}
              <span>students:</span>
              <TextInput
                type="number"
                min={0}
                max={90}
                aria-label={`Step ${i + 1}: percent off`}
                className="w-20"
                value={String(off)}
                onChange={(e) => {
                  const next = steps.map(
                    (s) => [...s] as [number | null, number]
                  )
                  next[i]![1] = Math.min(
                    90,
                    Math.max(0, Math.floor(Number(e.target.value) || 0))
                  )
                  setDraft({ ...draft, "billing.steps": next })
                }}
              />
              <span>% off</span>
            </div>
          ))}
        </div>
      </Card>
      <Card className="grid gap-3">
        <h2 className="text-title-sm text-ink">GST</h2>
        <label className="flex items-center gap-2 text-body-sm text-ink">
          <Checkbox
            aria-label="Registered for GST"
            checked={Boolean(draft["billing.gst_registered"])}
            onCheckedChange={(on) =>
              setDraft({ ...draft, "billing.gst_registered": Boolean(on) })
            }
          />
          Registered for GST: invoices charge it
        </label>
        <div className="grid gap-3 sm:grid-cols-3">
          {numberField("billing.gst_rate", "GST rate %")}
          <Field label="Your GSTIN">
            <TextInput
              value={String(draft["billing.gstin"] ?? "")}
              maxLength={15}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  "billing.gstin": e.target.value.toUpperCase(),
                })
              }
            />
          </Field>
        </div>
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => save.mutate()} disabled={save.isPending}>
          Save prices
        </Button>
        {save.error && (
          <FormMessage message={{ text: save.error.message, kind: "err" }} />
        )}
      </div>
    </div>
  )
}
