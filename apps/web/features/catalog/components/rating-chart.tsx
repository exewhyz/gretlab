"use client"

import { useState } from "react"

import { formatDate } from "@/lib/format"

type Point = {
  title: string
  endsAt: string | Date
  after: number
  rank: number
}

/**
 * A person's contest rating over their rated contests, oldest to newest: one line, so its title
 * names it; a marker per contest with its details on hover. The history table beside it is the
 * same data as a table.
 */
export function RatingChart({ points }: { points: Point[] }) {
  const [hover, setHover] = useState<number | null>(null)
  if (points.length < 2) return null
  const W = 640
  const H = 180
  const pad = { left: 44, right: 16, top: 14, bottom: 14 }
  const values = points.map((p) => p.after)
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = Math.max(hi - lo, 50)
  const top = hi + span * 0.1
  const bottom = lo - span * 0.1
  const x = (i: number) =>
    pad.left + (i * (W - pad.left - pad.right)) / (points.length - 1)
  const y = (v: number) =>
    pad.top + ((top - v) * (H - pad.top - pad.bottom)) / (top - bottom)
  const path = points
    .map(
      (p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.after).toFixed(1)}`
    )
    .join(" ")
  const shown = hover === null ? null : points[hover]!
  return (
    <figure className="relative" data-testid="rating-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Rating over ${points.length} rated contests, from ${points[0]!.after} to ${points.at(-1)!.after}`}
      >
        {[hi, lo].map((v) => (
          <g key={v}>
            <line
              x1={pad.left}
              x2={W - pad.right}
              y1={y(v)}
              y2={y(v)}
              stroke="var(--hairline)"
              strokeDasharray="3 4"
            />
            <text
              x={pad.left - 8}
              y={y(v) + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--muted-foreground)"
            >
              {v}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="var(--chart-1)" strokeWidth="2" />
        {points.map((p, i) => (
          <g key={i}>
            <circle
              cx={x(i)}
              cy={y(p.after)}
              r={hover === i ? 5 : 4}
              fill="var(--chart-1)"
              stroke="var(--card)"
              strokeWidth="2"
            />
            {/* A bigger target than the mark, so it's easy to hover or tap. */}
            <circle
              cx={x(i)}
              cy={y(p.after)}
              r={14}
              fill="transparent"
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onClick={() => setHover(i)}
            />
          </g>
        ))}
      </svg>
      {shown && (
        <div
          role="tooltip"
          className="pointer-events-none absolute top-1 right-2 rounded-md bg-popover px-2.5 py-1.5 text-caption text-ink shadow-sm ring-1 ring-foreground/10"
        >
          <div className="font-medium">{shown.title}</div>
          <div className="text-body tabular-nums">
            {shown.after} · rank {shown.rank} · {formatDate(shown.endsAt)}
          </div>
        </div>
      )}
    </figure>
  )
}
