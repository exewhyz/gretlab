"use client"

import type { ReactNode } from "react"

import {
  gstSplit,
  priceOfPlan,
  samePlan,
  splitChange,
  upgradeDue,
  withNeeds,
  type BillingPeriod,
  type PlanChoice,
  type PriceList,
} from "@workspace/judge"

import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { cn } from "@workspace/ui/lib/utils"

import { Field, SelectInput, TextInput } from "@/components/form"
import { formatDate } from "@/lib/format"

/*
 * The plan builder (Manage › Plan and billing, Dashboard › Plans): ready-made plans, counts,
 * the period, every feature with its price, and the price as it changes. It works the price out
 * with the same function the server charges by (packages/judge/src/billing.ts).
 */

export interface Catalogue {
  list: PriceList
  features: {
    key: string
    name: string
    what: string
    group: string
    price: number
    always: boolean
    needs: string[]
    /** False when the organization's kind can't use it (it isn't sold to it). */
    available?: boolean
  }[]
  presets: {
    key: string
    name: string
    features: string[]
    students: number
    staff: number
  }[]
}

export const PERIOD_LABEL: Record<BillingPeriod, string> = {
  month: "Monthly",
  semester: "Every semester (6 months)",
  year: "Yearly",
}
const PER: Record<BillingPeriod, string> = {
  month: "a month",
  semester: "a semester",
  year: "a year",
}

/** "Not for a college", "Not for an …"; plain "Not available" without a kind or for Other. */
function notFor(kind?: string) {
  const k = kind?.toLowerCase()
  if (!k || k === "other") return "Not available"
  return `Not for ${/^[aeiou]/.test(k) ? "an" : "a"} ${k}`
}

export const rupees = (n: number) =>
  (n < 0 ? "−₹" : "₹") + Math.abs(Math.round(n)).toLocaleString("en-IN")

