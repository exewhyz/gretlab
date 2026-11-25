/**
 * An organization's own study plans (features/catalog/org-plans.ts): whoever manages problems
 * across the organization makes them, mixing library problems with its own published members-only
 * ones (drafts, another organization's and assessment-only problems refused); members see
 * published plans with their progress, each problem linking to where it's solved; drafts stay
 * with the managers; outsiders and other organizations get nothing; the platform's list pages
 * never show them; deleting asks nothing extra of someone without two-factor; the pages in a
 * browser on a laptop and a phone, with Study plans in the sidebar.
 *   node e2e/org-study-plans.mjs [base-url] [screenshot-dir]
 */
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { chromium } = createRequire(ROOT + "package.json")("playwright")
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SHOTS = process.argv[3] ?? "/tmp/gretlab-e2e/org-study-plans/"
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
  psql(
    `delete from problem_lists where org_id in (select id from organizations where slug like 'sp-%')`
  )
  psql(`delete from problems where slug like 'sp-%'`)
  psql(`delete from organizations where slug like 'sp-%'`)
  psql(`delete from users where email like 'sp-%@example.com'`)
}
cleanup()
psql(
  `insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`
)
for (const h of ["sp-owner", "sp-student", "sp-out", "sp-other"])
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
    name: "Sp College",
    slug: "sp-college",
    type: "college",
    ownerEmail: "sp-owner@example.com",
  },
})
await admin("/admin/organizations", {
  body: {
    name: "Sp Other",
    slug: "sp-other",
    type: "college",
    ownerEmail: "sp-other@example.com",
  },
})
const O = "/orgs/sp-college"
const owner = await client("sp-owner@example.com")
const student = await client("sp-student@example.com")
const outsider = await client("sp-out@example.com")
const other = await client("sp-other@example.com")
const orgId = psql(`select id from organizations where slug = 'sp-college'`)
psql(
  `insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid("sp-student")}','active','created')`
)

// Problems: a library one, the organization's members-only one, a draft, and another organization's.
const library = psql(
  `select slug from problems where published and listed and not members_only and org_id is null order by slug limit 1`
)
const libraryId = psql(`select id from problems where slug = '${library}'`)
const template = (await admin(`/admin/problems/${libraryId}`)).json
const problemBody = (over) => ({
  ...template,
  tests: template.tests.map(({ input, expected, isSample, points }) => ({
    input,
    expected,
    isSample,
    points,
  })),
  tags: [],
  ...over,
})
check(
  "the organization has a members-only problem",
  (
    await owner(`${O}/problems`, {
      body: problemBody({
        slug: "sp-members",
        title: "Sp Members Problem",
        published: true,
        membersOnly: true,
      }),
    })
  ).status === 200
)
await owner(`${O}/problems`, {
  body: problemBody({
    slug: "sp-draft",
    title: "Sp Draft",
    published: false,
    membersOnly: true,
  }),
})
await other("/orgs/sp-other/problems", {
  body: problemBody({
    slug: "sp-theirs",
    title: "Sp Theirs",
    published: true,
    membersOnly: true,
  }),
})

// ---------- making a plan
check(
  "a member who doesn't manage problems can't make one",
  (await student(`${O}/study-plans`, { body: { title: "Mine" } })).status ===
    403
)
const made = await owner(`${O}/study-plans`, {
  body: { title: "Sp Week 1", description: "Loops first" },
})
check(
  "the owner makes a plan",
  made.status === 200 && Boolean(made.json?.slug),
  JSON.stringify(made.json)
)
const P = `${O}/study-plans/${made.json?.slug}`
check(
  "library and members-only problems go in",
  (
    await owner(P, {
      method: "PATCH",
      body: { problemSlugs: [library, "sp-members"] },
    })
  ).status === 200
)
for (const [what, slug] of [
  ["a draft", "sp-draft"],
  ["another organization's", "sp-theirs"],
  ["one that doesn't exist", "sp-nothing"],
])
  check(
    `${what} is refused`,
    (
      await owner(P, {
        method: "PATCH",
        body: { problemSlugs: [library, slug] },
      })
    ).json?.error?.code === "problem_not_allowed"
  )
