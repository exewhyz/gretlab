/**
 * Contest code replay: for whoever runs a contest, how one contestant's code for one of its
 * problems was written while the contest ran (the draft snapshots saved as they typed,
 * features/drafts), beside their graded submissions, with the steps where a lot of new code
 * appeared at once (bigJumps, packages/judge/src/replay.ts). Anyone else, or someone who
 * didn't take part, is not found. Each replay is in the activity log.
 */
import {
  contestParticipants,
  draftSnapshots,
  getDb,
  sql,
  submissions,
  users,
  type User,
} from "@workspace/db"
import { bigJumps, joinStarter } from "@workspace/judge"
import { z } from "zod"

import { writeEntry } from "@/features/audit/server"
import { contestProblemRows, findContest } from "@/features/contests/server"
import { notFound } from "@/lib/api/route"

const { and, asc, eq, gte, lte } = sql

/** At most this many snapshots: about three hours of steady typing. */
const MAX_SNAPSHOTS = 2000

export const replayQuery = z.object({
  user: z.uuid(),
  problem: z.string().min(1).max(10),
})

export async function contestReplay(
  slug: string,
  viewer: User,
  input: z.infer<typeof replayQuery>
) {
  const { contest, access } = await findContest(slug, viewer)
  if (access !== "manage") throw notFound("Contest not found")
  const row = (await contestProblemRows(contest.id)).find(
    (r) => r.link.label === input.problem
  )
  if (!row) throw notFound("That problem isn't in this contest")
  const db = getDb()
  const [person] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(contestParticipants)
    .innerJoin(users, eq(contestParticipants.userId, users.id))
    .where(
      and(
        eq(contestParticipants.contestId, contest.id),
        eq(contestParticipants.userId, input.user)
      )
    )
  if (!person) throw notFound("They didn't take part in this contest")
  const problemId = row.problem.id
  const [attempts, history] = await Promise.all([
    db
      .select({
        id: submissions.id,
        language: submissions.language,
        files: submissions.files,
        verdict: submissions.verdict,
        score: submissions.score,
        maxScore: submissions.maxScore,
        passedTests: submissions.passedTests,
        totalTests: submissions.totalTests,
        createdAt: submissions.createdAt,
      })
      .from(submissions)
      .where(
        and(
          eq(submissions.contestId, contest.id),
          eq(submissions.userId, person.id),
          eq(submissions.problemId, problemId),
          eq(submissions.kind, "submit"),
          eq(submissions.status, "done")
        )
      )
      .orderBy(asc(submissions.createdAt)),
    // Only what was written while it ran: practice on the same problem before or after isn't
    // the contest's to see.
    db
      .select({
        language: draftSnapshots.language,
        files: draftSnapshots.files,
        at: draftSnapshots.at,
      })
      .from(draftSnapshots)
      .where(
        and(
          eq(draftSnapshots.userId, person.id),
          eq(draftSnapshots.problemId, problemId),
          gte(draftSnapshots.at, contest.startsAt),
          lte(draftSnapshots.at, contest.endsAt)
        )
      )
      .orderBy(asc(draftSnapshots.at))
      .limit(MAX_SNAPSHOTS),
  ])
  const starters = Object.fromEntries(
    Object.entries(row.problem.code).map(([language, parts]) => [
      language,
      joinStarter(parts),
    ])
  )
  await writeEntry(getDb(), {
    orgId: contest.orgId,
    actor: viewer,
    action: "contest.replay",
    summary: `Replayed ${person.name ?? person.email}'s code for ${row.link.label} in ${contest.title}`,
    detail: {
      contest: contest.id,
      problem: row.link.label,
      student: person.id,
    },
  })
  return {
    contest: {
      title: contest.title,
      startsAt: contest.startsAt,
      endsAt: contest.endsAt,
    },
    student: person,
    problem: { label: row.link.label, title: row.problem.title },
    attempts,
    history,
    jumps: bigJumps(history, starters),
  }
}
