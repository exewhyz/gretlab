/**
 * Feedback rounds (features/feedback-rounds; rules packages/judge/src/feedback.ts): whoever runs
 * them opens a round for some classes; each student there rates each teacher of their subjects
 * (Subjects), once, while it's open; the bell reminds them until done; a teacher sees only their
 * own results, the person running rounds everyone's; nobody sees who answered and nothing shows
 * below three answers; questions are locked once answered; closed rounds take nothing; the pages.
 *   node e2e/feedback-rounds.mjs [base-url] [screenshot-dir]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { chromium } = createRequire(ROOT + "package.json")("playwright")
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SHOTS = process.argv[3] ?? "/tmp/gretlab-e2e/feedback-rounds/"
const SECRET = process.env.NEXTAUTH_SECRET ?? "e2e-only-secret"
const DB = process.env.E2E_DB ?? "gretlab_test"
mkdirSync(SHOTS, { recursive: true })
let failures = 0
const check = (name, ok, detail = "") => {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 240)}`
  )
  if (!ok) failures++
}
const psql = (q) =>
  execFileSync("docker", [
    "compose",
    "-f",
    ROOT + "docker-compose.yml",
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "gretlab",
    "-d",
    DB,
    "-Atqc",
    q,
  ])
    .toString()
    .trim()

const cleanup = () => {
  psql(`delete from organizations where slug like 'fb-%'`)
  psql(`delete from users where email like 'fb-%@example.com'`)
}
cleanup()
psql(
  `insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`
)
const people = [
  "fb-o",
  "fb-maths",
  "fb-sci",
  "fb-s1",
  "fb-s2",
  "fb-s3",
  "fb-s4",
  "fb-out",
]
for (const h of people)
  psql(
    `insert into users(email,name,role,handle) values ('${h}@example.com','${h} Name','student','${h}')`
  )
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { cookie, "content-type": "application/json", origin: BASE },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const as = Object.fromEntries(
  await Promise.all(
    people.map(async (h) => [h, await client(`${h}@example.com`)])
  )
)
const admin = await client("admin@example.com")
await admin("/admin/organizations", {
  body: {
    name: "Fb School",
    slug: "fb-school",
    type: "school",
    ownerEmail: "fb-o@example.com",
  },
})
const O = "/orgs/fb-school"
const owner = as["fb-o"]
const orgId = psql(`select id from organizations where slug='fb-school'`)
const grade = (await owner(`${O}/groups`, { body: { name: "Grade 6" } })).json
const secA = (
  await owner(`${O}/groups`, {
    body: { name: "Section A", parentId: grade.id },
  })
).json
for (const h of people.slice(1, 7))
  psql(
    `insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`
  )
await owner(`${O}/groups/${secA.id}/members`, {
  body: { userIds: ["fb-s1", "fb-s2", "fb-s3", "fb-s4"].map(uid) },
})
const teacherRole = (await owner(`${O}/roles`)).json.find(
  (r) => r.systemKey === "teacher"
)
await owner(`${O}/members/${uid("fb-maths")}/roles`, {
  body: { roleId: teacherRole.id, groupId: secA.id },
})
await owner(`${O}/members/${uid("fb-sci")}/roles`, {
  body: { roleId: teacherRole.id, groupId: grade.id },
})
const maths = (await owner(`${O}/subjects`, { body: { name: "Maths" } })).json
const science = (await owner(`${O}/subjects`, { body: { name: "Science" } }))
  .json
// Maths is given to the section, Science to the whole grade: both reach Section A's students.
await owner(`${O}/subjects/${maths.id}/classes`, {
  body: { groupId: secA.id, teacherId: uid("fb-maths") },
})
const sciGiven = await owner(`${O}/subjects/${science.id}/classes`, {
  body: { groupId: grade.id, teacherId: uid("fb-sci") },
})
check(
  "setup: Science is given to the whole grade",
  sciGiven.status === 200,
  JSON.stringify(sciGiven.json)
)

// ---------- opening a round
const hours = (n) => new Date(Date.now() + n * 3600_000).toISOString()
const questions = [
  { id: "clear", kind: "rating", text: "Explains clearly" },
  { id: "pace", kind: "rating", text: "Keeps a good pace" },
  { id: "comment", kind: "comment", text: "Anything else?" },
]
const roundBody = {
  title: "Fb Term 1",
  description: "",
  groupIds: [grade.id],
  questions,
  opensAt: hours(-1),
  closesAt: hours(48),
}
check(
  "a teacher can't open a round",
  (await as["fb-maths"](`${O}/feedback-rounds`, { body: roundBody })).status ===
    403
)
check(
  "it must close after it opens",
  (
    await owner(`${O}/feedback-rounds`, {
      body: { ...roundBody, closesAt: hours(-2) },
    })
  ).status === 400
)
const round = (await owner(`${O}/feedback-rounds`, { body: roundBody })).json
check(
  "the owner opens a round for the grade",
  Boolean(round?.id),
  JSON.stringify(round)
)
const R = `${O}/feedback-rounds/${round.id}`

// ---------- students
const toGive = (await as["fb-s1"](`${O}/feedback-rounds/to-give`)).json
const targets = toGive?.[0]?.targets ?? []
check(
  "a student in the grade rates each teacher of their subjects",
  targets
    .map((t) => t.subject)
    .sort()
    .join() === "Maths,Science",
  JSON.stringify(toGive)
)
const mathsTarget = targets.find((t) => t.subject === "Maths")?.classSubjectId
const sciTarget = targets.find((t) => t.subject === "Science")?.classSubjectId
check(
  "an outsider has nothing to give",
  (await as["fb-out"](`${O}/feedback-rounds/to-give`)).status === 404
)
const reminded = async (h) =>
  (await as[h]("/me/notifications")).json?.reminders?.some?.(
    (r) => r.kind === "feedback_due"
  )
check("the bell reminds them", await reminded("fb-s1"))
check(
  "a rating outside 1 to 5 is refused",
  (
    await as["fb-s1"](`${R}/answers`, {
      body: { classSubjectId: mathsTarget, answers: { clear: 7, pace: 3 } },
    })
  ).json?.error?.code === "invalid_answers"
)
check(
  "…and every rating is needed",
  (
    await as["fb-s1"](`${R}/answers`, {
      body: { classSubjectId: mathsTarget, answers: { clear: 4 } },
    })
  ).json?.error?.code === "invalid_answers"
)
check(
  "a student answers",
  (
    await as["fb-s1"](`${R}/answers`, {
      body: {
        classSubjectId: mathsTarget,
        answers: { clear: 5, pace: 4, comment: "Very clear" },
      },
    })
  ).status === 200
)
check(
  "…once",
  (
    await as["fb-s1"](`${R}/answers`, {
      body: { classSubjectId: mathsTarget, answers: { clear: 1, pace: 1 } },
    })
  ).json?.error?.code === "already_answered"
)
check(
  "a teacher of theirs they don't have can't be rated",
  (
    await as["fb-maths"](`${R}/answers`, {
      body: { classSubjectId: mathsTarget, answers: { clear: 5, pace: 5 } },
    })
  ).status !== 200
)
await as["fb-s1"](`${R}/answers`, {
  body: { classSubjectId: sciTarget, answers: { clear: 3, pace: 3 } },
})
check("done with everyone, no more reminder", !(await reminded("fb-s1")))
check("others are still reminded", await reminded("fb-s2"))

// ---------- results
const mine = async (h) => (await as[h](`${O}/feedback-rounds/my-results`)).json
const oneAnswer = (await mine("fb-maths"))?.[0]?.lines?.[0]
check(
  "with one answer a teacher sees only the count",
  oneAnswer?.responses === 1 &&
    oneAnswer?.shown === false &&
    oneAnswer?.questions?.length === 0 &&
    oneAnswer?.comments?.length === 0,
  JSON.stringify(oneAnswer)
)
await as["fb-s2"](`${R}/answers`, {
  body: {
    classSubjectId: mathsTarget,
    answers: { clear: 4, pace: 4, comment: "A bit fast" },
  },
})
await as["fb-s3"](`${R}/answers`, {
  body: { classSubjectId: mathsTarget, answers: { clear: 4, pace: 3 } },
})
const three = (await mine("fb-maths"))?.[0]?.lines?.[0]
check(
  "from three, the averages show",
  three?.shown === true &&
    three.questions.find((q) => q.id === "clear")?.average === 4.3 &&
    three.overall === 4,
  JSON.stringify(three)
)
check(
  "…and comments, without who wrote them",
  JSON.stringify(three?.comments) ===
    JSON.stringify(["A bit fast", "Very clear"]) &&
    !JSON.stringify(three).includes("fb-s")
)
const sciMine = (await mine("fb-sci"))?.[0]?.lines ?? []
check(
  "a teacher sees only their own",
  sciMine.length === 1 && sciMine[0].subject === "Science"
)
const all = (await owner(`${R}/results`)).json?.lines ?? []
check(
  "whoever runs rounds sees everyone's",
  all
    .map((l) => l.subject)
    .sort()
    .join() === "Maths,Science"
)
check(
  "a student sees no results",
  (await as["fb-s1"](`${R}/results`)).json?.lines?.length === 0
)
check(
  "the answers name nobody anywhere the teachers can read",
  !JSON.stringify(all).includes(uid("fb-s1"))
)

// ---------- once answered, closed
check(
  "once answered, the questions can't change",
  (
    await owner(R, {
      method: "PUT",
      body: { ...roundBody, questions: [questions[0]] },
    })
  ).json?.error?.code === "answered"
)
check(
  "…but the dates can",
  (
    await owner(R, {
      method: "PUT",
      body: { ...roundBody, closesAt: hours(72) },
    })
  ).status === 200
)
psql(
  `update feedback_rounds set closes_at = now() - interval '1 minute' where id = '${round.id}'`
)
check(
  "a closed round takes nothing",
  (
    await as["fb-s4"](`${R}/answers`, {
      body: { classSubjectId: mathsTarget, answers: { clear: 5, pace: 5 } },
    })
  ).json?.error?.code === "closed"
)
check("…and reminds nobody", !(await reminded("fb-s4")))
psql(
  `update feedback_rounds set closes_at = now() + interval '1 day' where id = '${round.id}'`
)
check(
  "the activity log has the round",
  Number(
    psql(
      `select count(*) from audit_log where org_id = '${orgId}' and action like 'feedback_round.%'`
    )
  ) >= 2
)

// ---------- in a browser
const browser = await chromium.launch()
const tabFor = async (email, viewport) => {
  const context = await browser.newContext({ viewport })
  await context.addCookies([
    {
      name: "next-auth.session-token",
      value: await encode({ token: { email }, secret: SECRET }),
      url: BASE,
    },
  ])
  return { context, tab: await context.newPage() }
}
{
  const { context, tab } = await tabFor("fb-s4@example.com", {
    width: 390,
    height: 844,
  })
  await tab.goto(`${BASE}/orgs/fb-school/feedback`)
  const card = tab.getByTestId("feedback-target").filter({ hasText: "Maths" })
  await card.waitFor({ timeout: 30_000 }).catch(() => {})
  for (const label of ["Explains clearly", "Keeps a good pace"])
    await card
      .getByRole("radiogroup", { name: label })
      .getByRole("radio", { name: "4" })
      .click()
  await tab.screenshot({ path: `${SHOTS}give-phone.png`, fullPage: true })
  await card.getByRole("button", { name: "Send feedback" }).click()
  await card
    .getByTestId("feedback-done")
    .waitFor({ timeout: 20_000 })
    .catch(() => {})
  check(
    "phone: a student rates a teacher on the page",
    (await card.getByTestId("feedback-done").count()) === 1 &&
      psql(
        `select count(*) from feedback_responses where student_id = '${uid("fb-s4")}'`
      ) === "1"
  )
  check(
    "phone: …and nothing spills sideways",
    await tab.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1
    )
  )
  await context.close()
}
{
  const { context, tab } = await tabFor("fb-o@example.com", {
    width: 1440,
    height: 900,
  })
  await tab.goto(`${BASE}/orgs/fb-school/manage/feedback-rounds`)
  await tab
    .getByTestId("feedback-round")
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => {})
  check(
    "laptop: Manage › Feedback rounds lists the round",
    (await tab.getByTestId("feedback-round").count()) === 1
  )
  check(
    "laptop: …and it's in the sidebar",
    (await tab
      .locator("nav[aria-label='Organization']")
      .getByRole("link", { name: "Feedback rounds" })
      .count()) === 1
  )
  await tab.getByRole("button", { name: "Results" }).click()
  await tab
    .getByTestId("round-results")
    .getByTestId("overall")
    .first()
    .waitFor({ timeout: 20_000 })
    .catch(() => {})
  check(
    "laptop: the results sheet shows each teacher",
    (await tab.getByTestId("round-results").getByText("Maths").count()) >= 1
  )
  await tab.screenshot({ path: `${SHOTS}results-laptop.png` })
  await context.close()
}
{
  const { context, tab } = await tabFor("fb-maths@example.com", {
    width: 1440,
    height: 900,
  })
  await tab.goto(`${BASE}/orgs/fb-school/manage/feedback-rounds/mine`)
  await tab
    .getByTestId("my-feedback")
    .waitFor({ timeout: 30_000 })
    .catch(() => {})
  await tab
    .getByTestId("overall")
    .first()
    .waitFor({ timeout: 20_000 })
    .catch(() => {})
  check(
    "laptop: a teacher's My feedback page",
    (await tab.getByTestId("overall").count()) === 1
  )
  await tab.screenshot({ path: `${SHOTS}mine-laptop.png`, fullPage: true })
  await context.close()
}
await browser.close()

check(
  "deleting a round takes its answers",
  (await owner(R, { method: "DELETE" })).status === 200 &&
    psql(
      `select count(*) from feedback_responses where round_id = '${round.id}'`
    ) === "0"
)

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
