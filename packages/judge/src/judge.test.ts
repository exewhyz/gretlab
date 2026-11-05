import assert from "node:assert/strict"
import { test } from "node:test"

import { isSafePath, sourceFilesSchema } from "./files.ts"
import { emailDomainAllowed, resolveSettings } from "./features.ts"
import {
  computeLeaderboard,
  type LeaderboardConfig,
  type LeaderboardSubmission,
} from "./leaderboard.ts"
import { outputsMatch } from "./output.ts"
import { nextPollMs, queueHeadStartMs } from "./queue.ts"
import { dayIn, earnedBadges, pickDaily, streaks } from "./activity.ts"
import { allows, allowsFor, ancestry, domainMatches, inAudience, SYSTEM_ROLES } from "./permissions.ts"
import { syllabusProgress } from "./teaching.ts"
import { gradeProblem, type GradePolicy } from "./grading.ts"
import { findSimilarPairs, fingerprint, similarity } from "./similarity.ts"
import { overallVerdict, verdictLabel } from "./verdicts.ts"

const start = new Date("2026-01-01T10:00:00Z")
const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000)
const config: LeaderboardConfig = {
  scoring: "icpc",
  startsAt: start,
  endsAt: at(120),
  penaltyMinutes: 20,
  freezeMinutes: 30,
  problemLabels: ["A", "B"],
}
const people = ["ana", "ben", "cy"].map((id) => ({ id, user: id }))
const sub = (
  userId: string,
  problemLabel: string,
  minute: number,
  verdict: LeaderboardSubmission["verdict"],
  score = 0
): LeaderboardSubmission => ({
  userId,
  problemLabel,
  verdict,
  score,
  createdAt: at(minute),
})

test("ICPC: solved count, then penalty with wrong attempts", () => {
  const rows = computeLeaderboard(
    config,
    people,
    [
      sub("ana", "A", 10, "WA"),
      sub("ana", "A", 20, "AC"),
      sub("ben", "A", 30, "AC"),
      sub("cy", "A", 5, "AC"),
      sub("cy", "B", 60, "AC"),
    ],
    false
  )
  assert.deepEqual(
    rows.map((row) => [row.user, row.rank, row.solved, row.penalty]),
    [
      ["cy", 1, 2, 65],
      ["ben", 2, 1, 30],
      ["ana", 3, 1, 40],
    ].sort((a, b) => Number(a[1]) - Number(b[1]))
  )
})

test("ICPC: compile and system errors cost nothing; attempts after solving are ignored", () => {
  const [row] = computeLeaderboard(
    config,
    people.slice(0, 1),
    [
      sub("ana", "A", 1, "CE"),
      sub("ana", "A", 2, "SE"),
      sub("ana", "A", 3, "AC"),
      sub("ana", "A", 4, "WA"),
    ],
    false
  )
  assert.equal(row?.penalty, 3)
  assert.equal(row?.problems[0]?.attempts, 0)
})

test("ICPC: wrong attempts on an unsolved problem add no penalty", () => {
  const [row] = computeLeaderboard(
    config,
    people.slice(0, 1),
    [sub("ana", "A", 1, "WA"), sub("ana", "B", 2, "AC")],
    false
  )
  assert.equal(row?.penalty, 2)
})

test("ties share a rank and the next rank skips", () => {
  const rows = computeLeaderboard(
    config,
    people,
    [sub("ana", "A", 10, "AC"), sub("ben", "A", 10, "AC")],
    false
  )
  assert.deepEqual(
    rows.map((row) => row.rank),
    [1, 1, 3]
  )
})

test("freeze hides results as pending, and staff still see them", () => {
  const submissions = [sub("ana", "A", 5, "AC"), sub("ben", "A", 100, "AC")]
  const frozen = computeLeaderboard(config, people, submissions, true)
  const ben = frozen.find((row) => row.user === "ben")
  assert.equal(ben?.solved, 0)
  assert.equal(ben?.problems[0]?.pending, 1)
  const open = computeLeaderboard(config, people, submissions, false)
  assert.equal(open.find((row) => row.user === "ben")?.solved, 1)
})

