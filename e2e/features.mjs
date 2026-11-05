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
const board = (await b("/leaderboard")).json
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
await s.getByRole("button", { name: "Show editorial and solution" }).click()
await s.getByRole("button", { name: "Show editorial" }).click()
await s.getByRole("heading", { name: "Editorial" }).waitFor({ timeout: 15000 })
check("editorial shows after solving, with code", await s.locator("article pre").filter({ hasText: "print(a // b)" }).isVisible())
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