check("…and nothing changed", (await owner(P)).json?.items?.length === 2)

// ---------- who sees it
check(
  "a draft plan isn't shown to members",
  (await student(`${O}/study-plans`)).json?.plans?.length === 0 &&
    (await student(P)).status === 404
)
await owner(P, { method: "PATCH", body: { published: true } })
const seen = (await student(P)).json
check(
  "members see a published plan, in order",
  seen?.items?.map((i) => i.slug).join() === `${library},sp-members`,
  JSON.stringify(seen)
)
check(
  "…each linked to where it's solved",
  seen?.items?.[0]?.href === `/problems/${library}` &&
    seen?.items?.[1]?.href === "/orgs/sp-college/practice/sp-members"
)
check(
  "outsiders get nothing",
  (await outsider(P)).status === 404 &&
    (await outsider(`${O}/study-plans`)).status === 404
)
check("another organization's people neither", (await other(P)).status === 404)
check(
  "the platform's list pages never show it",
  (await student(`/lists/${made.json.slug}`)).status === 404 &&
    !(await student("/lists")).json?.some?.((l) => l.slug === made.json.slug)
)

// Progress: an accepted submission counts.
psql(
  `insert into submissions (user_id, problem_id, language, entry, kind, status, verdict, files, time_limit_ms, memory_limit_mb) values ('${uid("sp-student")}', '${libraryId}', 'python', 'main.py', 'submit', 'done', 'AC', '[]'::jsonb, 2000, 256)`
)
const progress = (await student(P)).json
check(
  "their progress: what they've solved",
  progress?.items?.[0]?.solved === true &&
    progress?.items?.[1]?.solved === false
)

// ---------- in a browser
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
        token: { email: "sp-student@example.com" },
        secret: SECRET,
      }),
      url: BASE,
    },
  ])
  const tab = await context.newPage()
  await tab.goto(`${BASE}/orgs/sp-college/study-plans`)
  const card = tab.getByTestId("org-plan").filter({ hasText: "Sp Week 1" })
  await card.waitFor({ timeout: 30_000 }).catch(() => {})
  check(`${name}: members see the plan`, (await card.count()) === 1)
  await card.click()
  await tab
    .getByTestId("plan-progress")
    .waitFor({ timeout: 30_000 })
    .catch(() => {})
  check(
    `${name}: …its problems and their progress`,
    ((await tab.getByTestId("plan-progress").textContent()) ?? "").includes(
      "1 of 2 solved"
    ) && (await tab.getByTestId("solved").count()) === 1
  )
  check(
    `${name}: …and nothing spills sideways`,
    await tab.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1
    )
  )
  await tab.screenshot({ path: `${SHOTS}plan-${name}.png`, fullPage: true })
  await context.close()
}
{
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  })
  await context.addCookies([
    {
      name: "next-auth.session-token",
      value: await encode({
        token: { email: "sp-owner@example.com" },
        secret: SECRET,
      }),
      url: BASE,
    },
  ])
  const tab = await context.newPage()
  await tab.goto(`${BASE}/orgs/sp-college/manage/study-plans`)
  await tab
    .getByRole("button", { name: "Edit" })
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => {})
  check(
    "the owner manages plans under Manage › Study plans",
    (await tab.getByRole("cell", { name: "Sp Week 1" }).count()) === 1
  )
  const nav = tab.locator("nav[aria-label='Organization']")
  check(
    "…and it's in the sidebar",
    (await nav.getByRole("link", { name: "Study plans" }).count()) >= 1
  )
  await tab.getByRole("button", { name: "Edit" }).first().click()
  await tab
    .getByTestId("plan-editor")
    .waitFor({ timeout: 30_000 })
    .catch(() => {})
  await tab.waitForTimeout(500)
  await tab.screenshot({ path: `${SHOTS}editor-laptop.png` })
  check(
    "the editor opens with the plan's problems",
    await tab.getByTestId("plan-editor").isVisible()
  )
  await context.close()
}
await browser.close()

check(
  "deleting removes it",
  (await owner(P, { method: "DELETE" })).status === 200 &&
    (await student(P)).status === 404
)

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