test("IOI: sums the best score on each problem", () => {
  const rows = computeLeaderboard(
    { ...config, scoring: "ioi" },
    people,
    [
      sub("ana", "A", 1, "WA", 30),
      sub("ana", "A", 2, "WA", 70),
      sub("ana", "A", 3, "WA", 10),
      sub("ben", "A", 1, "AC", 100),
      sub("ana", "B", 1, "WA", 40),
    ],
    false
  )
  assert.deepEqual(
    rows.map((row) => [row.user, row.score]),
    [
      ["ana", 110],
      ["ben", 100],
      ["cy", 0],
    ]
  )
})

test("leaderboard stays fast for a big class", () => {
  const big = Array.from({ length: 1000 }, (_, i) => ({
    id: `u${i}`,
    user: `u${i}`,
  }))
  const labels = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]
  const submissions = Array.from({ length: 50_000 }, (_, i) =>
    sub(`u${i % 1000}`, labels[i % 10] ?? "A", i % 120, i % 7 ? "WA" : "AC")
  )
  const started = performance.now()
  const rows = computeLeaderboard(
    { ...config, problemLabels: labels },
    big,
    submissions,
    false
  )
  const elapsed = performance.now() - started
  assert.equal(rows.length, 1000)
  assert.ok(elapsed < 500, `${elapsed} ms`)
})

test("queue: head starts rank contest work first, and polls back off", () => {
  assert.ok(
    queueHeadStartMs({ kind: "submit", inContest: true }) <
      queueHeadStartMs({ kind: "submit", inContest: false })
  )
  assert.ok(
    queueHeadStartMs({ kind: "submit", inContest: false }) <
      queueHeadStartMs({ kind: "run", inContest: false })
  )
  assert.ok(nextPollMs(0) < nextPollMs(100))
  assert.equal(nextPollMs(100000), 3000)
})

test("unsafe file names are rejected", () => {
  for (const path of [
    "../a.py",
    "/etc/passwd",
    "a/../b",
    "a b",
    "$(id)",
    ".env",
    "a;b",
    "a/",
    "",
    "a\nb",
    "x`y`",
    "é.py",
  ]) {
    assert.equal(isSafePath(path), false, path)
  }
  for (const path of ["main.py", "pkg/helper.py", "a_b-c.d", "Main.java"]) {
    assert.equal(isSafePath(path), true, path)
  }
})

test("file sets: duplicates and file/folder clashes are rejected", () => {
  const f = (path: string) => ({ path, content: "" })
  assert.equal(sourceFilesSchema.safeParse([f("a"), f("a")]).success, false)
  assert.equal(sourceFilesSchema.safeParse([f("a"), f("a/b")]).success, false)
  assert.equal(sourceFilesSchema.safeParse([]).success, false)
  assert.equal(sourceFilesSchema.safeParse([f("a"), f("b/c")]).success, true)
})

test("settings: invalid stored values fall back to defaults", () => {
  const settings = resolveSettings({
    "submissions.per_minute": "lots",
    "contests.enabled": false,
    "removed.setting": 1,
  })
  assert.equal(settings["submissions.per_minute"], 12)
  assert.equal(settings["contests.enabled"], false)
})

test("email domains", () => {
  assert.equal(emailDomainAllowed("a@x.edu", []), true)
  assert.equal(emailDomainAllowed("a@X.EDU", ["x.edu"]), true)
  assert.equal(emailDomainAllowed("a@evil.com", ["x.edu"]), false)
  assert.equal(emailDomainAllowed("a@x.edu.evil.com", ["x.edu"]), false)
})

