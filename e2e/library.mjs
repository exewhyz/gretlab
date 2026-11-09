/**
 * The library: sharing the platform's content with every college, chosen ones or nobody;
 * colleges seeing only what reaches them, copying it, and grouping it into collections.
 *   node e2e/library.mjs [base-url] [screenshot-dir]
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

const cleanup = () => {
  psql(`delete from collections where name like 'lib %'`)
  psql(`delete from content_shares where item_id in (select id from questions where title like 'lib %' union select id from problems where slug like 'lib-%')`)
  psql(`delete from questions where title like 'lib %'`)
  psql(`delete from test_cases where problem_id in (select id from problems where slug like 'lib-%')`)
  psql(`delete from problem_tags where problem_id in (select id from problems where slug like 'lib-%')`)
  psql(`delete from problems where slug like 'lib-%'`)
  psql(`delete from organizations where slug like 'libtest-%'`)
  psql(`delete from users where email like 'lib-%'`)
}
cleanup()
for (const email of ["lib-a@example.com", "lib-b@example.com", "lib-solo@example.com"]) {
  const h = email.split("@")[0]
  psql(`insert into users(email,name,role,handle) values ('${email}','${h}','student','${h}')`)
}
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const [admin, a, b] = await Promise.all(["admin@example.com", "lib-a@example.com", "lib-b@example.com"].map(client))
for (const [slug, owner] of [["libtest-a", "lib-a@example.com"], ["libtest-b", "lib-b@example.com"]]) {
  const r = await admin("/admin/organizations", { body: { name: `Lib ${slug.slice(-1).toUpperCase()} College`, slug, type: "college", ownerEmail: owner } })
  check(`college ${slug} created`, r.status === 200, JSON.stringify(r.json).slice(0, 150))
}
const orgA = psql(`select id from organizations where slug='libtest-a'`)

// ---------- the platform's questions and how far they reach
const q = (title) => ({ title, kind: "single", prompt: "Pick A.", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], correct: ["a"], points: 1 })
const made = {}
for (const t of ["lib Everyone", "lib Chosen", "lib Staff"]) {
  const r = await admin("/admin/questions", { body: q(t) })
  made[t] = r.json?.id
}
check("the platform writes questions", Object.values(made).every(Boolean))
const share = (items, sharing, extra = {}) => admin("/admin/library/sharing", { method: "PUT", body: { items: items.map((id) => ({ kind: "question", id })), sharing, ...extra } })
check("shares one with a chosen college", (await share([made["lib Chosen"]], "selected", { orgIds: [orgA] })).status === 200)
check("keeps one to staff", (await share([made["lib Staff"]], "owner")).status === 200)
check("refuses unknown people", (await share([made["lib Staff"]], "selected", { emails: ["nobody-lib@example.com"] })).json?.error?.code === "unknown_person")
const shared = (await admin(`/admin/library/sharing?kind=question&id=${made["lib Chosen"]}`)).json
check("says who an item is shared with", shared?.current?.orgIds?.length === 1 && shared.current.orgIds[0] === orgA && shared.colleges.some((c) => c.id === orgA))

const titles = async (api, slug) => ((await api(`/orgs/${slug}/library`)).json?.questions ?? []).map((x) => x.title)
const seenA = await titles(a, "libtest-a")
const seenB = await titles(b, "libtest-b")
check("the chosen college sees what's shared with it", seenA.includes("lib Everyone") && seenA.includes("lib Chosen") && !seenA.includes("lib Staff"), seenA.filter((t) => t.startsWith("lib")).join(", "))
check("other colleges don't", seenB.includes("lib Everyone") && !seenB.includes("lib Chosen") && !seenB.includes("lib Staff"))
const pickerB = ((await b("/orgs/libtest-b/questions?for=picker")).json ?? []).map((x) => x.title ?? x.question?.title)
check("the question picker follows sharing", !pickerB.includes("lib Chosen") && !pickerB.includes("lib Staff"))
check("sharing with a teacher by email", (await share([made["lib Staff"]], "selected", { emails: ["lib-b@example.com"] })).status === 200 && (await titles(b, "libtest-b")).includes("lib Staff"))
await share([made["lib Staff"]], "owner")
check("and taking it back", !(await titles(b, "libtest-b")).includes("lib Staff"))
check("only staff with the sharing permission share", (await a("/admin/library/sharing", { method: "PUT", body: { items: [{ kind: "question", id: made["lib Everyone"] }], sharing: "owner" } })).status === 403)

// ---------- a college's own content stays its own
const own = await a("/orgs/libtest-a/questions", { body: q("lib A's own") })
check("a college writes its own question", own.status === 200)
check("other colleges never see it", !(await titles(b, "libtest-b")).includes("lib A's own") && (await titles(a, "libtest-a")).includes("lib A's own"))
check("a college can't share from the platform's page", (await a("/admin/library/sharing", { method: "PUT", body: { items: [{ kind: "question", id: own.json.id }], sharing: "everyone" } })).status === 403)

// ---------- copying
const copied = await a("/orgs/libtest-a/library/copy", { body: { items: [{ kind: "question", id: made["lib Chosen"] }] } })
check("a college copies a shared item to adapt it", copied.status === 200 && copied.json?.created?.length === 1)
const lib = (await a("/orgs/libtest-a/library")).json
const copy = lib.questions.find((x) => x.id === copied.json.created[0].id)
check("the copy is theirs, private, and remembers its source", copy?.source === "ours" && copy.sharing === "owner" && copy.copiedFrom === made["lib Chosen"])
check("nobody copies what isn't shared with them", (await b("/orgs/libtest-b/library/copy", { body: { items: [{ kind: "question", id: made["lib Chosen"] }] } })).status === 404)
const someProblem = lib.problems.find((p) => p.source === "platform" && p.published)
if (someProblem) {
  const pc = await a("/orgs/libtest-a/library/copy", { body: { items: [{ kind: "problem", id: someProblem.id }] } })
  const row = pc.json?.created?.[0]
  check("copying a problem makes a draft with its tests", pc.status === 200 && psql(`select published from problems where id='${row?.id}'`) === "f" && Number(psql(`select count(*) from test_cases where problem_id='${row?.id}'`)) > 0, JSON.stringify(pc.json).slice(0, 150))
  psql(`update problems set slug = 'lib-' || slug where id='${row?.id}'`)
}

// ---------- collections
const col = await a("/orgs/libtest-a/collections", { body: { name: "lib Mid-sem" } })
check("a college makes a collection", col.status === 200 && !!col.json?.id)
check("adds items it can use", (await a(`/orgs/libtest-a/collections/${col.json.id}`, { method: "PATCH", body: { add: [{ kind: "question", id: made["lib Everyone"] }, { kind: "question", id: own.json.id }] } })).status === 200)
check("but not items it can't", (await a(`/orgs/libtest-a/collections/${col.json.id}`, { method: "PATCH", body: { add: [{ kind: "question", id: made["lib Staff"] }] } })).json?.error?.code === "not_shared")
const after = (await a("/orgs/libtest-a/library")).json
check("the library shows collections and their items", after.collections.find((c) => c.id === col.json.id)?.size === 2 && after.questions.find((x) => x.id === own.json.id)?.collections.includes(col.json.id))
check("other colleges can't touch it", (await b(`/orgs/libtest-b/collections/${col.json.id}`, { method: "DELETE" })).status === 404)
check("taking items out", (await a(`/orgs/libtest-a/collections/${col.json.id}`, { method: "PATCH", body: { remove: [{ kind: "question", id: own.json.id }] } })).status === 200 && (await a("/orgs/libtest-a/library")).json.collections.find((c) => c.id === col.json.id)?.size === 1)

// ---------- the pages
const browser = await chromium.launch()
const open = async (email) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), url: BASE }])
  return ctx.newPage()
}
const page = await open("admin@example.com")
await page.goto(`${BASE}/admin/library`)
await page.getByRole("tab", { name: /Questions/ }).click({ timeout: 30000 })
await page.getByLabel("Search the library").fill("lib ")
await page.getByTestId("library-row").first().waitFor({ timeout: 15000 })
check("the platform's library lists its questions with their reach", (await page.getByTestId("library-row").filter({ hasText: "lib Staff" }).getByTestId("sharing-cell").innerText()) === "Staff only")
await page.getByRole("checkbox", { name: "Select lib Staff" }).click()
await page.getByRole("button", { name: "Share…" }).click()
const dialog = page.getByTestId("share-dialog")
await dialog.getByRole("radio", { name: "Chosen colleges and teachers" }).click()
await dialog.getByRole("checkbox", { name: "Lib B College" }).click()
await page.waitForTimeout(300)
await page.screenshot({ path: SHOTS + "library-share.png", fullPage: true })
await dialog.getByRole("button", { name: "Save sharing" }).click()
await dialog.waitFor({ state: "hidden", timeout: 15000 })
check("sharing from the page reaches the college", (await titles(b, "libtest-b")).includes("lib Staff"))
await page.screenshot({ path: SHOTS + "library-platform.png", fullPage: true })

const college = await open("lib-a@example.com")
await college.goto(`${BASE}/orgs/libtest-a/manage/library`)
await college.getByRole("tab", { name: /Questions/ }).click({ timeout: 30000 })
await college.getByTestId("collections").getByRole("button", { name: /lib Mid-sem/ }).click()
await college.getByTestId("library-row").first().waitFor({ timeout: 15000 })
check("a collection filters the list", (await college.getByTestId("library-row").count()) === 1)
await college.getByTestId("collections").getByRole("button", { name: /Everything/ }).click()
await college.getByLabel("Source").selectOption("platform")
await college.getByLabel("Search the library").fill("lib Everyone")
await college.getByRole("checkbox", { name: "Select lib Everyone" }).click()
await college.getByRole("button", { name: "Copy to our library" }).click()
await college.getByText(/Copied 1 into your library/).waitFor({ timeout: 15000 })
check("a college copies from its page", psql(`select count(*) from questions where org_id='${orgA}' and title='lib Everyone'`) === "1")
await college.getByLabel("Source").selectOption("")
await college.getByLabel("Search the library").fill("lib")
await college.waitForTimeout(300)
await college.screenshot({ path: SHOTS + "library-college.png", fullPage: true })
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
