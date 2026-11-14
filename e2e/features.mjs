/**
 * The LeetCode-style features: library, daily challenge, streaks, notes, lists, study plans,
 * profiles, leaderboard, hints, editorials, plagiarism checks, editor extras and their switches.
 *   node e2e/features.mjs [base-url] [screenshot-dir]
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
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? "  -- " + String(detail).slice(0, 200) : ""}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()
const PEOPLE = [["feat-a@example.com", "student", "feat-a"], ["feat-b@example.com", "student", "feat-b"], ["feat-c@example.com", "student", "feat-c"], ["admin@example.com", "admin", "admin"]]
psql(`delete from submissions where user_id in (select id from users where email like 'feat-%')`)
psql(`delete from problem_lists where owner_id in (select id from users where email like 'feat-%') or title like 'Feature Plan%'`)
psql(`delete from problem_notes where user_id in (select id from users where email like 'feat-%')`)
psql(`delete from daily_challenges`)
psql(`delete from settings where key in ('lists.enabled','profiles.enabled','site.timezone','practice.solutions_after_solve','submissions.per_minute')`)
for (const [email, role, handle] of PEOPLE) {
  psql(`insert into users(email,name,role,handle) values ('${email}','${handle}','${role}','${handle}') on conflict (email) do update set role='${role}', handle='${handle}', disabled=false`)
}
psql(`update problems set hints='[]', editorial='' where slug='p2'`)

const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const [a, b, c, admin, anon] = await Promise.all([client("feat-a@example.com"), client("feat-b@example.com"), client("feat-c@example.com"), client("admin@example.com"), (async () => async (p) => { const r = await fetch(BASE + "/api/v1" + p); return { status: r.status, json: await r.json().catch(() => null) } })()])
await admin("/admin/settings", { method: "PATCH", body: { "submissions.per_minute": 600 } })
const settle = async (api, id) => {
  for (let i = 0; i < 600; i++) {
    const r = await api(`/submissions/${id}`)
    if (r.json?.status === "done") return r.json
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error("timeout")
}
const submit = async (api, slug, code) => settle(api, (await api("/submissions", { body: { kind: "submit", language: "python", entry: "main.py", files: [{ path: "main.py", content: code }], problemSlug: slug } })).json.id)
const SI = 'principal = float(input())\nrate = float(input())\ntime = float(input())\nsi = principal * rate * time / 100\nprint(f"Simple Interest: {si:.2f}")\nprint(f"Total Amount: {principal + si:.2f}")\n'
const SI_RENAMED = '# done by myself\np = float(input())\nr = float(input())\nt = float(input())\n\ninterest = p * r * t / 100   # formula\nprint(f"Simple Interest: {interest:.2f}")\nprint(f"Total Amount: {p + interest:.2f}")\n'
const SI_OTHER = 'vals = [float(input()) for _ in range(3)]\nfrom functools import reduce\nprod = reduce(lambda x, y: x * y, vals) / 100\nfor label, v in (("Simple Interest", prod), ("Total Amount", vals[0] + prod)):\n    print(label + ": " + format(v, ".2f"))\n'

// ---------- admin authors hints, tags and an editorial
const p2 = (await admin("/admin/problems")).json.problems.find((p) => p.slug === "p2")
const full = (await admin(`/admin/problems/${p2.id}`)).json
const saved = await admin(`/admin/problems/${p2.id}`, { method: "PUT", body: { ...full, tests: full.tests.map(({ input, expected, isSample, points }) => ({ input, expected, isSample, points })), hints: ["Python has an operator for each one.", "Watch out: `//` rounds toward negative infinity."], editorial: "Use each operator once.\n\n```\nprint(a // b)\n```", tags: ["Operators", "Math"] } })
check("admin saves hints, tags and an editorial", saved.status === 200, JSON.stringify(saved.json).slice(0, 120))
const p2view = (await anon("/problems/p2")).json
check("problem shows its hints and tags", p2view.hints.length === 2 && p2view.tags.map((t) => t.name).includes("Math"))
check("editorial isn't in the public problem", !JSON.stringify(p2view).includes("Use each operator once"))
const locked = await a("/problems/p2/solution")
check("editorial locked until solved", locked.status === 403 && locked.json.error.code === "solve_first", locked.status)
const p2sol = 'a=int(input())\nb=int(input())\nprint(f"Sum: {a+b}")\nprint(f"Difference: {a-b}")\nprint(f"Product: {a*b}")\nprint(f"Division: {a/b:.2f}")\nprint(f"Floor Division: {a//b}")\nprint(f"Modulus: {a%b}")\n'
check("solve it", (await submit(a, "p2", p2sol)).verdict === "AC")
const opened = await a("/problems/p2/solution")
check("editorial unlocks after solving", opened.status === 200 && opened.json.editorial.includes("Use each operator once"))

// ---------- code per language: starter, reference solutions, driver
const withCode = (await admin(`/admin/problems/${p2.id}`)).json
const codeSaved = await admin(`/admin/problems/${p2.id}`, { method: "PUT", body: { ...withCode, solution: "", code: { python: { starter: "# Read a and b, then print each result\n", solution: p2sol }, javascript: { solution: "// the same, in JavaScript\n" } }, tests: withCode.tests.map(({ input, expected, isSample, points }) => ({ input, expected, isSample, points })) } })
check("a problem keeps code per language", codeSaved.status === 200 && (await admin(`/admin/problems/${p2.id}`)).json.code.javascript?.solution?.includes("JavaScript"), JSON.stringify(codeSaved.json).slice(0, 160))
const p2public = (await anon("/problems/p2")).json
check("its starter code reaches the problem page", p2public.starters?.python?.startsWith("# Read a and b"))
check("its solutions don't", !JSON.stringify(p2public).includes("the same, in JavaScript") && !JSON.stringify(p2public).includes("Floor Division: {a//b}"))
const bothSolutions = (await a("/problems/p2/solution")).json
check("the editorial has a solution for each language", bothSolutions.solutions?.map((x) => x.language).sort().join() === "javascript,python", JSON.stringify(bothSolutions.solutions?.map((x) => x.language)))
const addProblem = await admin("/admin/problems", { body: { slug: "feat-driver", title: "Add Two", unitId: null, level: "easy", statement: ["Write `add(a, b)`."], inputFormat: [], outputFormat: [], constraints: [], timeLimitMs: null, memoryLimitMb: null, allowedLanguages: null, published: true, code: { python: { starter: "def add(a, b):\n    pass\n", solution: "def add(a, b):\n    return a + b\n", driver: "a, b = map(int, input().split())\nprint(add(a, b))" } }, tests: [{ input: "2 3", expected: "5", isSample: true, points: 1 }, { input: "40 2", expected: "42", isSample: false, points: 1 }] } })
check("a separate driver from an older caller is folded into the starter", addProblem.status === 200 && (await anon("/problems/feat-driver")).json.starters.python === "def add(a, b):\n    pass\n\n\na, b = map(int, input().split())\nprint(add(a, b))\n", JSON.stringify((await anon("/problems/feat-driver")).json.starters))
check("the function with the driver after it is judged", (await submit(admin, "feat-driver", "def add(a, b):\n    return a + b\n\n\na, b = map(int, input().split())\nprint(add(a, b))\n")).verdict === "AC")
check("nothing is added to what the student runs", (await submit(admin, "feat-driver", "def add(a, b):\n    return a + b\n")).verdict === "WA")

// ---------- problems are markdown
const mdProblem = await admin("/admin/problems", { body: { slug: "feat-markdown", title: "Markdown Problem", unitId: null, level: "easy", description: "Print **the sum**.\n\n### Example\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n<script>window.pwned = 1</script>", inputFormat: ["Two numbers `a` and `b`"], outputFormat: ["Their sum"], timeLimitMs: null, memoryLimitMb: null, allowedLanguages: null, published: true, tests: [{ input: "1 2", expected: "3", isSample: true, points: 1 }] } })
check("a problem can be written in markdown", mdProblem.status === 200, JSON.stringify(mdProblem.json).slice(0, 160))
const legacyMade = await admin("/admin/problems", { body: { slug: "feat-legacy", title: "Old Style", unitId: null, level: "easy", statement: ["Print `x`."], inputFormat: ["Line 1: `x`"], outputFormat: [], constraints: [], timeLimitMs: null, memoryLimitMb: null, allowedLanguages: null, published: true, tests: [{ input: "1", expected: "1", isSample: true, points: 1 }] } })
const legacyView = (await anon("/problems/feat-legacy")).json
check("older callers' statement blocks become markdown, the format stays separate", legacyView.description === "Print `x`." && legacyView.input.join() === "Line 1: `x`", JSON.stringify([legacyView.description, legacyView.input]))

// ---------- library
const catalog = (await anon("/catalog")).json
check("library lists published problems with stats", catalog.problems.length >= 30 && catalog.problems.find((p) => p.id === "p2").acceptance !== undefined)
check("library has topic tags with counts", catalog.tags.some((t) => t.name === "Math" && t.count >= 1))
check("acceptance reflects submissions", (await (async () => { await new Promise((r) => setTimeout(r, 100)); return true })()))

// ---------- daily challenge and streaks
const today = (await a("/daily")).json
check("a daily challenge is picked automatically", Boolean(today?.slug), JSON.stringify(today))
const schedule = await admin("/admin/daily", { method: "PUT", body: { day: today.day, problemSlug: "p1" } })
check("admin schedules today's challenge", schedule.status === 200)
await new Promise((r) => setTimeout(r, 300))
check("the schedule takes effect", (await a("/daily")).json.slug === "p1")
check("students can't schedule", (await a("/admin/daily", { method: "PUT", body: { day: today.day, problemSlug: "p3" } })).status === 403)
check("not solved yet today", (await a("/daily")).json.solvedToday === false)
check("SI solved", (await submit(a, "p1", SI)).verdict === "AC")
const after = (await a("/daily")).json
check("solving it marks today done and starts a streak", after.solvedToday === true && after.streak === 1, JSON.stringify(after))
const yesterday = new Date(Date.parse(today.day + "T12:00:00Z") - 86_400_000).toISOString().slice(0, 10)
psql(`update submissions set created_at = '${yesterday}T12:00:00Z' where id = (select id from submissions where user_id=(select id from users where email='feat-a@example.com') and verdict='AC' and problem_id=(select id from problems where slug='p2') limit 1)`)
check("a solve yesterday extends the streak to 2", (await a("/daily")).json.streak === 2, (await a("/daily")).json.streak)
// Questions for the day, several, beside the problem or alone.
const mkq = async (title, kind, extra) => (await admin("/admin/questions", { body: { title, kind, prompt: `${title}?`, points: 1, explanation: "Count them.", ...extra } })).json
const dq1 = await mkq("feat daily q1", "single", { options: [{ id: "a", text: "3" }, { id: "b", text: "4" }], correct: ["b"] })
const dq2 = await mkq("feat daily q2", "short", { accepted: ["seven"] })
const written = await mkq("feat daily written", "written", {})
check("daily questions must mark themselves", (await admin("/admin/daily", { method: "PUT", body: { day: today.day, problemSlug: "p1", questionIds: [dq1.id, written.id] } })).json?.error?.code === "needs_marking")
check("at most ten a day", (await admin("/admin/daily", { method: "PUT", body: { day: today.day, problemSlug: "p1", questionIds: Array(11).fill(dq1.id).map((_, i) => `00000000-0000-4000-8000-00000000000${i % 10}`) } })).status === 400)
await admin("/admin/daily", { method: "PUT", body: { day: today.day, problemSlug: "p1", questionIds: [dq1.id, dq2.id] } })
const withQ = (await b("/daily")).json
check("a day can have a problem and several questions", withQ.problem?.slug === "p1" && withQ.questions.map((q) => q.title).join() === "feat daily q1,feat daily q2" && withQ.questions.every((q) => q.solution === null))
const dailyAnswer = (await b("/daily/answer", { body: { questionId: dq1.id, answer: ["b"] } })).json
check("answering shows right or wrong and why, at once", dailyAnswer.correct === true && dailyAnswer.solution.explanation === "Count them.")
check("once per question", (await b("/daily/answer", { body: { questionId: dq1.id, answer: ["a"] } })).json?.error?.code === "already_answered")
check("each question answered on its own", (await b("/daily/answer", { body: { questionId: dq2.id, answer: "Seven." } })).json?.correct === true)
check("only today's questions", (await b("/daily/answer", { body: { questionId: written.id, answer: "x" } })).status === 404)
check("a right answer keeps the streak", (await b("/daily")).json.streak >= 1)
await admin("/admin/daily", { method: "PUT", body: { day: today.day, problemSlug: null, questionIds: [dq2.id] } })
const qOnly = (await c("/daily")).json
check("or questions alone", qOnly.problem === null && qOnly.questions.length === 1)
await admin("/admin/daily", { method: "PUT", body: { day: today.day, problemSlug: "p1" } })
psql(`delete from daily_answers where question_id in ('${dq1.id}','${dq2.id}','${written.id}')`)
psql(`delete from questions where id in ('${dq1.id}','${dq2.id}','${written.id}')`)
// ---------- units: the library's outline
const unitsBefore = (await admin("/admin/units")).json
check("students can't manage units", (await a("/admin/units")).status === 403)
const ua = (await admin("/admin/units", { body: { name: "feat unit a" } })).json
const ub = (await admin("/admin/units", { body: { name: "feat unit b" } })).json
const ids = (await admin("/admin/units")).json.units.map((u) => u.id)
check("new units go last", ids.at(-2) === ua.id && ids.at(-1) === ub.id)
check("reordering lists every unit", (await admin("/admin/units", { method: "PUT", body: { ids: [ub.id, ua.id] } })).json?.error?.code === "bad_order")
await admin("/admin/units", { method: "PUT", body: { ids: [...ids.slice(0, -2), ub.id, ua.id] } })
check("units reorder", (await admin("/admin/units")).json.units.map((u) => u.id).slice(-2).join() === `${ub.id},${ua.id}` && (await admin("/admin/units")).json.units.length === unitsBefore.units.length + 2)
check("units rename", (await admin(`/admin/units/${ua.id}`, { method: "PATCH", body: { name: "feat unit A" } })).status === 200 && (await admin("/admin/units")).json.units.some((u) => u.name === "feat unit A"))
const two = (await admin("/admin/problems/import", { body: { file: [1, 2].map((n) => ({ title: `feat unit problem ${n}`, statement: "Print 1.", samples: [{ input: "", output: "1" }] })), listed: true, published: false } })).json.created
psql(`update problems set unit_id = '${ua.id}' where id in ('${two[0].id}','${two[1].id}')`)
check("a unit's problems keep their order", (await admin(`/admin/units/${ua.id}`, { method: "PATCH", body: { problemIds: [two[1].id, two[0].id] } })).status === 200 && (await admin("/admin/units")).json.units.find((u) => u.id === ua.id).problems.map((p) => p.id).join() === `${two[1].id},${two[0].id}`)
await admin(`/admin/units/${ua.id}`, { method: "PATCH", body: { problemIds: [two[0].id], moves: { [two[1].id]: ub.id } } })
const afterMove = (await admin("/admin/units")).json.units
check("a problem moves to another unit", afterMove.find((u) => u.id === ua.id).problems.length === 1 && afterMove.find((u) => u.id === ub.id).problems[0]?.id === two[1].id)
await admin(`/admin/units/${ua.id}`, { method: "PATCH", body: { problemIds: [two[0].id, two[1].id] } })
check("adding a problem from another unit takes it out of that one", (await admin("/admin/units")).json.units.find((u) => u.id === ub.id).problems.length === 0 && (await admin("/admin/units")).json.units.find((u) => u.id === ua.id).problems.length === 2)
await admin(`/admin/units/${ua.id}`, { method: "PATCH", body: { problemIds: [two[0].id] } })
check("left out without a destination: no unit", psql(`select unit_id is null from problems where id = '${two[1].id}'`) === "t")
await admin(`/admin/units/${ua.id}`, { method: "PATCH", body: { problemIds: [two[0].id, two[1].id] } })
check("only the platform's problems go in units", (await admin(`/admin/units/${ua.id}`, { method: "PATCH", body: { problemIds: ["00000000-0000-4000-8000-000000000000"] } })).json?.error?.code === "unknown_problem")
check("deleting a unit moves its problems where you say", (await admin(`/admin/units/${ua.id}?moveTo=${ub.id}`, { method: "DELETE" })).status === 200 && (await admin("/admin/units")).json.units.find((u) => u.id === ub.id).problems.length === 2)
check("or to no unit", (await admin(`/admin/units/${ub.id}`, { method: "DELETE" })).status === 200 && psql(`select count(*) from problems where id in ('${two[0].id}','${two[1].id}') and unit_id is null`) === "2")
psql(`delete from problems where id in ('${two[0].id}','${two[1].id}')`)
check("an invalid timezone is refused", (await admin("/admin/settings", { method: "PATCH", body: { "site.timezone": "Mars/Base" } })).status === 400)

// ---------- notes stay private
check("save a note", (await a("/problems/p1/note", { method: "PUT", body: { text: "remember to round" } })).status === 200)
check("read it back", (await a("/problems/p1/note")).json.text === "remember to round")
check("another student sees only their own (empty) note", (await b("/problems/p1/note")).json.text === "")
check("anonymous can't read notes", (await anon("/problems/p1/note")).status === 401)

// ---------- lists
const lists = (await a("/lists")).json
const favorites = lists.find((l) => l.kind === "favorites")
check("everyone gets a favorites list", Boolean(favorites))
check("favorite a problem", (await a(`/lists/${favorites.slug}/items`, { method: "PUT", body: { problemSlug: "p3", member: true } })).status === 200)
const custom = (await a("/lists", { body: { title: "Revision" } })).json
await a(`/lists/${custom.slug}/items`, { method: "PUT", body: { problemSlug: "p1", member: true } })
await a(`/lists/${custom.slug}/items`, { method: "PUT", body: { problemSlug: "p5", member: true } })
const membership = (await a("/problems/p1/lists")).json
check("membership shows which lists hold a problem", membership.find((m) => m.slug === custom.slug).contains === true && membership.find((m) => m.kind === "favorites").contains === false)
check("a private list is hidden from others", (await b(`/lists/${custom.slug}`)).status === 404)
check("others can't change it", (await b(`/lists/${custom.slug}/items`, { method: "PUT", body: { problemSlug: "p2", member: true } })).status === 404)
check("favorites can't be deleted", (await a(`/lists/${favorites.slug}`, { method: "DELETE" })).status === 400)
check("students can't create study plans", (await a("/lists", { body: { title: "Mine", kind: "study_plan" } })).status === 403)

// ---------- study plans
const plan = (await admin("/lists", { body: { title: "Feature Plan: basics", kind: "study_plan" } })).json
await admin(`/lists/${plan.slug}`, { method: "PATCH", body: { description: "Start here.", problemSlugs: ["p1", "p2", "p3"] } })
check("a draft plan is hidden from students", (await a(`/lists/${plan.slug}`)).status === 404)
await admin(`/lists/${plan.slug}`, { method: "PATCH", body: { published: true } })
const seen = (await a(`/lists/${plan.slug}`)).json
check("a published plan is visible, in order", seen.items.map((i) => i.slug).join() === "p1,p2,p3")
check("published plans appear in everyone's lists", (await b("/lists")).json.some((l) => l.slug === plan.slug))

// ---------- profiles and leaderboard
const profile = (await a("/users/feat-a")).json
check("profile: solved count by difficulty", profile.solved === 2 && profile.solvedBy.easy === 2, JSON.stringify(profile.solvedBy))
check("profile: streak and badges", profile.streak.current === 2 && profile.badges.some((x) => x.id === "first"))
check("profile: heatmap has activity", Object.values(profile.heatmap).reduce((s, n) => s + n, 0) >= 2)
check("profiles need sign-in", (await anon("/users/feat-a")).status === 401)
check("unknown profile 404", (await a("/users/nobody-here")).status === 404)
await new Promise((r) => setTimeout(r, 200))
const board = (await b("/leaderboard")).json?.rows ?? []
check("leaderboard lists solvers by count", board.some((r) => r.handle === "feat-a" && r.solved >= 2), JSON.stringify(board.slice(0, 3)))
check("leaderboard shows no emails", !JSON.stringify(board).includes("@"))

// ---------- integrity
await submit(b, "p1", SI_RENAMED)
await submit(c, "p1", SI_OTHER)
const sim = (await admin("/admin/similarity", { body: { problemSlug: "p1", contestSlug: null, threshold: 0.8 } })).json
const pair = sim.pairs.find((p) => [p.a.email, p.b.email].sort().join() === "feat-a@example.com,feat-b@example.com")
check("renamed copy is flagged", Boolean(pair) && pair.score >= 80, JSON.stringify(sim.pairs.map((p) => [p.a.email, p.b.email, p.score])))
check("a different approach isn't", !sim.pairs.some((p) => [p.a.email, p.b.email].includes("feat-c@example.com")))
check("students can't run integrity checks", (await a("/admin/similarity", { body: { problemSlug: "p1", contestSlug: null, threshold: 0.8 } })).status === 403)

// ---------- switches
await admin("/admin/settings", { method: "PATCH", body: { "lists.enabled": false, "profiles.enabled": false } })
await new Promise((r) => setTimeout(r, 5500))
check("lists off: refused", (await a("/lists")).status === 403)
check("profiles off: refused", (await a("/users/feat-a")).status === 403 && (await a("/leaderboard")).status === 403)
await admin("/admin/settings", { method: "PATCH", body: { "lists.enabled": true, "profiles.enabled": true } })

// ---------- the browser
const browser = await chromium.launch()
const errors = []
const open = async (email) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  if (email) await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), url: BASE }])
  const page = await ctx.newPage()
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)))
  page.on("console", async (m) => {
    if (m.type() !== "error" || /40\d|Failed to load/.test(m.text())) return
    const args = await Promise.all(m.args().map((arg) => arg.jsonValue().catch(() => "")))
    errors.push(`${page.url().replace(BASE, "")}: ${m.text().slice(0, 60)} [${String(args[1] ?? "").slice(0, 60)}] ${String(args.at(-1) ?? "").split("\n").slice(0, 3).join(" < ").slice(0, 160)}`)
  })
  return page
}
await new Promise((r) => setTimeout(r, 5500))
const s = await open("feat-a@example.com")
await s.goto(`${BASE}/problems`)
await s.getByTestId("problem-row").first().waitFor({ timeout: 30000 })
check("library page lists problems", (await s.getByTestId("problem-row").count()) >= 30)
await s.getByText("Daily challenge").first().waitFor({ timeout: 15000 })
check("daily card with streak", await s.getByTestId("streak").isVisible() && (await s.getByTestId("streak").textContent()).includes("2-day"))
await s.getByRole("link", { name: "Feature Plan: basics" }).waitFor({ timeout: 15000 }).catch(() => {})
check("study plan in the sidebar", await s.getByRole("link", { name: "Feature Plan: basics" }).isVisible())
await s.getByLabel("Search problems").fill("leap")
check("search filters", (await s.getByTestId("problem-row").count()) === 1)
await s.getByLabel("Search problems").fill("")
await s.getByRole("button", { name: /^Math ·/ }).click()
check("topic filter", (await s.getByTestId("problem-row").count()) === 1)
await s.getByRole("button", { name: "Clear filters" }).click()
await s.getByLabel("Status").selectOption("solved")
check("status filter shows your solved problems", (await s.getByTestId("problem-row").count()) === 2)
await s.getByLabel("Status").selectOption("")
await s.screenshot({ path: SHOTS + "library.png" })
check("up next points at an unsolved problem", await s.getByTestId("up-next").isVisible())
check("header marks the current section", (await s.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Problems" }).getAttribute("aria-current")) === "page")
await s.getByRole("button", { name: "Account" }).click()
// The menu opens with a short animation.
await s.getByRole("menuitem", { name: "My profile" }).waitFor({ timeout: 10000 }).catch(() => {})
check("account menu holds personal pages", await s.getByRole("menuitem", { name: "My profile" }).isVisible() && await s.getByRole("menuitem", { name: "My submissions" }).isVisible())
await s.keyboard.press("Escape")
await s.getByRole("menuitem", { name: "My profile" }).waitFor({ state: "hidden", timeout: 5000 }).catch(() => {})
check("account menu closes on Escape", !(await s.getByRole("menuitem", { name: "My profile" }).isVisible()))
const old = await fetch(`${BASE}/questions/p1`, { redirect: "manual" })
check("old /questions links redirect", old.status === 308 && old.headers.get("location")?.endsWith("/problems/p1"), old.status)

await s.goto(`${BASE}/problems/p2`)
await s.locator(".monaco-editor .view-line").first().waitFor({ timeout: 60000 })
check("tags on the problem", await s.locator("article").getByText("Operators", { exact: true }).isVisible())
await s.getByText("Hint 1").click()
check("hints reveal one at a time", await s.getByText("Python has an operator for each one.").isVisible() && !(await s.getByText("rounds toward negative infinity").isVisible()))
await s.getByRole("tab", { name: "Editorial" }).click()
await s.getByRole("button", { name: "Show the editorial" }).click()
await s.getByTestId("editorial").waitFor({ timeout: 15000 })
check("editorial has its own tab, with code", await s.getByTestId("editorial").locator("pre").filter({ hasText: "print(a // b)" }).first().isVisible())
check("reference solutions show by language", await s.getByTestId("editorial").getByRole("tab", { name: /JavaScript/ }).isVisible())
await s.screenshot({ path: SHOTS + "editorial-tab.png" })
await s.getByRole("tab", { name: "Problem", exact: true }).click()
await s.goto(`${BASE}/problems/feat-driver`)
await s.locator(".monaco-editor .view-line").first().waitFor({ timeout: 60000 })
const editorText = (await s.locator(".monaco-editor .view-lines").first().innerText()).replace(/\u00a0/g, " ")
check("the editor starts with that one starter, as normal code", editorText.indexOf("def add(a, b):") >= 0 && editorText.indexOf("print(add(a, b))") > editorText.indexOf("def add(a, b):"), editorText)
await admin(`/admin/problems/${addProblem.json.id}`, { method: "DELETE" })
await s.goto(`${BASE}/problems/feat-markdown`)
await s.getByTestId("markdown").first().waitFor({ timeout: 60000 })
const md = s.getByTestId("markdown").first()
check("markdown renders: bold, headings, tables", await md.locator("strong", { hasText: "the sum" }).isVisible() && await md.locator("h3", { hasText: "Example" }).isVisible() && (await md.locator("table td").count()) === 2)
check("input and output format sit outside the statement, under their own headings", (await s.getByTestId("problem-section").filter({ hasText: "Input Format" }).count()) === 1 && (await md.getByText("Two numbers").count()) === 0)
check("HTML in it is shown as text, never run", (await s.evaluate(() => window.pwned)) === undefined && (await md.locator("script").count()) === 0)
await s.screenshot({ path: SHOTS + "markdown-problem.png" })
await admin(`/admin/problems/${mdProblem.json.id}`, { method: "DELETE" })
await admin(`/admin/problems/${legacyMade.json.id}`, { method: "DELETE" })
await s.goto(`${BASE}/problems/p2`)
await s.locator(".monaco-editor .view-line").first().waitFor({ timeout: 60000 })
await s.getByRole("button", { name: /Favorite/ }).click()
await s.getByRole("button", { name: "★ Favorited" }).waitFor({ timeout: 10000 })
check("favorite toggles", true)
await s.getByRole("button", { name: "Save to list ▾" }).click()
await s.getByRole("menuitemcheckbox", { name: "Revision" }).click()
await s.getByRole("menuitemcheckbox", { name: "Revision", checked: true }).waitFor({ timeout: 10000 })
await s.waitForTimeout(500)
check("save to a list", (await a("/problems/p2/lists")).json.find((m) => m.title === "Revision").contains === true)
await s.keyboard.press("Escape")
await s.getByRole("tab", { name: "Notes" }).click()
await s.locator("#problem-note").waitFor()
await s.locator("#problem-note").fill("modulus sign follows the divisor")
await s.getByRole("status").filter({ hasText: "Saved" }).waitFor({ timeout: 10000 })
await s.reload()
await s.getByRole("tab", { name: "Notes" }).click()
await s.locator("#problem-note").waitFor()
await s.waitForFunction(() => document.querySelector("#problem-note")?.value === "modulus sign follows the divisor", null, { timeout: 10000 })
check("notes persist across reloads", true)
await s.getByRole("tab", { name: "Problem" }).click()
await s.getByRole("button", { name: "Start the stopwatch" }).click()
await s.waitForTimeout(1600)
check("stopwatch runs", /00:0[1-9]/.test(await s.getByTestId("stopwatch").textContent()))
await s.getByRole("button", { name: "Editor settings" }).click()
await s.getByLabel("Font size").selectOption("18")
await s.waitForTimeout(400)
check("editor font size applies", await s.evaluate(() => window.monaco.editor.getEditors()[0].getOption(window.monaco.editor.EditorOption.fontSize)) === 18)
await s.getByLabel("Font size").selectOption("13")
await s.screenshot({ path: SHOTS + "problem-extras.png" })

await s.goto(`${BASE}/u/feat-a`)
await s.getByTestId("solved-count").waitFor({ timeout: 15000 })
check("profile page: solved, streak, heatmap, badges", (await s.getByTestId("solved-count").textContent()) === "2" && (await s.getByTestId("current-streak").textContent()) === "2" && await s.getByRole("img", { name: /submissions in the past year/ }).isVisible() && await s.getByText("First Accepted").isVisible())
await s.screenshot({ path: SHOTS + "profile.png", fullPage: true })
await s.goto(`${BASE}/leaderboard`)
await s.getByRole("link", { name: "feat-a" }).waitFor({ timeout: 15000 })
check("leaderboard page", true)
await s.goto(`${BASE}/lists`)
await s.getByRole("link", { name: "★ Favorites" }).waitFor({ timeout: 15000 })
await s.getByRole("link", { name: "Feature Plan: basics" }).click()
await s.getByTestId("list-progress").waitFor({ timeout: 15000 })
check("study plan progress", (await s.getByTestId("list-progress").textContent()).includes("2 / 3"))
await s.screenshot({ path: SHOTS + "study-plan.png" })

const t = await open("admin@example.com")
await t.goto(`${BASE}/admin/integrity`)
await t.getByRole("heading", { name: "Plagiarism check" }).waitFor({ timeout: 15000 })
await t.locator("select").first().selectOption("p1")
await t.getByRole("button", { name: "Check" }).click()
await t.getByText(/pair\(s\) to review/).waitFor({ timeout: 15000 })
check("integrity page lists the pair", await t.getByRole("row").filter({ hasText: "feat-a@example.com" }).filter({ hasText: "feat-b@example.com" }).first().isVisible())
await t.screenshot({ path: SHOTS + "integrity.png" })
await t.goto(`${BASE}/admin/daily`)
await t.getByRole("heading", { name: "Daily challenge" }).waitFor({ timeout: 15000 })
check("daily schedule page shows 14 days", (await t.locator("main tbody tr").count()) === 14)
await t.goto(`${BASE}/admin/study-plans`)
await t.getByRole("cell", { name: "Feature Plan: basics" }).waitFor({ timeout: 15000 })
check("study plans admin page", true)
await t.goto(`${BASE}/admin/settings`)
await t.getByRole("switch", { name: "Daily challenge" }).waitFor({ timeout: 15000 })
check("new switches appear in Settings", await t.getByRole("switch", { name: "Favorites and lists" }).isVisible() && await t.getByLabel("Timezone").isVisible())

// Server execution off: a signed-in student isn't told to sign in; Submit is paused.
await admin("/admin/settings", { method: "PATCH", body: { "server_execution.enabled": false } })
const off = await open("feat-c@example.com")
await off.goto(`${BASE}/problems/p1`)
await off.getByText(/Server execution is turned off right now/).waitFor({ timeout: 30000 })
check("execution off: signed-in student not asked to sign in", (await off.getByText(/Sign in to submit/).count()) === 0)
check("execution off: Submit is paused", await off.getByRole("button", { name: "Submit", exact: true }).isDisabled())
await off.screenshot({ path: SHOTS + "execution-off.png" })
await admin("/admin/settings", { method: "PATCH", body: { "server_execution.enabled": true } })

check("no console or hydration errors", errors.length === 0, [...new Set(errors)].slice(0, 5).join(" || "))
await browser.close()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