test("only a graded submission is ever called Accepted", () => {
  assert.equal(verdictLabel("AC", "submit"), "Accepted")
  assert.notEqual(verdictLabel("AC", "run"), "Accepted")
  assert.equal(verdictLabel("OK", "run"), "Finished")
  assert.equal(verdictLabel("WA", "run"), "Wrong answer")
})

test("verdicts and output compare", () => {
  assert.equal(
    overallVerdict([{ verdict: "AC" }, { verdict: "WA" }, { verdict: "TLE" }]),
    "WA"
  )
  assert.equal(overallVerdict([{ verdict: "WA" }, { verdict: "SE" }]), "SE")
  assert.equal(overallVerdict([]), "AC")
  assert.equal(overallVerdict([{ verdict: "OK" }]), "OK")
  assert.equal(overallVerdict([{ verdict: "AC" }, { verdict: "OK" }]), "OK")
  assert.equal(overallVerdict([{ verdict: "OK" }, { verdict: "WA" }]), "WA")
  assert.equal(outputsMatch("a  \nb\n\n", "a\nb"), true)
  assert.equal(outputsMatch("a\nb", "a\nc"), false)
})

const ORIGINAL = `n = int(input())
total = 0
for i in range(1, n + 1):
    if i % 3 == 0 or i % 5 == 0:
        total += i
print(total)
`
const RENAMED = `# my own work :)
count = int(input())

result = 0
for value in range(1, count + 1):
    if value % 3 == 0 or value % 5 == 0:   # check multiples
        result += value
print(result)
`
const DIFFERENT = `n = int(input())
def tri(k):
    return k * (k + 1) // 2
m = (n // 3)
print(3 * tri(n // 3) + 5 * tri(n // 5) - 15 * tri(n // 15))
`

test("similarity: renaming and comments don't hide a copy", () => {
  assert.equal(similarity(fingerprint(ORIGINAL), fingerprint(RENAMED)), 1)
})

test("similarity: a different approach isn't flagged", () => {
  assert.ok(similarity(fingerprint(ORIGINAL), fingerprint(DIFFERENT)) < 0.3)
  const pairs = findSimilarPairs(
    [
      { key: "ana", code: ORIGINAL },
      { key: "ben", code: RENAMED },
      { key: "cy", code: DIFFERENT },
    ],
    0.7
  )
  assert.deepEqual(
    pairs.map((p) => [p.a, p.b]),
    [["ana", "ben"]]
  )
})

test("streaks: current counts through yesterday; longest across gaps", () => {
  const days = [
    "2026-01-01",
    "2026-01-02",
    "2026-01-03",
    "2026-01-10",
    "2026-01-11",
  ]
  assert.deepEqual(streaks(days, "2026-01-12"), { current: 2, longest: 3 })
  assert.deepEqual(streaks(days, "2026-01-11"), { current: 2, longest: 3 })
  assert.deepEqual(streaks(days, "2026-01-13"), { current: 0, longest: 3 })
  assert.deepEqual(streaks(["2025-12-31", "2026-01-01"], "2026-01-01"), {
    current: 2,
    longest: 2,
  })
})

test("days follow the site's timezone", () => {
  const lateUtc = new Date("2026-01-01T20:00:00Z")
  assert.equal(dayIn("UTC", lateUtc), "2026-01-01")
  assert.equal(dayIn("Asia/Kolkata", lateUtc), "2026-01-02")
})

test("daily pick is stable for a day and varies across days", () => {
  const ids = Array.from({ length: 30 }, (_, i) => i)
  assert.equal(pickDaily("2026-03-04", ids), pickDaily("2026-03-04", ids))
  const picks = new Set(
    ["2026-03-01", "2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05"].map(
      (d) => pickDaily(d, ids)
    )
  )
  assert.ok(picks.size >= 3)
  assert.equal(pickDaily("2026-03-04", []), null)
})

