/**
 * Time and memory limits per organization (the owner's decisions, 25 November 2026): an
 * organization sets each language's limits for its own work, raising or lowering the
 * platform's defaults but never past the platform's ceiling; a problem's own limit still wins.
 */

export type LanguageLimit = { timeLimitMs?: number; memoryLimitMb?: number }
/** An organization's limits, by language id. A language it hasn't set uses the platform's. */
export type OrgLimits = Record<string, LanguageLimit>
export type LimitCeiling = { timeMs: number; memoryMb: number }

/** The smallest limits anyone may set, as Dashboard › Languages allows. */
export const MIN_TIME_MS = 100
export const MIN_MEMORY_MB = 32

const whole = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : undefined

/** Stored limits as they are, keeping only whole, positive numbers. */
export function readOrgLimits(value: unknown): OrgLimits {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  const out: OrgLimits = {}
  for (const [language, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== "object") continue
    const limit: LanguageLimit = {}
    const time = whole((raw as LanguageLimit).timeLimitMs)
    const memory = whole((raw as LanguageLimit).memoryLimitMb)
    if (time) limit.timeLimitMs = time
    if (memory) limit.memoryLimitMb = memory
    if (time || memory) out[language] = limit
  }
  return out
}

/**
 * The limits a submission runs under: the problem's own, else the organization's for the
 * language (held under the ceiling, in case it was lowered after saving), else the platform's.
 */
export function submissionLimits(input: {
  problem: { timeLimitMs: number | null; memoryLimitMb: number | null } | null
  language: { id: string; timeLimitMs: number; memoryLimitMb: number }
  org: OrgLimits | null
  ceiling: LimitCeiling
}): { timeLimitMs: number; memoryLimitMb: number } {
  const { problem, language, org, ceiling } = input
  const own = org?.[language.id]
  const orgTime = own?.timeLimitMs && Math.min(own.timeLimitMs, ceiling.timeMs)
  const orgMemory =
    own?.memoryLimitMb && Math.min(own.memoryLimitMb, ceiling.memoryMb)
  return {
    timeLimitMs: problem?.timeLimitMs ?? orgTime ?? language.timeLimitMs,
    memoryLimitMb:
      problem?.memoryLimitMb ?? orgMemory ?? language.memoryLimitMb,
  }
}

/** Why an organization's limits can't be saved, in words, or null. */
export function orgLimitsProblem(
  limits: OrgLimits,
  languages: readonly string[],
  ceiling: LimitCeiling
): string | null {
  for (const [language, limit] of Object.entries(limits)) {
    if (!languages.includes(language))
      return `There's no language "${language}" here.`
    if (limit.timeLimitMs !== undefined) {
      if (limit.timeLimitMs < MIN_TIME_MS)
        return `A time limit must be at least ${MIN_TIME_MS} ms.`
      if (limit.timeLimitMs > ceiling.timeMs)
        return `A time limit can be at most ${ceiling.timeMs / 1000} s here.`
    }
    if (limit.memoryLimitMb !== undefined) {
      if (limit.memoryLimitMb < MIN_MEMORY_MB)
        return `A memory limit must be at least ${MIN_MEMORY_MB} MB.`
      if (limit.memoryLimitMb > ceiling.memoryMb)
        return `A memory limit can be at most ${ceiling.memoryMb} MB here.`
    }
  }
  return null
}