export function PlanBuilder({
  catalogue,
  value,
  onChange,
  gst,
  buyerGstin,
  current,
  kindLabel,
  footer,
}: {
  catalogue: Catalogue
  value: PlanChoice
  onChange: (next: PlanChoice) => void
  /** How invoices are taxed; absent: prices shown before GST only. */
  gst?: { registered: boolean; rate: number; sellerState: string }
  buyerGstin?: string
  /** The plan in force, to show what a change costs now (the days left in its period). */
  current?: {
    choice: PlanChoice
    periodStart: string | null
    periodEnd: string | null
  } | null
  /** The organization's kind ("College"), to say what isn't for it. */
  kindLabel?: string
  /** Under the price: the pay button and its note. */
  footer?: ReactNode
}) {
  const list = catalogue.list
  const chosen = new Set(withNeeds(list, value.features))
  const p = priceOfPlan(list, value)
  const tax =
    gst &&
    gstSplit(
      p.price,
      // Only the state (the first two characters) decides CGST and SGST or IGST.
      {
        registered: gst.registered,
        rate: gst.rate,
        sellerGstin: gst.sellerState,
      },
      buyerGstin || null
    )
  const live =
    current?.periodStart &&
    current.periodEnd &&
    new Date(current.periodEnd) > new Date()
  const unchanged = Boolean(
    live && current && samePlan(list, current.choice, value)
  )
  const dueNow =
    live && current && current.choice.period === value.period
      ? upgradeDue(
          list,
          current.choice,
          value,
          new Date(current.periodStart!),
          new Date(current.periodEnd!),
          new Date()
        )
      : null
  // Mid-period, what the change adds applies now and what it removes waits for renewal.
  const split =
    live && current && current.choice.period === value.period && !unchanged
      ? splitChange(list, current.choice, value)
      : null
  const nameOf = (k: string) =>
    catalogue.features.find((f) => f.key === k)?.name ?? k
  const changes = split
    ? (() => {
        const before = new Set(withNeeds(list, current!.choice.features))
        const after = new Set(withNeeds(list, value.features))
        const now: string[] = []
        const later: string[] = []
        for (const k of split.now.features)
          if (!before.has(k)) now.push(nameOf(k))
        for (const k of before) if (!after.has(k)) later.push(nameOf(k))
        const counts: [keyof PlanChoice, string][] = [
          ["students", "Students"],
          ["staff", "Staff"],
          ["judges", "Own judge machines"],
          ["storagePacks", "Storage packs"],
        ]
        const nowCounts: string[] = []
        const laterCounts: string[] = []
        for (const [key, label] of counts) {
          const a = current!.choice[key] as number
          const b = value[key] as number
          const line = `${label}: ${a.toLocaleString("en-IN")} → ${b.toLocaleString("en-IN")}`
          if (b > a) nowCounts.push(line)
          if (b < a) laterCounts.push(line)
        }
        return {
          now: [...nowCounts, ...now.map((n) => `Add ${n}`)],
          later: [...laterCounts, ...later.map((n) => `Remove ${n}`)],
        }
      })()
    : null
  const groups = [...new Set(catalogue.features.map((f) => f.group))]
  const set = (patch: Partial<PlanChoice>) => onChange({ ...value, ...patch })
  const toggle = (key: string, on: boolean) => {
    const next = new Set(value.features)
    if (on) next.add(key)
    else {
      next.delete(key)
      // Whatever needed it goes too.
      for (const f of catalogue.features)
        if (f.needs.includes(key)) next.delete(f.key)
    }
    set({ features: [...next] })
  }
  const count = (
    key: "students" | "staff" | "judges" | "storagePacks",
    label: string,
    help?: string
  ) => (
    <Field label={label} help={help}>
      <TextInput
        type="number"
        min={0}
        inputMode="numeric"
        value={String(value[key])}
        onChange={(e) =>
          set({ [key]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
        }
      />
    </Field>
  )

  return (
    <div
      className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]"
      data-testid="plan-builder"
    >
      <div className="grid min-w-0 content-start gap-4">
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="Start from a plan"
        >
          <span className="text-caption text-muted-foreground">Start from</span>
          {catalogue.presets.map((preset) => (
            <Button
              key={preset.key}
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                onChange({
                  ...value,
                  features: preset.features,
                  students: preset.students,
                  staff: preset.staff,
                })
              }
            >
              {preset.name}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          {count("students", "Students")}
          {count("staff", "Staff", `${p.freeStaff} free`)}
          {count("judges", "Own judge machines")}
          {count("storagePacks", "Extra storage", "50 GB packs")}
          <Field label="Pay">
            <SelectInput
              value={value.period}
              onChange={(e) => set({ period: e.target.value as BillingPeriod })}
            >
              {(["year", "semester", "month"] as const).map((period) => (
                <option key={period} value={period}>
                  {PERIOD_LABEL[period]}
                  {list.periods[period] ? ` (+${list.periods[period]}%)` : ""}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
        <div className="grid gap-4">
          {groups.map((group) => (
            <fieldset
              key={group}
              className="grid overflow-hidden rounded-lg bg-card ring-1 ring-foreground/10"
            >
              <legend className="sr-only">{group}</legend>
              <div
                aria-hidden
                className="border-b border-hairline bg-muted/50 px-3 py-2 text-caption font-semibold text-ink"
              >
                {group}
              </div>
              {catalogue.features
                .filter((f) => f.group === group)
                .map((f) => {
                  const unusable = f.available === false
                  return (
                    <label
                      key={f.key}
                      className={cn(
                        "flex items-start gap-3 border-b border-hairline px-3 py-2.5 last:border-0",
                        !unusable &&
                          !f.always &&
                          "cursor-pointer hover:bg-muted/40",
                        unusable && "bg-muted/30"
                      )}
                      data-testid={`feature-${f.key}`}
                    >
                      <Checkbox
                        aria-label={f.name}
                        checked={!unusable && chosen.has(f.key)}
                        disabled={f.always || unusable}
                        onCheckedChange={(on) => toggle(f.key, Boolean(on))}
                        className="mt-0.5"
                      />
                      <span className="grid min-w-0 flex-1 gap-0.5">
                        <span
                          className={cn(
                            "text-body-sm",
                            unusable ? "text-muted-foreground" : "text-ink"
                          )}
                        >
                          {f.name}
                          {f.always && (
                            <span className="ml-2 text-caption text-muted-foreground">
                              Always included
                            </span>
                          )}
                        </span>
                        <span className="text-caption text-body">
                          {f.what}
                          {f.needs.length > 0 &&
                            ` · needs ${f.needs.map(nameOf).join(", ")}`}
                        </span>
                      </span>
                      {unusable ? (
                        <Badge variant="outline" className="shrink-0">
                          {notFor(kindLabel)}
                        </Badge>
                      ) : (
                        <span className="shrink-0 text-caption whitespace-nowrap text-ink tabular-nums">
                          {rupees(f.price)}
                          <span className="text-muted-foreground">
                            {" "}
                            / student
                          </span>
                        </span>
                      )}
                    </label>
                  )
                })}
            </fieldset>
          ))}
        </div>
      </div>
      <aside
        className="grid content-start gap-2 self-start rounded-xl bg-card p-4 ring-1 ring-foreground/10 lg:sticky lg:top-20"
        aria-live="polite"
        data-testid="plan-price"
      >
        <h3 className="text-title-sm text-ink">Price</h3>
        {p.quote ? (
          <>
            <span className="text-display-sm text-ink">Talk to us</span>
            <span className="text-caption text-body">
              Over {list.quoteAbove.toLocaleString("en-IN")} students: a price
              made for you.
            </span>
          </>
        ) : (
          <>
            <span
              className="text-display-sm text-ink tabular-nums"
              data-testid="plan-total"
            >
              {rupees(p.price)}
            </span>
            <span className="text-caption text-body">
              {PER[value.period]}, before GST ·{" "}
              {value.students > 0
                ? `${rupees(p.price / value.students)} a student`
                : "no students"}
            </span>
            <dl className="mt-2 grid gap-1 text-caption">
              <Line
                label={`${chosen.size} features × ${value.students.toLocaleString("en-IN")} students`}
                value={rupees(value.students * p.perStudent)}
              />
              {p.discount > 0 && (
                <Line
                  label="Volume steps"
                  value={`− ${rupees(p.discount)}`}
                  good
                />
              )}
              <Line
                label={`Staff: ${p.freeStaff} free, ${p.paidStaff} more`}
                value={rupees(p.staffPart)}
              />
              {p.extras > 0 && (
                <Line label="Judges and storage" value={rupees(p.extras)} />
              )}
              <Line label="A year" value={rupees(p.yearly)} />
              {tax && tax.total !== tax.taxable && (
                <Line
                  label={
                    tax.igst
                      ? `IGST ${gst!.rate}%`
                      : `CGST + SGST ${gst!.rate}%`
                  }
                  value={rupees(tax.total - tax.taxable)}
                />
              )}
              {tax && (
                <Line label="With GST" value={rupees(tax.total)} strong />
              )}
            </dl>
            {dueNow !== null && (
              <div
                className="mt-2 grid gap-2 border-t border-hairline pt-3 text-caption"
                data-testid="plan-due-now"
              >
                <h3 className="text-title-sm text-ink">What changes</h3>
                {unchanged ? (
                  <p className="text-body">This is your plan now.</p>
                ) : (
                  <>
                    {changes && changes.now.length > 0 && (
                      <div className="grid gap-1">
                        <span className="font-medium text-ink">Now</span>
                        <ul className="grid gap-0.5 text-body">
                          {changes.now.map((c) => (
                            <li key={c}>{c}</li>
                          ))}
                        </ul>
                        <span className="text-ink tabular-nums">
                          {dueNow > 0
                            ? `Due now for the rest of this period: ${rupees(dueNow)} before GST.`
                            : "Nothing to pay now."}
                        </span>
                      </div>
                    )}
                    {changes && changes.later.length > 0 && (
                      <div className="grid gap-1">
                        <span className="font-medium text-ink">
                          At renewal
                          {current?.periodEnd &&
                            `, ${formatDate(current.periodEnd)}`}
                        </span>
                        <ul className="grid gap-0.5 text-body">
                          {changes.later.map((c) => (
                            <li key={c}>{c}</li>
                          ))}
                        </ul>
                        {changes.now.length === 0 && (
                          <span className="text-body">
                            Nothing due now: a smaller plan starts at your next
                            period. Nothing is refunded.
                          </span>
                        )}
                      </div>
                    )}
                    {!changes && (
                      <p className="text-body">
                        The way you pay changes at renewal.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
        {footer && (
          <div className="mt-2 grid gap-2 border-t border-hairline pt-3">
            {footer}
          </div>
        )}
      </aside>
    </div>
  )
}

function Line({
  label,
  value,
  good,
  strong,
}: {
  label: string
  value: string
  good?: boolean
  strong?: boolean
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-body">{label}</dt>
      <dd
        className={cn(
          "tabular-nums",
          good ? "text-success" : "text-ink",
          strong && "font-semibold"
        )}
      >
        {value}
      </dd>
    </div>
  )
}