test("badges", () => {
  const none = earnedBadges({
    solved: 0,
    longestStreak: 0,
    contests: 0,
    hardSolved: 0,
  })
  assert.equal(none.length, 0)
  const some = earnedBadges({
    solved: 12,
    longestStreak: 7,
    contests: 1,
    hardSolved: 0,
  }).map((b) => b.id)
  assert.deepEqual(some, ["first", "ten", "week", "contest"])
})

const policy: GradePolicy = {
  opensAt: at(0),
  dueAt: at(60),
  allowLate: true,
  latePenaltyPercent: 30,
}
const attempt = (
  minutes: number,
  verdict: "AC" | "WA",
  score = 0,
  maxScore = 0
) => ({
  verdict,
  score,
  maxScore,
  createdAt: at(minutes),
})

test("assignment: accepted on time earns full marks", () => {
  assert.deepEqual(
    gradeProblem(100, [attempt(10, "WA"), attempt(20, "AC")], policy),
    {
      earned: 100,
      status: "solved",
    }
  )
})

test("assignment: nothing, or only failures, earns nothing", () => {
  assert.deepEqual(gradeProblem(100, [], policy), {
    earned: 0,
    status: "missing",
  })
  assert.deepEqual(gradeProblem(100, [attempt(5, "WA")], policy), {
    earned: 0,
    status: "attempted",
  })
})

test("assignment: work from before it opened doesn't count", () => {
  assert.deepEqual(gradeProblem(100, [attempt(-5, "AC")], policy), {
    earned: 0,
    status: "missing",
  })
})

test("assignment: late work loses the penalty, and only if late work is allowed", () => {
  assert.deepEqual(gradeProblem(100, [attempt(90, "AC")], policy), {
    earned: 70,
    status: "late",
  })
  assert.deepEqual(
    gradeProblem(100, [attempt(90, "AC")], { ...policy, allowLate: false }),
    {
      earned: 0,
      status: "attempted",
    }
  )
})

test("assignment: partial credit, and the better of on-time and late", () => {
  // 50% on time beats 100% late at a 60% penalty (40).
  const harsh = { ...policy, latePenaltyPercent: 60 }
  assert.deepEqual(
    gradeProblem(10, [attempt(10, "WA", 5, 10), attempt(90, "AC")], harsh),
    {
      earned: 5,
      status: "partial",
    }
  )
  // 20% on time loses to 100% late at 30% off (70).
  assert.deepEqual(
    gradeProblem(10, [attempt(10, "WA", 2, 10), attempt(90, "AC")], policy),
    {
      earned: 7,
      status: "late",
    }
  )
})

test("permissions: an organization-wide grant allows everywhere", () => {
  const grants = [{ permissions: ["org.members.view"], groupId: null }]
  assert.equal(allows(grants, "org.members.view"), true)
  assert.equal(allows(grants, "org.members.view", ["batch-a", "cse"]), true)
  assert.equal(allows(grants, "org.members.manage"), false)
})

test("permissions: a group grant covers that group and below, nothing else", () => {
  const parents: Record<string, string | null> = {
    "batch-a": "cse",
    "batch-b": "ece",
    cse: null,
    ece: null,
  }
  const grants = [{ permissions: ["org.members.manage"], groupId: "cse" }]
  assert.equal(
    allows(
      grants,
      "org.members.manage",
      ancestry("batch-a", (id) => parents[id])
    ),
    true
  )
  assert.equal(
    allows(
      grants,
      "org.members.manage",
      ancestry("batch-b", (id) => parents[id])
    ),
    false
  )
  // Organization-wide actions need an organization-wide grant.
  assert.equal(allows(grants, "org.members.manage"), false)
})

test("permissions: ancestry stops on a cycle", () => {
  assert.deepEqual(
    ancestry("a", (id) => (id === "a" ? "b" : "a")),
    ["a", "b"]
  )
})

test("permissions: members get nothing, admins everything", () => {
  assert.equal(
    allows(
      [{ permissions: SYSTEM_ROLES.member.permissions, groupId: null }],
      "org.members.view"
    ),
    false
  )
  assert.equal(
    allows(
      [{ permissions: SYSTEM_ROLES.admin.permissions, groupId: null }],
      "org.roles.manage"
    ),
    true
  )
})

