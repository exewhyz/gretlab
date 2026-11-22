/*
 * The time ranges Dashboard › Monitoring offers, and the bucket each is drawn in: about 60–100
 * points a chart, whatever the range.
 */

export const MONITOR_RANGES = {
  "1h": { label: "1 hour", seconds: 3_600, step: 60 },
  "6h": { label: "6 hours", seconds: 6 * 3_600, step: 5 * 60 },
  "24h": { label: "24 hours", seconds: 24 * 3_600, step: 15 * 60 },
  "7d": { label: "7 days", seconds: 7 * 24 * 3_600, step: 2 * 3_600 },
} as const

export type MonitorRange = keyof typeof MONITOR_RANGES

export const isMonitorRange = (value: unknown): value is MonitorRange =>
  typeof value === "string" && value in MONITOR_RANGES
