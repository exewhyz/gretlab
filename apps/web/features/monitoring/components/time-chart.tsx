"use client"

import { useState } from "react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  XAxis,
  YAxis,
} from "recharts"

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@workspace/ui/components/chart"
import { Button } from "@workspace/ui/components/button"

import { DetailSheet } from "@/components/detail-sheet"
import { Stats, Table } from "@/features/admin/components/shell"

/*
 * One chart of one signal over time, the same way everywhere on Dashboard › Monitoring
 * (the dataviz rules: one y-axis; thin 2px lines and round-ended bars; a recessive grid; a
 * tooltip on hover; a legend only for two series, which share the one hue and differ by dash;
 * status colours only for status, each with a label; a table view for every chart).
 */

export type Point = { t: string } & Record<string, number | string | null>

export interface Series {
  key: string
  label: string
  /** A token: orange for the measure, or a status colour for errors and failures. */
  color: "primary" | "destructive"
  dashed?: boolean
}

export interface Threshold {
  y: number
  label: string
  tone: "warning" | "critical"
}

const COLOR = {
  primary: "var(--primary)",
  destructive: "var(--destructive)",
} as const
const TONE = {
  warning: "var(--chart-4)",
  critical: "var(--destructive)",
} as const

/** Axis and tooltip times: hours and minutes within a day, the date beyond it. */
export function timeLabel(iso: string, long: boolean) {
  const at = new Date(iso)
  return long
    ? at.toLocaleDateString(undefined, { day: "numeric", month: "short" }) +
        " " +
        at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
}

