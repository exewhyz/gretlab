/**
 * The Library module: off until switched on, not for a company; the catalog (add, a list,
 * edit, copies can't drop below loans, no deleting books on loan); lending (has it, none
 * free, the per-person limit, due dates, members only); renew, return, lost; overdue on the
 * desk, in the bell and in the numbers; separate catalog and desk roles; what members and a
 * parent see; switching off; the audit; the pages, on a phone too.
 *   node e2e/books.mjs [base-url] [screenshot-dir]
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
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 240)}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()
const cleanup = () => {
  psql(`delete from organizations where slug in ('lib-school','lib-co')`)
  psql(`delete from users where email like 'lib-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
const people = ["lib-o", "lib-t", "lib-desk", "lib-cat", "lib-s1", "lib-s2", "lib-s3", "lib-out"]
for (const h of people) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h} Name','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Lib School", slug: "lib-school", type: "school", ownerEmail: "lib-o@example.com" } })
await admin("/admin/organizations", { body: { name: "Lib Co", slug: "lib-co", type: "company", ownerEmail: "lib-o@example.com" } })
const O = "/orgs/lib-school"
const orgId = psql(`select id from organizations where slug='lib-school'`)
const [owner, t, desk, cat, s1, s2, s3] = await Promise.all(people.slice(0, 7).map((h) => client(`${h}@example.com`)))
const cls = (await owner(`${O}/groups`, { body: { name: "Grade 5" } })).json
for (const h of people.slice(1, 7)) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
await owner(`${O}/groups/${cls.id}/members`, { body: { userIds: ["lib-s1", "lib-s2", "lib-s3"].map(uid) } })
const roles = (await owner(`${O}/roles`)).json
await owner(`${O}/members/${uid("lib-t")}/roles`, { body: { roleId: roles.find((r) => r.systemKey === "teacher").id, groupId: cls.id } })
const deskRole = (await owner(`${O}/roles`, { body: { name: "Library desk", permissions: ["library.lend"] } })).json
const catRole = (await owner(`${O}/roles`, { body: { name: "Cataloguer", permissions: ["library.catalog"] } })).json
await owner(`${O}/members/${uid("lib-desk")}/roles`, { body: { roleId: deskRole.id } })
await owner(`${O}/members/${uid("lib-cat")}/roles`, { body: { roleId: catRole.id } })

// ---------- the module
check("a school has the library off until it's switched on", (await owner(`${O}/books/setup`)).status === 404)
check("a company can't switch it on", (await owner("/orgs/lib-co", { method: "PATCH", body: { modules: { library: true } } })).json?.error?.code === "module_unavailable")
check("a school can", (await owner(O, { method: "PATCH", body: { modules: { library: true } } })).status === 200)
check("a teacher doesn't run the library", (await t(`${O}/books/setup`)).status === 403)

// ---------- the catalog
const add = (who, body) => who(`${O}/books`, { body })
const wings = await add(cat, { title: "Wings of Fire", author: "A. P. J. Abdul Kalam", category: "Biography", copies: 2 })
check("the cataloguer adds a book", wings.status === 200 && wings.json.copies === 2)
check("a book needs a title", (await add(cat, { title: " " })).status === 400)
check("the desk can't add books", (await add(desk, { title: "Nope" })).status === 403)
check("a student can't either", (await add(s1, { title: "Nope" })).status === 403)
const imp = (await cat(`${O}/books/import`, { body: { rows: [{ title: "Malgudi Days", author: "R. K. Narayan" }, { author: "No title" }, { title: "Godaan", copies: 1 }] } })).json
check("a list adds what has a title and reports the rest", imp?.added === 2 && imp.failed === 1 && imp.report[0].line === 2, JSON.stringify(imp))
const books = (await s1(`${O}/books?q=mal`)).json
check("members search the catalog", books?.length === 1 && books[0].title === "Malgudi Days" && books[0].available === 1)
check("someone outside can't", (await (await client("lib-out@example.com"))(`${O}/books`)).status === 404)
const malgudi = books[0], godaan = (await s1(`${O}/books?q=godaan`)).json[0]

// ---------- lending
const today = (await desk(`${O}/books/setup`)).json.today
const lend = (who, book, h, extra = {}) => who(`${O}/books/loans`, { body: { bookId: book.id, userId: uid(h), ...extra } })
const l1 = await lend(desk, wings.json, "lib-s1")
check("the desk lends a book, due in 14 days", l1.status === 200 && l1.json.dueOn > today, JSON.stringify(l1.json))
check("not the same book twice", (await lend(desk, wings.json, "lib-s1")).json?.error?.code === "has_it")
check("the second copy goes to another", (await lend(desk, wings.json, "lib-s2")).status === 200)
check("then none are free", (await lend(desk, wings.json, "lib-s3")).json?.error?.code === "unavailable")
check("the cataloguer can't lend", (await lend(cat, malgudi, "lib-s3")).status === 403)
check("the desk can't change the rules", (await desk(`${O}/books/settings`, { method: "PUT", body: { loanDays: 7, maxLoans: 1 } })).status === 403)
check("the cataloguer sets one book each", (await cat(`${O}/books/settings`, { method: "PUT", body: { loanDays: 7, maxLoans: 1 } })).status === 200)
check("so a second book is refused", (await lend(desk, malgudi, "lib-s1")).json?.error?.code === "limit")
check("a due date in the past is refused", (await lend(desk, malgudi, "lib-s3", { dueOn: "2020-01-01" })).json?.error?.code === "bad_due")
check("only members borrow", (await lend(desk, malgudi, "lib-out")).status === 404)
const l3 = await lend(desk, godaan, "lib-s3")
check("the new loan period applies", l3.status === 200 && l3.json.dueOn === psql(`select to_char('${today}'::date + 7, 'YYYY-MM-DD')`))

// ---------- the catalog and loans
check("copies can't drop below what's out", (await cat(`${O}/books/${wings.json.id}`, { method: "PUT", body: { title: "Wings of Fire", copies: 1 } })).json?.error?.code === "copies_out")
check("a book on loan can't be removed", (await cat(`${O}/books/${wings.json.id}`, { method: "DELETE" })).json?.error?.code === "on_loan")
const out = (await desk(`${O}/books/loans`)).json
check("the desk lists loans out", out?.length === 3)
const s2loan = out.find((l) => l.email === "lib-s2@example.com"), s1loan = out.find((l) => l.email === "lib-s1@example.com")
const renewed = (await desk(`${O}/books/loans/${s1loan.id}`, { body: { action: "renew" } })).json
check("renewing moves the due date on", renewed?.dueOn > s1loan.dueOn, JSON.stringify(renewed))
check("returning frees the copy", (await desk(`${O}/books/loans/${s2loan.id}`, { body: { action: "return" } })).status === 200 && (await s1(`${O}/books?q=wings`)).json[0].available === 1)
check("a closed loan can't be returned again", (await desk(`${O}/books/loans/${s2loan.id}`, { body: { action: "return" } })).json?.error?.code === "closed")
check("a lost book closes the loan and loses a copy", (await desk(`${O}/books/loans/${s1loan.id}`, { body: { action: "lost" } })).status === 200 && psql(`select copies from library_books where id='${wings.json.id}'`) === "1")

// ---------- overdue
psql(`update library_loans set due_on = to_char('${today}'::date - 3, 'YYYY-MM-DD') where user_id='${uid("lib-s3")}'`)
const overdue = (await desk(`${O}/books/loans?show=overdue`)).json
check("the desk sees what's overdue", overdue?.length === 1 && overdue[0].status === "overdue")
check("the numbers count it", (await owner(`${O}/books/setup`)).json?.counts.overdue === 1)
const bell = (await s3("/me/notifications")).json
check("the borrower's bell reminds them", bell?.reminders.some((r) => r.kind === "library_due" && r.title.includes("Godaan") && r.href === `${O}/books`), JSON.stringify(bell?.reminders))
const mine = (await s3(`${O}/books/mine`)).json
check("a member sees their books", mine?.loans.length === 1 && mine.loans[0].status === "overdue")
const campus = (await s3("/me/campus")).json
check("...and on My classes", campus?.find((c) => c.slug === "lib-school")?.library.loans.length === 1)
await owner(`${O}/parents`, { body: { studentId: uid("lib-s3"), email: "lib-parent@example.com" } })
const child = (await (await client("lib-parent@example.com"))(`${O}/children/${uid("lib-s3")}`)).json
check("a parent sees their child's books", child?.campus?.library?.loans[0]?.title === "Godaan", JSON.stringify(child?.campus))
const log = (await owner(`${O}/audit?limit=200`)).json.entries
check("the library is in the activity log", ["library.book_add", "library.import", "library.settings", "library.issue", "library.renew", "library.return", "library.lost"].every((a) => log.some((e) => e.action === a)))

// ---------- the pages
const browser = await chromium.launch()
const page = async (email, width = 1100) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
const op = await page("lib-o@example.com")
await op.goto(`${BASE}${O}/manage/books`)
await op.getByTestId("library-counts").waitFor({ timeout: 30000 })
check("the sidebar lists Books under Campus", /CAMPUS\s+Books/i.test(await op.locator('nav[aria-label="Organization"]').innerText()))
await op.getByRole("button", { name: "Lend a book" }).click()
const dlg = op.getByRole("dialog", { name: "Lend a book" })
await dlg.getByLabel("Borrower").fill("lib-s2")
await dlg.getByRole("button", { name: /lib-s2 Name/ }).click()
await dlg.getByLabel("Book").fill("Malgudi")
await dlg.getByRole("button", { name: /Malgudi Days/ }).click()
await dlg.getByRole("button", { name: "Lend", exact: true }).click()
await op.getByTestId("loan").filter({ hasText: "Malgudi Days" }).waitFor({ timeout: 15000 }).catch(() => {})
check("a book is lent from the dialog", psql(`select count(*) from library_loans l join library_books b on b.id=l.book_id where b.title='Malgudi Days' and l.status='out'`) === "1")
await op.getByTestId("loan").filter({ hasText: "Malgudi Days" }).getByRole("button", { name: "Return" }).click()
await op.getByTestId("loan").filter({ hasText: "Malgudi Days" }).waitFor({ state: "detached", timeout: 15000 }).catch(() => {})
check("...and taken back from the list", psql(`select count(*) from library_loans l join library_books b on b.id=l.book_id where b.title='Malgudi Days' and l.status='returned'`) === "1")
await op.getByRole("tab", { name: "Catalog" }).click()
await op.getByRole("button", { name: "Add book" }).click()
const bd = op.getByRole("dialog", { name: "Add book" })
await bd.getByLabel("Title").fill("Panchatantra")
await bd.getByLabel("Copies").fill("4")
await bd.getByRole("button", { name: "Save" }).click()
await op.getByTestId("book").filter({ hasText: "Panchatantra" }).waitFor({ timeout: 15000 }).catch(() => {})
check("a book is added from the catalog tab", (await op.getByTestId("book").filter({ hasText: "4 of 4 on the shelf" }).count()) === 1)
await op.screenshot({ path: SHOTS + "library.png", fullPage: true })

const sp = await page("lib-s3@example.com")
await sp.goto(`${BASE}/classes`)
await sp.getByTestId("campus").waitFor({ timeout: 30000 }).catch(() => {})
check("My classes shows the student's library books", (await sp.getByTestId("campus").innerText().catch(() => "")).includes("Overdue since"))
await sp.goto(`${BASE}${O}/books`)
await sp.getByTestId("my-loans").waitFor({ timeout: 30000 }).catch(() => {})
check("the member's library page lists their books and the catalog", (await sp.getByTestId("my-loans").innerText().catch(() => "")).includes("Godaan") && (await sp.getByTestId("book").count()) >= 3)
for (const [email, path] of [["lib-o@example.com", `${O}/manage/books`], ["lib-s3@example.com", `${O}/books`]]) {
  const phone = await page(email, 390)
  await phone.goto(BASE + path)
  await phone.waitForLoadState("networkidle")
  check(`no sideways scrolling on a phone: ${path.split("/").slice(3).join("/")}`, await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
}
await browser.close()

await owner(O, { method: "PATCH", body: { modules: { library: false } } })
check("switched off, members lose the library", (await s3(`${O}/books/mine`)).status === 404 && !(await s3("/me/notifications")).json.reminders.some((r) => r.kind === "library_due"))

cleanup()
psql(`delete from users where email = 'lib-parent@example.com'`)
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
