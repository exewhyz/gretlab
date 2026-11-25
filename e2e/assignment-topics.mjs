/**
 * Syllabus topics on assignments: an assignment is tagged with the topics it covers, chosen from
 * its organization's class syllabi ("<class>:<topic>", since topic ids are only unique within a
 * syllabus); the save refuses topics that aren't there, and the platform's own assignments have
 * none; only people who set assignments can list the topics; each class's Classwork shows its
 * topics' assignments, never another class's topic that happens to share an id; the picker and
 * the class page in a browser.
 *   node e2e/assignment-topics.mjs [base-url] [screenshot-dir]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { chromium } = createRequire(ROOT + "package.json")("playwright")
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SHOTS = process.argv[3] ?? "/tmp/gretlab-e2e/assignment-topics/"
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
  psql(`delete from assignments where slug like 'at-%'`)
  psql(`delete from organizations where slug like 'at-%'`)
  psql(`delete from users where email like 'at-%@example.com'`)
}
cleanup()
psql(
  `insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`
)
for (const h of ["at-owner", "at-student"])
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
const admin = await client("admin@example.com")
await admin("/admin/organizations", {
  body: {
    name: "At College",
    slug: "at-college",
    type: "college",
    ownerEmail: "at-owner@example.com",
  },
})
const O = "/orgs/at-college"
const owner = await client("at-owner@example.com")
const student = await client("at-student@example.com")
const secA = (await owner(`${O}/groups`, { body: { name: "Sec A" } })).json
const secB = (await owner(`${O}/groups`, { body: { name: "Sec B" } })).json
const orgId = psql(`select id from organizations where slug = 'at-college'`)
psql(
  `insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid("at-student")}','active','created')`
)
await owner(`${O}/groups/${secA.id}/members`, {
  body: { userIds: [uid("at-student")] },
})

// Two syllabi that share a topic id ("t1"), as the API allows.
await owner(`${O}/teaching/${secA.id}`, {
  method: "PUT",
  body: {
    topics: [
      { id: "t1", title: "Loops", plannedFor: null },
      { id: "t2", title: "Arrays", plannedFor: null },
    ],
  },
})
await owner(`${O}/teaching/${secB.id}`, {
  method: "PUT",
  body: { topics: [{ id: "t1", title: "Strings", plannedFor: null }] },
})

const listed = await owner(`${O}/syllabus-topics`)
const keys = listed.json?.flatMap((c) => c.topics.map((t) => t.id)) ?? []
check(
  "whoever sets assignments lists every class's topics, keyed by class",
  listed.status === 200 &&
    keys.includes(`${secA.id}:t1`) &&
    keys.includes(`${secB.id}:t1`) &&
    keys.length === 3,
  JSON.stringify(listed.json)
)
check(
  "a student can't list them",
  (await student(`${O}/syllabus-topics`)).status === 403
)

const P = psql(
  `select id from problems where published and listed and not members_only and org_id is null order by slug limit 1`
)
const hours = (n) => new Date(Date.now() + n * 3600_000).toISOString()
const body = (over) => ({
  title: "At Loops",
  slug: "at-loops",
  description: "",
  opensAt: hours(-1),
  dueAt: hours(48),
  allowLate: false,
  latePenaltyPercent: 0,
  published: true,
  problems: [{ problemId: P, points: 100 }],
  audience: [[secA.id]],
  ...over,
})

const made = await owner(`${O}/assignments`, {
  body: body({ topicIds: [`${secA.id}:t1`] }),
})
check(
  "an assignment is tagged with a topic of its class",
  made.status === 200 &&
    psql(`select topic_ids::text from assignments where slug = 'at-loops'`) ===
      `["${secA.id}:t1"]`,
  JSON.stringify(made.json).slice(0, 200)
)
check(
  "a topic that isn't in a syllabus is refused",
  (
    await owner(`${O}/assignments`, {
      body: body({ slug: "at-bad", topicIds: [`${secA.id}:nope`] }),
    })
  ).json?.error?.code === "unknown_topic"
)
check(
  "…as is a bare topic id, without its class",
  (
    await owner(`${O}/assignments`, {
      body: body({ slug: "at-bare", topicIds: ["t1"] }),
    })
  ).status === 400 &&
    psql(`select count(*) from assignments where slug = 'at-bare'`) === "0"
)
check(
  "the platform's own assignments have no syllabus",
  (
    await admin("/admin/assignments", {
      body: body({
        slug: "at-platform",
        audience: [],
        topicIds: [`${secA.id}:t1`],
      }),
    })
  ).json?.error?.code === "unknown_topic"
)

// A college-wide assignment tagged with Sec A's t1 reaches Sec B too, but not under Sec B's own t1.
await owner(`${O}/assignments`, {
  body: body({
    title: "At Everyone",
    slug: "at-everyone",
    audience: [],
    topicIds: [`${secA.id}:t1`],
  }),
})
const workA = (await student(`${O}/classes/${secA.id}/classwork`)).json
const workB = (await owner(`${O}/classes/${secB.id}/classwork`)).json
const onA = workA?.assignments
  ?.filter((a) => a.topicIds.includes(`${secA.id}:t1`))
  .map((a) => a.slug)
  .sort()
check(
  "Sec A's Classwork has both under Loops",
  JSON.stringify(onA) === JSON.stringify(["at-everyone", "at-loops"]),
  JSON.stringify(onA)
)
check(
  "Sec B's Classwork has the college-wide one, but not under its own t1",
  workB?.assignments?.some((a) => a.slug === "at-everyone") &&
    !workB.assignments.some((a) => a.topicIds.includes(`${secB.id}:t1`))
)

// ---------- in a browser: tag from the form, see it on the class
const browser = await chromium.launch()
for (const [name, viewport] of [
  ["laptop", { width: 1440, height: 900 }],
  ["phone", { width: 390, height: 844 }],
]) {
  const context = await browser.newContext({ viewport })
  await context.addCookies([
    {
      name: "next-auth.session-token",
      value: await encode({
        token: { email: "at-owner@example.com" },
        secret: SECRET,
      }),
      url: BASE,
    },
  ])
  const tab = await context.newPage()
  if (name === "laptop") {
    await tab.goto(`${BASE}/orgs/at-college/manage/assignments/${made.json.id}`)
    const picker = tab.getByTestId("assignment-topics")
    await picker.waitFor({ timeout: 30_000 }).catch(() => {})
    // It says "1 chosen" until the topics' names have loaded, then names them.
    await picker
      .getByText("Loops")
      .waitFor({ timeout: 15_000 })
      .catch(() => {})
    check(
      "the form shows the chosen topic",
      ((await picker.textContent()) ?? "").includes("Loops")
    )
    await picker.getByRole("button", { name: "Change" }).click()
    const dialog = tab.getByRole("dialog")
    await dialog.getByRole("checkbox", { name: "Arrays" }).click()
    await tab.screenshot({ path: `${SHOTS}picker-${name}.png` })
    await dialog.getByRole("button", { name: "Done" }).click()
    await tab.getByRole("button", { name: "Save changes" }).click()
    await tab.waitForTimeout(2000)
    check(
      "ticking another topic and saving keeps both",
      psql(
        `select topic_ids::text from assignments where slug = 'at-loops'`
      ) === `["${secA.id}:t1", "${secA.id}:t2"]`,
      psql(`select topic_ids::text from assignments where slug = 'at-loops'`)
    )
  }
  await tab.goto(`${BASE}/orgs/at-college/classes/${secA.id}?tab=classwork`)
  // "1. Loops" exactly: the Arrays topic's own "At Loops" link would match plain "Loops" too.
  const loops = tab
    .getByTestId("syllabus-topic")
    .filter({ hasText: "1. Loops" })
  await loops.waitFor({ timeout: 30_000 }).catch(() => {})
  check(
    `${name}: the class's syllabus lists each topic's assignments`,
    (await loops.getByRole("link", { name: "At Loops" }).count()) === 1 &&
      (await loops.getByRole("link", { name: "At Everyone" }).count()) === 1
  )
  check(
    `${name}: …and nothing spills sideways`,
    await tab.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1
    )
  )
  await tab.screenshot({
    path: `${SHOTS}classwork-${name}.png`,
    fullPage: true,
  })
  await context.close()
}
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
