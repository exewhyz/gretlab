/*
 * Rules for the Library module (apps/web/features/library): loan periods, how many books a
 * person may hold, availability and when a loan is overdue. Days are "YYYY-MM-DD" in the
 * site's time zone (`addDays` is course.ts's). Pure, so they're unit-tested here.
 */

export interface LibrarySettings {
  /** Days a loan lasts unless the issuer picks another due date. */
  loanDays: number
  /** Books one person may hold at once. */
  maxLoans: number
}

export const DEFAULT_LIBRARY: LibrarySettings = { loanDays: 14, maxLoans: 3 }

const within = (value: unknown, min: number, max: number, fallback: number) =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= max
    ? (value as number)
    : fallback

/** The library's settings from `organizations.module_settings`, with defaults. */
export function readLibrarySettings(moduleSettings: unknown): LibrarySettings {
  const raw = (moduleSettings as { library?: Record<string, unknown> } | null)?.library
  return {
    loanDays: within(raw?.loanDays, 1, 365, DEFAULT_LIBRARY.loanDays),
    maxLoans: within(raw?.maxLoans, 1, 50, DEFAULT_LIBRARY.maxLoans),
  }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
export const isDay = (value: string) => DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))

export type LoanStatus = "out" | "overdue" | "returned" | "lost"

/** Where a loan stands today. */
export function loanStatus(loan: { status: string; dueOn: string }, today: string): LoanStatus {
  if (loan.status === "returned" || loan.status === "lost") return loan.status
  return loan.dueOn < today ? "overdue" : "out"
}

/** Copies on the shelf. */
export const available = (copies: number, out: number) => Math.max(0, copies - out)

/** Why this person can't borrow this book now, or null if they can. */
export function cannotBorrow(input: {
  holding: number
  maxLoans: number
  copiesFree: number
  alreadyHasIt: boolean
}): "limit" | "unavailable" | "has_it" | null {
  if (input.alreadyHasIt) return "has_it"
  if (input.copiesFree <= 0) return "unavailable"
  if (input.holding >= input.maxLoans) return "limit"
  return null
}
