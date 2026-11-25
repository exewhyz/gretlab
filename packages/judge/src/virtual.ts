/**
 * Virtual contests (the owner's decisions, 25 November 2026): after a contest ends, anyone who
 * could have entered it may take it once on their own clock, for the same length, unless they
 * took part live. Their board shows the real contestants as they stood at the same minute of the
 * original, freeze included, with the taker's own work shifted onto that clock. Virtual work never
 * reaches the official board.
 */
import {
  computeLeaderboard,
  type LeaderboardConfig,
  type LeaderboardRow,
  type LeaderboardSubmission,
  type Participant,
} from "./leaderboard.ts"

export type VirtualRefusal =
  "contest_not_over" | "took_part_live" | "already_taken"

/** Why someone may not start a virtual attempt now, or null. */
export function virtualRefusal(input: {
  contest: Pick<LeaderboardConfig, "endsAt">
  now: Date
  /** Made a submission or answered a question during the live contest. */
  tookPartLive: boolean
  alreadyTaken: boolean
}): VirtualRefusal | null {
  if (input.now < input.contest.endsAt) return "contest_not_over"
  if (input.tookPartLive) return "took_part_live"
  if (input.alreadyTaken) return "already_taken"
  return null
}

const lengthOf = (contest: Pick<LeaderboardConfig, "startsAt" | "endsAt">) =>
  contest.endsAt.getTime() - contest.startsAt.getTime()

/** Where an attempt started at `startedAt` stands: running, how far in, and when it ends. */
export function virtualPhase(
  contest: Pick<LeaderboardConfig, "startsAt" | "endsAt">,
  startedAt: Date,
  now: Date
) {
  const length = lengthOf(contest)
  const elapsedMs = Math.min(
    Math.max(0, now.getTime() - startedAt.getTime()),
    length
  )
  return {
    running: elapsedMs < length,
    elapsedMs,
    endsAt: new Date(startedAt.getTime() + length),
  }
}

/**
 * The taker's board: the real contestants' work up to the same minute of the original contest,
 * and the taker's own, moved onto the original clock. Frozen as the live board was while the
 * attempt runs; the full board once it's over.
 */
export function virtualBoard<U>(input: {
  config: LeaderboardConfig
  participants: Participant<U>[]
  submissions: LeaderboardSubmission[]
  taker: Participant<U>
  takerSubmissions: LeaderboardSubmission[]
  startedAt: Date
  now: Date
}): LeaderboardRow<U>[] {
  const { config, startedAt } = input
  const phase = virtualPhase(config, startedAt, input.now)
  const moment = config.startsAt.getTime() + phase.elapsedMs
  const shift = config.startsAt.getTime() - startedAt.getTime()
  const real = input.submissions.filter(
    (s) => s.userId !== input.taker.id && s.createdAt.getTime() < moment
  )
  const own = input.takerSubmissions
    .map((s) => ({
      ...s,
      userId: input.taker.id,
      createdAt: new Date(s.createdAt.getTime() + shift),
    }))
    .filter((s) => s.createdAt.getTime() < moment)
  return computeLeaderboard(
    config,
    [...input.participants.filter((p) => p.id !== input.taker.id), input.taker],
    [...real, ...own],
    phase.running
  )
}
