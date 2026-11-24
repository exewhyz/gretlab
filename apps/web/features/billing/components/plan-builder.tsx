"use client"

import {
  gstSplit,
  priceOfPlan,
  samePlan,
  upgradeDue,
  withNeeds,
  type BillingPeriod,
  type PlanChoice,
  type PriceList,
} from "@workspace/judge"

import { Button } from "@workspace/ui/components/button"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { cn } from "@workspace/ui/lib/utils"

import { Field, SelectInput, TextInput } from "@/components/form"

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

export const rupees = (n: number) =>
  (n < 0 ? "−₹" : "₹") + Math.abs(Math.round(n)).toLocaleString("en-IN")

export function PlanBuilder({
  catalogue,
  value,
  onChange,
  gst,
  buyerGstin,
  current,
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
          className="flex flex-wrap gap-2"
          role="group"
          aria-label="Start from a plan"
        >
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {count("students", "Students")}
          {count("staff", "Staff", `${p.freeStaff} free`)}
          {count("judges", "Own judge machines")}
          {count("storagePacks", "Extra storage", "50 GB packs")}
        </div>
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
        <div className="grid gap-4">
          {groups.map((group) => (
            <fieldset key={group} className="grid gap-1">
              <legend className="mb-1 text-caption font-semibold tracking-wide text-muted-foreground uppercase">
                {group}
              </legend>
              {catalogue.features
                .filter((f) => f.group === group)
                .map((f) => (
                  <label
                    key={f.key}
                    className={cn(
                      "flex items-start gap-3 border-b border-hairline py-2 last:border-0",
                      f.always && "opacity-80"
                    )}
                    data-testid={`feature-${f.key}`}
                  >
                    <Checkbox
                      aria-label={f.name}
                      checked={chosen.has(f.key)}
                      disabled={f.always}
                      onCheckedChange={(on) => toggle(f.key, Boolean(on))}
                      className="mt-0.5"
                    />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="text-body-sm text-ink">{f.name}</span>
                      <span className="text-xs text-body">
                        {f.what}
                        {f.needs.length > 0 &&
                          ` · needs ${f.needs.map((n) => catalogue.features.find((x) => x.key === n)?.name ?? n).join(", ")}`}
                      </span>
                    </span>
                    <span className="text-xs whitespace-nowrap text-ink tabular-nums">
                      {rupees(f.price)} / student
                    </span>
                  </label>
                ))}
            </fieldset>
          ))}
        </div>
      </div>
      <aside
        className="grid content-start gap-2 self-start rounded-xl bg-card p-4 ring-1 ring-foreground/10 lg:sticky lg:top-20"
        aria-live="polite"
        data-testid="plan-price"
      >
        <span className="text-caption font-semibold tracking-wide text-muted-foreground uppercase">
          Your plan
        </span>
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
              <p
                className="mt-2 border-t border-hairline pt-2 text-caption text-body"
                data-testid="plan-due-now"
              >
                {unchanged
                  ? "This is your plan now."
                  : dueNow > 0
                    ? `Due now for the rest of this period: ${rupees(dueNow)} before GST.`
                    : "Nothing due now: a smaller plan starts at your next period."}
              </p>
            )}
          </>
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
