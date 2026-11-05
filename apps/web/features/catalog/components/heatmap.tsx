const WEEKS = 53
const CELL = 11
const GAP = 3

function shade(count: number) {
  if (count === 0) return "var(--hairline)"
  if (count < 2) return "color-mix(in srgb, var(--success) 35%, var(--card))"
  if (count < 4) return "color-mix(in srgb, var(--success) 60%, var(--card))"
  if (count < 8) return "color-mix(in srgb, var(--success) 80%, var(--card))"
  return "var(--success)"
}

/** A year of graded submissions, a column per week, like a contribution calendar. */
export function Heatmap({
  counts,
  today,
}: {
  counts: Record<string, number>
  today: string
}) {
  const end = new Date(`${today}T12:00:00Z`)
  // Ends on today's weekday column, starting on a Sunday 53 weeks back.
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - (WEEKS - 1) * 7 - end.getUTCDay())
  const cells = []
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0)
  for (let week = 0; week < WEEKS; week++) {
    for (let day = 0; day < 7; day++) {
      const date = new Date(start)
      date.setUTCDate(start.getUTCDate() + week * 7 + day)
      if (date > end) continue
      const key = date.toISOString().slice(0, 10)
      const value = counts[key] ?? 0
      cells.push(
        <rect
          key={key}
          x={week * (CELL + GAP)}
          y={day * (CELL + GAP)}
          width={CELL}
          height={CELL}
          rx={2}
          fill={shade(value)}
        >
          <title>
            {value} submission{value === 1 ? "" : "s"} on {key}
          </title>
        </rect>
      )
    }
  }
  return (
    <figure className="m-0">
      <div className="overflow-x-auto">
        <svg
          role="img"
          aria-label={`${total} submissions in the past year`}
          width={WEEKS * (CELL + GAP)}
          height={7 * (CELL + GAP)}
        >
          {cells}
        </svg>
      </div>
      <figcaption className="mt-1 text-xs text-body">
        {total} submissions in the past year
      </figcaption>
    </figure>
  )
}