export function TimeChart({
  title,
  hint,
  data,
  series,
  kind,
  unit = "",
  thresholds = [],
  long,
  testId,
}: {
  title: string
  /** What it shows and in what unit, in one line. */
  hint: string
  data: Point[]
  series: Series[]
  kind: "area" | "line" | "bar"
  unit?: string
  thresholds?: Threshold[]
  /** A range of days: label times with the date. */
  long: boolean
  testId?: string
}) {
  const config = Object.fromEntries(
    series.map((s) => [s.key, { label: s.label, color: COLOR[s.color] }])
  ) satisfies ChartConfig
  const empty = !data.some((p) =>
    series.some((s) => Number(p[s.key] ?? 0) !== 0)
  )
  const format = (value: unknown) =>
    value === null || value === undefined
      ? "–"
      : `${Math.round(Number(value) * 10) / 10}${unit}`
  const axis = (
    <>
      <CartesianGrid vertical={false} strokeOpacity={0.6} />
      <XAxis
        dataKey="t"
        tickLine={false}
        axisLine={false}
        minTickGap={48}
        tickMargin={8}
        tickFormatter={(t: string) => timeLabel(t, false)}
      />
      <YAxis
        tickLine={false}
        axisLine={false}
        width={44}
        allowDecimals={false}
        tickFormatter={(v: number) => `${v}${unit}`}
      />
      <ChartTooltip
        cursor={kind === "bar" ? { fillOpacity: 0.06 } : { strokeOpacity: 0.3 }}
        content={
          <ChartTooltipContent
            labelFormatter={(_, payload) =>
              timeLabel(String(payload?.[0]?.payload?.t ?? ""), long)
            }
            formatter={(value, name) => (
              <span className="flex w-full justify-between gap-3">
                <span className="text-muted-foreground">
                  {config[String(name)]?.label ?? String(name)}
                </span>
                <span className="font-medium text-ink tabular-nums">
                  {format(value)}
                </span>
              </span>
            )}
          />
        }
      />
      {thresholds.map((th) => (
        <ReferenceLine
          key={th.label}
          y={th.y}
          stroke={TONE[th.tone]}
          strokeDasharray="4 4"
          ifOverflow="extendDomain"
          label={{
            value: th.label,
            position: "insideTopRight",
            fill: "var(--muted-foreground)",
            fontSize: 11,
          }}
        />
      ))}
    </>
  )
  return (
    <section
      className="min-w-0 rounded-xl bg-card p-4 ring-1 ring-foreground/10"
      data-testid={testId}
    >
      <h3 className="text-title-sm text-ink">{title}</h3>
      <p className="mb-3 text-caption text-muted-foreground">{hint}</p>
      {series.length > 1 && (
        // Its own legend: the two lines share a hue, so each sample shows its dash.
        <ul className="mb-1 flex flex-wrap gap-x-4 gap-y-1">
          {series.map((s) => (
            <li
              key={s.key}
              className="flex items-center gap-1.5 text-caption text-body"
            >
              <svg width="22" height="8" aria-hidden>
                <line
                  x1="1"
                  y1="4"
                  x2="21"
                  y2="4"
                  stroke={COLOR[s.color]}
                  strokeWidth="2"
                  strokeDasharray={s.dashed ? "5 4" : undefined}
                />
              </svg>
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <div className="relative">
        {empty && (
          <p className="pointer-events-none absolute inset-0 grid place-items-center text-caption text-muted-foreground">
            None in this range
          </p>
        )}
        <ChartContainer config={config} className="aspect-auto h-48 w-full">
          {kind === "bar" ? (
            <BarChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
              {axis}
              {series.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  fill={`var(--color-${s.key})`}
                  radius={[4, 4, 0, 0]}
                  maxBarSize={18}
                />
              ))}
            </BarChart>
          ) : kind === "area" ? (
            <AreaChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
              {axis}
              {series.map((s) => (
                <Area
                  key={s.key}
                  dataKey={s.key}
                  type="monotone"
                  stroke={`var(--color-${s.key})`}
                  strokeWidth={2}
                  fill={`var(--color-${s.key})`}
                  fillOpacity={0.12}
                  dot={false}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          ) : (
            <LineChart data={data} margin={{ left: 0, right: 8, top: 8 }}>
              {axis}
              {series.map((s) => (
                <Line
                  key={s.key}
                  dataKey={s.key}
                  type="monotone"
                  stroke={`var(--color-${s.key})`}
                  strokeWidth={2}
                  strokeDasharray={s.dashed ? "5 4" : undefined}
                  dot={false}
                  activeDot={{ r: 4 }}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          )}
        </ChartContainer>
      </div>
      <TableView
        title={title}
        hint={hint}
        data={data}
        series={series}
        format={format}
      />
    </section>
  )
}

/**
 * The same numbers as a table, in a side sheet (DESIGN.md: what's behind an item opens in a
 * sheet, never pushed into the page): each line's peak, when, and average, then every time
 * with something in it, newest first, in the shared Table.
 */
function TableView({
  title,
  hint,
  data,
  series,
  format,
}: {
  title: string
  hint: string
  data: Point[]
  series: Series[]
  format: (value: unknown) => string
}) {
  const [open, setOpen] = useState(false)
  const rows = data
    .filter((p) => series.some((s) => Number(p[s.key] ?? 0) !== 0))
    .reverse()
  const summary = series.flatMap((s) => {
    const values = data
      .map((p) => ({ t: p.t, v: p[s.key] }))
      .filter((x): x is { t: string; v: number } => typeof x.v === "number")
    if (values.length === 0) return []
    const peak = values.reduce((a, b) => (b.v > a.v ? b : a))
    const average = values.reduce((n, x) => n + x.v, 0) / values.length
    const name = series.length > 1 ? `${s.label}: ` : ""
    return [
      {
        label: `${name}highest`,
        value: format(peak.v),
        hint: timeLabel(peak.t, true),
      },
      { label: `${name}average`, value: format(average) },
    ]
  })
  return (
    <>
      <Button
        variant="link"
        size="sm"
        className="mt-1 h-auto px-0 text-caption text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        View as table
      </Button>
      {open && (
        <DetailSheet
          title={title}
          description={`${hint}. Times with nothing are left out; newest first.`}
          onClose={() => setOpen(false)}
          width="40rem"
          testId="chart-table"
        >
          {summary.length > 0 && <Stats items={summary} />}
          {rows.length === 0 ? (
            <p className="mt-3 text-body-sm text-body">
              Nothing in this range.
            </p>
          ) : (
            <Table headers={["Time", ...series.map((s) => s.label)]}>
              {rows.map((p) => (
                <tr key={p.t}>
                  <td className="text-body">{timeLabel(p.t, true)}</td>
                  {series.map((s) => (
                    <td key={s.key} className="text-ink tabular-nums">
                      {format(p[s.key])}
                    </td>
                  ))}
                </tr>
              ))}
            </Table>
          )}
        </DetailSheet>
      )}
    </>
  )
}
