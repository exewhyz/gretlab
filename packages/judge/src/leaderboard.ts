import type { Verdict } from "./verdicts.ts"

export type ContestScoring = "icpc" | "ioi"

export interface LeaderboardConfig {
  scoring: ContestScoring
  startsAt: Date
  endsAt: Date
  penaltyMinutes: number
  freezeMinutes: number
  problemLabels: string[]
}

export interface LeaderboardSubmission {
  userId: string
  problemLabel: string
  verdict: Verdict | null
  score: number | null
  createdAt: Date
}

export interface ProblemStanding {
  label: string
  solved: boolean
  /** Failed attempts before solving, or in total if unsolved. */
  attempts: number
  /** Minutes from the start to the first accepted submission. */
  solvedAtMinutes: number | null
  /** Best score, for IOI. */
  score: number
  /** Attempts made during the freeze, shown as pending without their result. */
  pending: number
}

export interface LeaderboardRow<U> {
  rank: number
  user: U
  solved: number
  /** ICPC: penalty minutes. IOI: 0. */
  penalty: number
  score: number
  problems: ProblemStanding[]
}

export interface Participant<U> {
  id: string
  user: U
}

/** Verdicts that say nothing about the solution, so they cost no penalty. */
const NOT_PENALIZED: (Verdict | null)[] = ["CE", "SE", null]

export function freezeTime(config: LeaderboardConfig): Date | null {
  if (config.freezeMinutes <= 0) return null
  return new Date(config.endsAt.getTime() - config.freezeMinutes * 60_000)
}

/**
 * Standard ICPC rules: more solved wins, then less penalty, where a problem's penalty
 * is minutes to solve plus a fixed cost per earlier wrong attempt. IOI: sum of the best
 * score on each problem. Equal rows share a rank.
 *
 * With `frozen`, results from the freeze onward are hidden and count as pending. Pass
 * false for staff, and for everyone once the contest is over and results are revealed.
 */
export function computeLeaderboard<U>(
  config: LeaderboardConfig,
  participants: Participant<U>[],
  submissions: LeaderboardSubmission[],
  frozen: boolean
): LeaderboardRow<U>[] {
  const cutoff = frozen ? freezeTime(config) : null
  // Grouped up front: scanning all submissions for every cell is far too slow for a big class.
  const byCell = new Map<string, LeaderboardSubmission[]>()
  for (const submission of submissions) {
    const key = `${submission.userId}\0${submission.problemLabel}`
    const cell = byCell.get(key)
    if (cell) cell.push(submission)
    else byCell.set(key, [submission])
  }
  for (const cell of byCell.values()) {
    cell.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  }

  const rows = participants.map(({ id, user }) => {
    const problems: ProblemStanding[] = config.problemLabels.map((label) => {
      const standing: ProblemStanding = {
        label,
        solved: false,
        attempts: 0,
        solvedAtMinutes: null,
        score: 0,
        pending: 0,
      }
      for (const submission of byCell.get(`${id}\0${label}`) ?? []) {
        if (cutoff && submission.createdAt >= cutoff) {
          standing.pending += 1
          continue
        }
        standing.score = Math.max(standing.score, submission.score ?? 0)
        if (standing.solved || NOT_PENALIZED.includes(submission.verdict)) {
          continue
        }
        if (submission.verdict === "AC") {
          standing.solved = true
          standing.solvedAtMinutes = Math.floor(
            (submission.createdAt.getTime() - config.startsAt.getTime()) /
              60_000
          )
        } else {
          standing.attempts += 1
        }
      }
      return standing
    })

    const solved = problems.filter((problem) => problem.solved)
    return {
      rank: 0,
      user,
      solved: solved.length,
      penalty:
        config.scoring === "icpc"
          ? solved.reduce(
              (sum, problem) =>
                sum +
                (problem.solvedAtMinutes ?? 0) +
                problem.attempts * config.penaltyMinutes,
              0
            )
          : 0,
      score: problems.reduce((sum, problem) => sum + problem.score, 0),
      problems,
    }
  })

  const compare = (a: LeaderboardRow<U>, b: LeaderboardRow<U>) =>
    config.scoring === "icpc"
      ? b.solved - a.solved || a.penalty - b.penalty
      : b.score - a.score

  rows.sort(compare)
  rows.forEach((row, index) => {
    const previous = rows[index - 1]
    row.rank =
      previous && compare(previous, row) === 0 ? previous.rank : index + 1
  })
  return rows
}
