/**
 * The landing page's contact form, its proof and its questions: enquiries are checked, kept,
 * emailed to the organizations contact and limited per sender; bots that fill the hidden
 * field get nothing stored; partners and testimonials show only once staff add real ones;
 * only the right platform staff see enquiries or edit the proof; the pages.
 *   node e2e/landing.mjs [base-url] [screenshot-dir]
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
  psql(`delete from enquiries where email like 'lnd-%'`)
  psql(`delete from landing_partners where name like 'Lnd %'`)
  psql(`delete from landing_testimonials where name like 'Lnd %'`)
  psql(`delete from email_outbox where subject like '%Lnd College%'`)
}
cleanup()
for (const [email, role] of [["admin@example.com", "admin"], ["lnd-student@example.com", "student"]]) {
  psql(`insert into users(email,name,role,handle) values ('${email}','${email.split("@")[0]}','${role}','${email.split("@")[0]}') on conflict (email) do update set role='${role}', disabled=false`)
}
const as = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await as("admin@example.com")
const student = await as("lnd-student@example.com")
const anon = async (path, body) => {
  const res = await fetch(BASE + "/api/v1" + path, { method: "POST", headers: { "content-type": "application/json", origin: BASE }, body: JSON.stringify(body) })
  return { status: res.status, json: await res.json().catch(() => null) }
}
const page = async () => (await fetch(BASE + "/")).text()
// Put the contact back exactly as it was: the row's value, or no row at all.
const previous = psql(`select value from settings where key = 'landing.contact_email'`)
await admin("/admin/settings", { method: "PATCH", body: { "landing.contact_email": "lnd-desk@example.com" } })

// ---------- the page before any proof
let html = await page()
check("the page has the form and the questions", html.includes('id="contact"') && html.includes('id="faq"') && html.includes("What is GretLab?"))
check("with no partners or quotes, those sections are hidden", !html.includes("Colleges and programs on GretLab") && !html.includes("In their"))
check("it says what GretLab is: the college ERP with a coding lab", html.includes("The college ERP with a coding lab that") && html.includes("For colleges, universities and coaching institutes."))
check("…and fees are in the answers", html.includes("How do fees work?"))

// ---------- the contact form
const good = { name: "Lnd Asha", email: "lnd-asha@example.com", organization: "Lnd College", kind: "college", learners: "500–2,000", message: "Labs for 600 students", website: "" }
check("a bad enquiry is refused", (await anon("/enquiries", { ...good, email: "nope", kind: "castle" })).status === 400)
check("the hidden field: answered as fine, nothing kept", (await anon("/enquiries", { ...good, website: "http://spam" })).status === 200 && psql(`select count(*) from enquiries where email = 'lnd-asha@example.com'`) === "0")
const sent = await anon("/enquiries", good)
check("an enquiry is accepted", sent.status === 200, JSON.stringify(sent.json))
check("...kept, as sent", psql(`select organization || '|' || kind || '|' || learners || '|' || status from enquiries where email = 'lnd-asha@example.com'`) === "Lnd College|college|500–2,000|new")
check("...and emailed to the organizations contact", psql(`select count(*) from email_outbox where to_address = 'lnd-desk@example.com' and subject like '%Lnd College%'`) === "1")
await anon("/enquiries", good)
await anon("/enquiries", good)
const fourth = await anon("/enquiries", good)
check("a fourth from the same sender within the hour is refused", fourth.status === 429 && fourth.json?.error?.code === "too_many_enquiries", fourth.status)

// ---------- who sees enquiries
check("students can't read enquiries", (await student("/admin/landing/enquiries")).status === 403)
const list = await admin("/admin/landing/enquiries?status=new&q=Lnd")
check("staff who manage organizations see them, newest first, with the count waiting", list.status === 200 && list.json.items.length === 3 && list.json.waiting >= 3)
const id = list.json.items[0].id
check("an enquiry can be marked handled", (await admin(`/admin/landing/enquiries/${id}`, { method: "PATCH", body: { status: "handled" } })).json?.status === "handled")
check("...and it's in the activity log", Number(psql(`select count(*) from audit_log where action = 'landing.enquiry' and org_id is null`)) >= 1)

// ---------- proof, only when real
check("students can't add partners", (await student("/admin/landing/partners", { body: { name: "Lnd Fake", kind: "college" } })).status === 403)
const partner = await admin("/admin/landing/partners", { body: { name: "Lnd Institute of Technology", kind: "college" } })
const quote = await admin("/admin/landing/testimonials", { body: { quote: "Our lab exams grade themselves now, and the marks are in before the class ends.", name: "Lnd Rao", role: "Head of CSE", institution: "Lnd Institute of Technology" } })
check("a partner and a quote are added", partner.status === 200 && quote.status === 200)
check("a quote too short is refused", (await admin("/admin/landing/testimonials", { body: { quote: "Nice", name: "Lnd X", role: "Dean", institution: "Lnd" } })).status === 400)
html = await page()
check("the page now names the partner and shows the quote", html.includes("Lnd Institute of Technology") && html.includes("Our lab exams grade themselves now") && html.includes("Head of CSE"))
await admin(`/admin/landing/partners/${partner.json.id}`, { method: "DELETE" })
await admin(`/admin/landing/testimonials/${quote.json.id}`, { method: "DELETE" })
html = await page()
check("removing them hides them again", !html.includes("Lnd Institute of Technology") && !html.includes("Our lab exams grade themselves now"))
check("adding and removing are in the activity log", Number(psql(`select count(*) from audit_log where action in ('landing.partner_add','landing.partner_remove','landing.testimonial_add','landing.testimonial_remove')`)) >= 4)

// ---------- the pages
const browser = await chromium.launch()
const tab = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
await tab.goto(BASE + "/")
await tab.getByRole("button", { name: "Coaching" }).click()
await tab.getByText("DSA in Java › Batch A").waitFor({ timeout: 10000 })
check("the switch shows a coaching batch's week, with fees and dues in it", (await tab.getByText("Fee counter").count()) > 0 && (await tab.getByText("Dues").count()) > 0)
await tab.screenshot({ path: SHOTS + "landing-coaching.png" })
await tab.getByRole("button", { name: "College" }).click()
await tab.getByRole("link", { name: "Talk to us" }).first().click()
await tab.waitForTimeout(400)
check("Talk to us leads to the form", new URL(tab.url()).hash === "#contact")
const form = tab.locator("#contact form")
await form.getByRole("button", { name: "Talk to us" }).click()
check("an empty form says what's missing", await form.getByText("Tell us your name").isVisible())
await form.getByLabel("Your name").fill("Lnd Meera")
await form.getByLabel("Work email").fill("lnd-meera@example.com")
await form.getByLabel("College, program or school").fill("Lnd Cohort Labs")
await form.getByLabel("What kind").selectOption("cohort")
await form.getByRole("button", { name: "Talk to us" }).click()
await tab.getByText("Thanks, Lnd. We've got it.").waitFor({ timeout: 15000 })
check("sending it says so", psql(`select kind from enquiries where email = 'lnd-meera@example.com'`) === "cohort")
await tab.locator("#contact").screenshot({ path: SHOTS + "landing-contact.png" })
const staff = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
await staff.context().addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email: "admin@example.com" }, secret: SECRET }), url: BASE }])
await staff.goto(BASE + "/admin/landing")
await staff.getByRole("tab", { name: "Enquiries" }).waitFor({ timeout: 15000 })
check("the dashboard lists enquiries", await staff.getByText("Lnd Cohort Labs").waitFor({ timeout: 15000 }).then(() => true, () => false))
await staff.getByRole("tab", { name: "Partners" }).click()
await staff.getByRole("button", { name: "Add partner" }).click()
await staff.getByRole("dialog").getByLabel("Institution").fill("Lnd Polytechnic")
await staff.getByRole("dialog").getByRole("button", { name: "Add partner" }).click()
await staff.getByRole("cell", { name: "Lnd Polytechnic" }).waitFor({ timeout: 15000 })
check("a partner is added from its dialog", true)
await staff.screenshot({ path: SHOTS + "landing-admin.png" })
const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
await phone.goto(BASE + "/")
check("the page fits a phone", (await phone.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0)
await phone.locator("#faq").getByRole("button", { name: "Is it safe to run students' code?" }).click()
check("a question opens to its answer", await phone.getByText("throwaway gVisor container").isVisible())
await browser.close()

if (previous) psql(`update settings set value = '${previous}' where key = 'landing.contact_email'`)
else psql(`delete from settings where key = 'landing.contact_email'`)
cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