test("email domains match exactly or as subdomains", () => {
  assert.equal(domainMatches("a@cumail.in", ["cumail.in"]), true)
  assert.equal(domainMatches("a@cse.cumail.in", ["@cumail.in"]), true)
  assert.equal(domainMatches("a@evilcumail.in", ["cumail.in"]), false)
  assert.equal(domainMatches("a@gmail.com", ["cumail.in"]), false)
})

test("audience: content for groups needs every group covered", () => {
  const parents: Record<string, string | null> = { a1: "cse", a2: "cse", e1: "ece", cse: null, ece: null }
  const chain = (id: string) => ancestry(id, (x) => parents[x])
  const cseTeacher = [{ permissions: ["assignments.manage"], groupId: "cse" }]
  assert.equal(allowsFor(cseTeacher, "assignments.manage", [["a1", "a2"]], chain), true)
  assert.equal(allowsFor(cseTeacher, "assignments.manage", [["a1", "e1"]], chain), false)
  assert.equal(allowsFor(cseTeacher, "assignments.manage", [], chain), false)
})

test("audience: a student in a batch is in an audience of its branch, not another", () => {
  const parents: Record<string, string | null> = { a1: "cse", e1: "ece", cse: null, ece: null }
  const chain = (id: string) => ancestry(id, (x) => parents[x])
  assert.equal(inAudience(["a1"], [["cse"]], chain), true)
  assert.equal(inAudience(["a1"], [["ece"]], chain), false)
  assert.equal(inAudience([], [], chain), true)
  assert.equal(inAudience([], [["cse"]], chain), false)
})

test("syllabus: covered topics, behind schedule and what's next", () => {
  const topics = [
    { id: "a", title: "Variables", plannedFor: "2026-11-01" },
    { id: "b", title: "Loops", plannedFor: "2026-11-03" },
    { id: "c", title: "Functions", plannedFor: "2026-11-20" },
    { id: "d", title: "Files", plannedFor: null },
  ]
  const p = syllabusProgress(topics, [{ topicIds: ["a"] }, { topicIds: ["a", "c"] }], "2026-11-04")
  assert.deepEqual(p, { total: 4, covered: 2, percent: 50, behind: ["Loops"], next: "Loops" })
  assert.equal(syllabusProgress([], [], "2026-11-04").percent, 0)
})

test("audience: conditions combine, like 3rd year AND taking CAC", () => {
  const parents: Record<string, string | null> = { y3: null, secA: "y3", secB: "y3", y2: null, cac: null, dsa: null }
  const chain = (id: string) => ancestry(id, (x) => parents[x])
  const y3cac = [["y3"], ["cac"]]
  assert.equal(inAudience(["secA", "cac"], y3cac, chain), true, "3rd year A, takes CAC")
  assert.equal(inAudience(["secB", "cac"], y3cac, chain), true, "any section")
  assert.equal(inAudience(["secA", "dsa"], y3cac, chain), false, "3rd year, no CAC")
  assert.equal(inAudience(["y2", "cac"], y3cac, chain), false, "CAC, wrong year")
  assert.equal(inAudience(["secA", "dsa"], [["y3"], ["cac", "dsa"]], chain), true, "either subject")
  // A CAC teacher reaches only CAC students, so may set this; a section A teacher may not.
  const cacTeacher = [{ permissions: ["assignments.manage"], groupId: "cac" }]
  const secATeacher = [{ permissions: ["assignments.manage"], groupId: "secA" }]
  assert.equal(allowsFor(cacTeacher, "assignments.manage", y3cac, chain), true)
  assert.equal(allowsFor(secATeacher, "assignments.manage", y3cac, chain), false)
  assert.equal(allowsFor(secATeacher, "assignments.manage", [["secA"], ["cac"]], chain), true)
})
