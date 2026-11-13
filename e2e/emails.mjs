/**
 * Email templates: every email the site sends is branded HTML with a plain-text copy, built
 * from wording platform staff edit (Dashboard › Emails) with "Manage email templates";
 * unknown or missing placeholders are refused; edits reach the next email (notifications,
 * account emails), and so does the shared footer; what people wrote is escaped, never
 * markup; a test goes to the editor; reset brings the default back; all of it logged.
 *   node e2e/emails.mjs [base-url] [screenshot-dir]
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
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 400)}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()
const cleanup = () => {
  psql(`delete from email_templates`)
  psql(`delete from email_outbox where to_address like 'em-%' or subject like '[Test]%'`)
  psql(`delete from organizations where slug='em-org'`)
  psql(`delete from users where email like 'em-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
for (const h of ["em-helper", "em-s1"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h} Name','student','${h}')`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
const helper = await client("em-helper@example.com")
const anon = async (path, body) => {
  const res = await fetch(BASE + "/api/v1" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  return { status: res.status }
}
const last = (to) => {
  const [subject, html, text] = psql(`select subject || '␞' || coalesce(html,'') || '␞' || body from email_outbox where to_address='${to}' order by created_at desc limit 1`).split("␞")
  return { subject, html: html ?? "", text: text ?? "" }
}

// ---------- the list
const list = (await admin("/admin/emails")).json
check("the admin sees every email with its placeholders", list?.templates.length === 7 && list.templates.every((t) => t.vars.length > 0 && t.subject && t.body), JSON.stringify(list?.templates?.map((t) => t.key)))
check("platform staff without the permission can't", (await helper("/admin/emails")).status === 403 && (await helper("/admin/emails/notification", { method: "PUT", body: { subject: "x", body: "x" } })).status === 403)

// ---------- account emails are branded
await anon("/auth/sign-up", { name: "Em One", email: "em-one@example.com", password: "lemon tree grows fast" })
const confirm = last("em-one@example.com")
check("a sign-up's email is branded HTML", confirm.html.startsWith("<!doctype html>") && confirm.html.includes("Confirm my email</a>") && confirm.html.includes("&gt;&gt;&gt;"), confirm.html.slice(0, 200))
check("...with a plain-text copy holding the link", /Confirm my email: https?:\/\/\S+verify-email\?token=/.test(confirm.text), confirm.text)

// ---------- editing
const save = (key, body) => admin(`/admin/emails/${key}`, { method: "PUT", body })
check("an unknown placeholder is refused", (await save("account.reset", { subject: "Reset", body: "Hi {{nmae}} {{link}}" })).json?.error?.code === "bad_template")
check("dropping the link it exists to send is refused", (await save("account.reset", { subject: "Reset", body: "Hi {{name}}" })).status === 400)
check("good wording is saved", (await save("account.reset", { subject: "{{site}}: new password for {{email}}", body: "Hello {{name}},\n\n[button: Pick a new password]({{link}})\n\nThanks!" })).status === 200)
await anon("/auth/forgot", { email: "em-one@example.com" })
const reset = last("em-one@example.com")
check("the next email uses it", reset.subject.endsWith(": new password for em-one@example.com") && reset.html.includes("Pick a new password</a>") && reset.text.includes("Thanks!"), reset.subject)
check("...shown as edited", (await admin("/admin/emails")).json?.templates.find((t) => t.key === "account.reset")?.changed === true)
check("the footer is saved", (await save("layout", { body: "Sent by **{{site}}** · Questions? [Write to us](mailto:help@example.com)" })).status === 200)
check("an unknown placeholder in the footer is refused", (await save("layout", { body: "{{nope}}" })).status === 400)

// ---------- notifications
const orgRes = await admin("/admin/organizations", { body: { name: "Em Org", slug: "em-org", type: "college", ownerEmail: "em-o@example.com" } })
const owner = await client("em-o@example.com")
const orgId = psql(`select id from organizations where slug='em-org'`)
psql(`insert into org_members(org_id,user_id,status,joined_via) select '${orgId}', id, 'active', 'created' from users where email='em-s1@example.com'`)
const cls = (await owner("/orgs/em-org/groups", { body: { name: "Em Class" } })).json
await owner(`/orgs/em-org/groups/${cls.id}/members`, { body: { userIds: [psql(`select id from users where email='em-s1@example.com'`)] } })
check("a notification's own wording is saved", (await save("notification", { subject: "[{{org}}] {{title}}", body: "{{body}}\n\n[button: See it]({{link}})" })).status === 200)
await owner(`/orgs/em-org/classes/${cls.id}/stream`, { body: { text: "Lab moves to <b>Room 204</b> on **Friday** [click](https://evil.example)" } })
const note = last("em-s1@example.com")
check("notifications use it, with the organization", note.subject === "[Em Org] New notice in Em Class", `${orgRes.status} ${note.subject}`)
check("...what people wrote is escaped, not markup", note.html.includes("&lt;b&gt;Room 204&lt;/b&gt;") && note.html.includes("**Friday**") && !note.html.includes('href="https://evil.example"'), note.html.slice(note.html.indexOf("Lab"), note.html.indexOf("Lab") + 200))
check("...with the button, the footer and why they got it", note.html.includes("See it</a>") && note.html.includes('href="mailto:help@example.com"') && note.html.includes("notification settings"))

// ---------- tests, defaults, log
const t = await admin("/admin/emails/auth.code/test", { body: {} })
check("a test goes to the editor, with example values", t.json?.to === "admin@example.com" && psql(`select subject from email_outbox where to_address='admin@example.com' order by created_at desc limit 1`).startsWith("[Test] Your") && psql(`select subject from email_outbox where to_address='admin@example.com' order by created_at desc limit 1`).includes("482913"))
await admin("/admin/emails/account.reset", { method: "DELETE" })
check("reset brings the default back", (await admin("/admin/emails")).json?.templates.find((t) => t.key === "account.reset")?.changed === false)
psql(`delete from auth_tokens where user_id=(select id from users where email='em-one@example.com')`)
await anon("/auth/forgot", { email: "em-one@example.com" })
check("...for the next email too", last("em-one@example.com").subject.startsWith("Reset your"))
check("every change is in the platform's log", Number(psql(`select count(*) from audit_log where org_id is null and action='platform.email_template'`)) >= 4)

// ---------- the page
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email: "admin@example.com" }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
const p = await ctx.newPage()
await p.goto(`${BASE}/admin/emails`)
await p.getByTestId("email-editor").waitFor({ timeout: 30000 })
await p.getByRole("navigation", { name: "Emails" }).getByRole("button", { name: /^Reset password/ }).click()
await p.getByLabel("Subject").fill("Your {{site}} password link")
check("the preview follows the wording as it's typed", (await p.getByTestId("preview-subject").innerText()) === "Your Gretlab password link" || (await p.getByTestId("preview-subject").innerText()).endsWith("password link"))
await p.getByLabel("Body").fill("Hi")
check("...and says what's wrong before saving", (await p.getByTestId("email-editor").innerText()).includes("Keep {{link}}") && (await p.getByRole("button", { name: "Save" }).isDisabled()))
await p.getByRole("button", { name: "{{link}}" }).click()
await p.getByRole("button", { name: "Save" }).click()
await p.getByText("Saved.").waitFor({ timeout: 15000 })
check("saving from the page", psql(`select subject from email_templates where key='account.reset'`) === "Your {{site}} password link")
await p.getByRole("tab", { name: "Plain text" }).click()
check("the plain-text copy is shown too", (await p.getByTestId("preview-text").innerText()).includes("Hi"))
await p.getByRole("tab", { name: "Email" }).click()
await p.getByRole("navigation", { name: "Emails" }).getByRole("button", { name: /^Notification/ }).click()
const frameText = await p.frameLocator("[data-testid=preview-html]").locator("body").innerText({ timeout: 10000 })
check("the preview shows the branded email, with the site's own name", frameText.includes("Lab moves to Room 204") && frameText.includes("Python Practice Lab") && !frameText.includes("gretlab.example.com"), frameText.slice(0, 300))
await p.screenshot({ path: SHOTS + "admin-emails.png", fullPage: true })
await browser.close()

// Back to the defaults through the API, so the server's cached wording is cleared too.
for (const key of psql(`select key from email_templates`).split("\n").filter(Boolean)) await admin(`/admin/emails/${key}`, { method: "DELETE" })
cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
