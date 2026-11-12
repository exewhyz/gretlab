/** "12 Nov 2026" from "2026-11-12", the same everywhere (no locale on the server). */
export function printedDay(day: string | null | undefined) {
  if (!day) return "–"
  const [y, m, d] = day.split("-").map(Number) as [number, number, number]
  const month = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ][m - 1]
  return `${d} ${month} ${y}`
}
