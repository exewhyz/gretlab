/**
 * Plagiarism checks with a side-by-side view: the platform's (any problem) and an
 * organization's (its own assignments and contests, only the students the person may grade).
 *   node e2e/plagiarism.mjs http://localhost:3100 /tmp/gretlab-e2e/
 */
import { execFileSync } from "node:child_process"
import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { chromium } = createRequire(ROOT + "package.json")("playwright")
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SHOTS = process.argv[3] ?? "/tmp/gretlab-e2e/"
const SECRET = process.env.NEXTAUTH_SECRET ?? "e2e-only-secret"
const DB = process.env.E2E_DB ?? "gretlab_test"
mkdirSync(SHOTS, { recursive: true })

let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 300)}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()
const cleanup = () => {
  psql(`delete from submissions where user_id in (select id from users where email like 'pl-%')`)
  psql(`delete from assignments where slug like 'pl-%'`)
  psql(`delete from organizations where slug = 'pl-school'`)
  psql(`delete from problems where slug like 'pl-%'`)
  psql(`delete from users where email like 'pl-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
const people = ["pl-o", "pl-t", "pl-a1", "pl-a2", "pl-a3", "pl-b1", "pl-x"]
for (const h of people) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h.slice(3).toUpperCase()} Student','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json", origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
const [owner, teacher, a1] = await Promise.all(["pl-o", "pl-t", "pl-a1"].map((h) => client(`${h}@example.com`)))
await admin("/admin/organizations", { body: { name: "Pl School", slug: "pl-school", type: "school", ownerEmail: "pl-o@example.com" } })
const O = "/orgs/pl-school"
const orgId = psql(`select id from organizations where slug='pl-school'`)
const grade = (await owner(`${O}/groups`, { body: { name: "Grade 9" } })).json
const secA = (await owner(`${O}/groups`, { body: { name: "A", parentId: grade.id } })).json
const secB = (await owner(`${O}/groups`, { body: { name: "B", parentId: grade.id } })).json
for (const h of ["pl-t", "pl-a1", "pl-a2", "pl-a3", "pl-b1"]) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
await owner(`${O}/groups/${secA.id}/members`, { body: { userIds: ["pl-a1", "pl-a2", "pl-a3"].map(uid) } })
await owner(`${O}/groups/${secB.id}/members`, { body: { userIds: [uid("pl-b1")] } })
const teacherRole = (await owner(`${O}/roles`)).json.find((r) => r.systemKey === "teacher")
await owner(`${O}/members/${uid("pl-t")}/roles`, { body: { roleId: teacherRole.id, groupId: secA.id } })

const problemBody = { slug: "pl-pairs", title: "Pl Best Pair", unitId: null, level: "easy", description: "Largest sum of two.", statement: [], inputFormat: [], outputFormat: [], constraints: [], timeLimitMs: null, memoryLimitMb: null, allowedLanguages: null, published: true, listed: true, tests: [{ input: "3\n1 2 3", expected: "5", isSample: true, points: 1 }] }
const problem = (await owner(`${O}/problems`, { body: problemBody })).json
const problemId = problem?.id ?? psql(`select id from problems where slug='pl-pairs'`)
const hours = (h) => new Date(Date.now() + h * 3_600_000).toISOString()
const asg = await owner(`${O}/assignments`, { body: { title: "Pl Week", slug: "pl-week", description: "", opensAt: hours(-2), dueAt: hours(24), allowLate: false, latePenaltyPercent: 0, published: true, audience: [[grade.id]], problems: [{ problemId, points: 10 }], questions: [] } })
check("setup: an assignment for the grade", asg.status === 200, JSON.stringify(asg.json).slice(0, 200))
const asgId = asg.json?.id ?? psql(`select id from assignments where slug='pl-week'`)

const ORIGINAL = "def solve(nums):\n    best = 0\n    for i in range(len(nums)):\n        for j in range(i + 1, len(nums)):\n            if nums[i] + nums[j] > best:\n                best = nums[i] + nums[j]\n    return best\n\nn = int(input())\nprint(solve(list(map(int, input().split()))))\n"
const COPIED = "import sys\n# my own work\ndef answer(arr):\n    top = 0\n    for a in range(len(arr)):\n        for b in range(a + 1, len(arr)):\n            if arr[a] + arr[b] > top:\n                top = arr[a] + arr[b]\n    return top\n\ncount = int(input())\nprint(answer(list(map(int, input().split()))))\n"
const DIFFERENT = "input()\nvalues = sorted(map(int, input().split()), reverse=True)\nfirst, second = values[0], values[1]\nresult = first + second\nprint(result)\n"
const accepted = (h, code) => psql(`insert into submissions(user_id,problem_id,kind,language,entry,files,time_limit_ms,memory_limit_mb,status,verdict,score,max_score,created_at,queue_at) values ('${uid(h)}','${problemId}','submit','python','main.py','${JSON.stringify([{ path: "main.py", content: code }]).replaceAll("'", "''")}',1000,256,'done','AC',1,1,now() - interval '1 hour',now()) returning id`)
const sub = { a1: accepted("pl-a1", ORIGINAL), a2: accepted("pl-a2", COPIED), a3: accepted("pl-a3", DIFFERENT), b1: accepted("pl-b1", COPIED), x: accepted("pl-x", COPIED) }

// ---------- who may check what
const work = (await owner(`${O}/plagiarism`)).json
check("the owner sees the assignment and its problem", work?.some?.((w) => w.kind === "assignment" && w.id === asgId && w.problems[0]?.id === problemId), JSON.stringify(work).slice(0, 200))
check("a student can't check anything", (await a1(`${O}/plagiarism`)).status === 403)
const req = { work: { kind: "assignment", id: asgId }, problemId, threshold: 0.6 }
const all = (await owner(`${O}/plagiarism`, { body: req })).json
const ids = (r) => (r?.pairs ?? []).flatMap((p) => [p.a.submissionId, p.b.submissionId])
check("the owner's check compares every student of the assignment", all?.compared === 4 && ids(all).includes(sub.a1) && ids(all).includes(sub.b1), JSON.stringify(all).slice(0, 300))
check("a different approach isn't flagged; someone outside it never compared", !ids(all).includes(sub.a3) && !ids(all).includes(sub.x))
const mine = (await teacher(`${O}/plagiarism`, { body: req })).json
check("a section's teacher compares only their own students", mine?.compared === 3 && ids(mine).includes(sub.a2) && !ids(mine).includes(sub.b1), JSON.stringify(mine).slice(0, 300))

// ---------- side by side
const pair = (await teacher(`${O}/plagiarism`, { body: { ...req, compare: { a: sub.a1, b: sub.a2 } } })).json?.pair
check("comparing a pair gives both programs and the stretch they share", pair?.a.code === ORIGINAL && pair?.b.code === COPIED && pair.regions.length >= 1 && pair.regions[0].b.from >= 3, JSON.stringify(pair?.regions))
check("not a student outside the teacher's sections", (await teacher(`${O}/plagiarism`, { body: { ...req, compare: { a: sub.a1, b: sub.b1 } } })).status === 404)
check("not someone outside the assignment", (await owner(`${O}/plagiarism`, { body: { ...req, compare: { a: sub.a1, b: sub.x } } })).status === 404)
check("not another organization's assignment", (await owner(`${O}/plagiarism`, { body: { ...req, work: { kind: "assignment", id: "00000000-0000-4000-8000-000000000000" } } })).status === 404)
const logged = psql(`select string_agg(action, ',' order by created_at) from audit_log where org_id='${orgId}' and action like 'plagiarism.%'`)
check("checks and comparisons are in the activity log", logged.includes("plagiarism.check") && logged.includes("plagiarism.compare"), logged)

// ---------- the platform's check
const plat = (await admin("/admin/similarity", { body: { problemSlug: "pl-pairs", contestSlug: null, threshold: 0.6 } })).json
check("the platform's check sees everyone's code for the problem", plat?.compared === 5 && ids(plat).includes(sub.x), JSON.stringify(plat).slice(0, 200))
check("and compares a pair side by side", (await admin("/admin/similarity", { body: { problemSlug: "pl-pairs", contestSlug: null, threshold: 0.6, compare: { a: sub.a1, b: sub.x } } })).json?.pair?.regions?.length >= 1)
check("a student can't use the platform's check", (await a1("/admin/similarity", { body: { problemSlug: "pl-pairs", contestSlug: null, threshold: 0.6 } })).status === 403)

// ---------- the pages
const browser = await chromium.launch()
const errors = []
const as = async (h, viewport = { width: 1440, height: 900 }) => {
  const ctx = await browser.newContext({ viewport })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email: `${h}@example.com` }, secret: SECRET }), url: BASE }])
  const page = await ctx.newPage()
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)))
  return page
}
try {
  for (const [name, viewport] of [["laptop", { width: 1440, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
    const p = await as("pl-o", viewport)
    await p.goto(`${BASE}/orgs/pl-school/manage/plagiarism`)
    await p.getByTestId("org-plagiarism").waitFor({ timeout: 30000 })
    await p.getByLabel("Assignment or contest").selectOption({ label: "Pl Week" })
    await p.getByLabel("Problem").selectOption({ label: "Pl Best Pair" })
    await p.getByRole("button", { name: "Check", exact: true }).click()
    await p.getByRole("button", { name: "Compare" }).first().click()
    await p.getByTestId("compare-sheet").getByTestId("pane-b").waitFor({ timeout: 15000 })
    const marked = await p.getByTestId("compare-sheet").locator("[data-match]").count()
    check(`${name}: Compare opens both programs with the matching lines marked`, marked >= 10, String(marked))
    if (name === "phone") check("phone: no sideways scrolling of the page", await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    await p.screenshot({ path: `${SHOTS}pl-compare-${name}.png` })
  }
  const nav = await as("pl-t")
  await nav.goto(`${BASE}/orgs/pl-school`)
  await nav.locator('nav[aria-label="Organization"]').waitFor({ timeout: 30000 })
  check("a teacher finds Plagiarism check in the sidebar", (await nav.locator('nav[aria-label="Organization"]').getByRole("link", { name: "Plagiarism check" }).count()) === 1)
  check("no page errors", errors.length === 0, errors.join(" | "))
} finally {
  await browser.close()
  cleanup()
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll plagiarism checks passed")
process.exit(failures ? 1 : 0)
