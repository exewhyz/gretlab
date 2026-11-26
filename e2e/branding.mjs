/**
 * An organization's branding: who may set it (whoever changes its settings), the colour checked
 * for both themes, the logo (PNG or JPEG only), the activity log, and where it shows: the frame
 * (logo and colour, taken off when leaving), the public profile, a certificate's public page.
 * Branded PDFs are checked in e2e/pdfs.mjs.
 *   node e2e/branding.mjs http://localhost:3100 /tmp/gretlab-e2e/
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
  psql(`delete from certificates where code = 'BRAND-23456'`)
  psql(`delete from organizations where slug like 'brd-%'`)
  psql(`delete from users where email like 'brd-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
for (const h of ["brd-o", "brd-t", "brd-s"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','Brd ${h.slice(4)}','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const cookieFor = async (h) => ({ name: "next-auth.session-token", value: await encode({ token: { email: `${h}@example.com` }, secret: SECRET }), url: BASE })
const client = async (h) => {
  const cookie = `next-auth.session-token=${(await cookieFor(h)).value}`
  const call = async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, origin: BASE, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
  call.upload = async (path, bytes, type, name) => {
    const form = new FormData()
    form.append("file", new Blob([bytes], { type }), name)
    const res = await fetch(BASE + "/api/v1" + path, { method: "POST", headers: { cookie, origin: BASE }, body: form })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
  return call
}
const admin = await client("admin")
await admin("/admin/organizations", { body: { name: "Brd College", slug: "brd-college", type: "college", ownerEmail: "brd-o@example.com" } })
const O = "/orgs/brd-college"
const orgId = psql(`select id from organizations where slug='brd-college'`)
for (const h of ["brd-t", "brd-s"]) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
const [owner, teacher, student] = await Promise.all(["brd-o", "brd-t", "brd-s"].map(client))
const roles = (await owner(`${O}/roles`)).json
await owner(`${O}/members/${uid("brd-t")}/roles`, { body: { roleId: roles.find((r) => r.systemKey === "teacher").id } })

// A small PNG (a different one each run, so the upload isn't one already stored) and a GIF.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")
const pngOnce = Buffer.concat([png, Buffer.from(`brd-${Date.now()}`)])
const gif = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64")

// ---------- who may
check("starts with GretLab's own", JSON.stringify((await owner(`${O}/branding`)).json) === '{"logo":null,"accent":null}')
check("a teacher can't see or change it", (await teacher(`${O}/branding`)).status === 403 && (await teacher(`${O}/branding`, { method: "PUT", body: { accent: "#2f6fde" } })).status === 403)
check("nor a student, nor upload a logo", (await student(`${O}/branding`, { method: "PUT", body: { accent: "#2f6fde" } })).status === 403 && (await student.upload(`${O}/branding/logo`, pngOnce, "image/png", "logo.png")).status === 403)

// ---------- the colour
check("not a colour: refused", (await owner(`${O}/branding`, { method: "PUT", body: { accent: "blue" } })).status === 400)
const pale = await owner(`${O}/branding`, { method: "PUT", body: { accent: "#ffe08a" } })
check("too pale for the light page: refused, saying why", pale.json?.error?.code === "bad_colour" && /too light/.test(pale.json.error.message), JSON.stringify(pale.json))
check("too dark for dark mode: refused", (await owner(`${O}/branding`, { method: "PUT", body: { accent: "#0b1f4d" } })).json?.error?.code === "bad_colour")
const blue = await owner(`${O}/branding`, { method: "PUT", body: { accent: "#2F6FDE" } })
check("a colour that shows on both: saved, in lower case", blue.json?.accent === "#2f6fde", JSON.stringify(blue.json))
check("...and logged with what changed", psql(`select detail->'changes'->0->>'to' from audit_log where org_id='${orgId}' and action='org.branding' order by created_at desc limit 1`) === "#2f6fde")

// ---------- the logo
const asGif = await owner.upload(`${O}/branding/logo`, gif, "image/gif", "logo.gif")
check("a GIF isn't a logo (PDFs can't hold it)", asGif.status === 415 && /PNG or JPEG/.test(asGif.json?.error?.message ?? ""), JSON.stringify(asGif.json))
check("nor something pretending to be a PNG", (await owner.upload(`${O}/branding/logo`, Buffer.from("<svg></svg>"), "image/png", "logo.png")).status === 415)
const logo = await owner.upload(`${O}/branding/logo`, pngOnce, "image/png", "logo.png")
check("a PNG is", logo.status === 200 && /^\/api\/v1\/uploads\//.test(logo.json?.logo ?? ""), JSON.stringify(logo.json))
const served = await fetch(BASE + logo.json?.logo, { redirect: "follow" })
check("...and served as an image", served.ok && /image\/png/.test(served.headers.get("content-type") ?? ""))

// ---------- where it shows
const shell = (await student(`${O}/shell`)).json
check("the frame of every member gets it", shell?.org?.brand?.accent === "#2f6fde" && shell.org.brand.logo === logo.json?.logo, JSON.stringify(shell?.org?.brand))
check("so does the public profile", (await student(O)).json?.brand?.logo === logo.json?.logo)
psql(`insert into certificates(code,org_id,user_id,kind,title,detail) values ('BRAND-23456','${orgId}','${uid("brd-s")}','custom','Lab champion','')`)
const cert = await (await fetch(`${BASE}/certificates/BRAND-23456`)).text()
check("a certificate it gave wears its logo and colour", cert.includes('data-testid="certificate-logo"') && cert.includes("--primary:#2f6fde"), cert.slice(0, 200))

// ---------- in a browser
const browser = await chromium.launch()
const errors = []
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await ctx.addCookies([await cookieFor("brd-o")])
  const p = await ctx.newPage()
  p.on("pageerror", (e) => errors.push(e.message.slice(0, 200)))
  await p.goto(`${BASE}/orgs/brd-college/manage/settings`)
  const card = p.getByTestId("branding-card")
  await card.waitFor({ timeout: 30000 })
  check("Settings has a Branding card with the logo", (await card.getByTestId("branding-logo").count()) === 1)
  await p.getByTestId("org-logo").waitFor({ timeout: 20000 })
  const primary = () => p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--primary").trim())
  check("the frame shows the logo and wears the colour", (await primary()) === "#2f6fde")
  await card.getByLabel("Colour as hex").fill("#ffe08a")
  check("a pale colour is explained before saving, and can't be saved", (await card.getByText(/too light/).count()) === 1 && (await card.getByRole("button", { name: "Save colour" }).isDisabled()))
  await card.getByLabel("Colour as hex").fill("#1f8a65")
  check("a good one is previewed on both pages", (await card.getByTestId("branding-preview").locator("> div").count()) === 2)
  await card.getByRole("button", { name: "Save colour" }).click()
  for (let i = 0; i < 50 && (await primary()) !== "#1f8a65"; i++) await p.waitForTimeout(200)
  check("saving it recolours the page at once", (await primary()) === "#1f8a65")
  await p.screenshot({ path: `${SHOTS}branding-settings.png`, fullPage: true })
  await p.goto(`${BASE}/home`)
  await p.waitForLoadState("networkidle")
  check("leaving the organization takes the colour off", (await primary()) === "#f54e00", await primary())
  // Removing the logo: the frame goes back to initials.
  await p.goto(`${BASE}/orgs/brd-college/manage/settings`)
  await p.getByTestId("branding-card").getByRole("button", { name: "Remove" }).click()
  await p.getByRole("alertdialog").getByRole("button", { name: "Remove logo" }).click()
  await p.getByTestId("branding-card").getByText("None", { exact: true }).waitFor({ timeout: 20000 })
  for (let i = 0; i < 50 && (await p.getByTestId("org-logo").count()) > 0; i++) await p.waitForTimeout(200)
  check("removing the logo: initials again", (await p.getByTestId("org-logo").count()) === 0)

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } })
  await phone.addCookies([await cookieFor("brd-o")])
  const pp = await phone.newPage()
  await pp.goto(`${BASE}/orgs/brd-college/manage/settings`)
  await pp.getByTestId("branding-card").waitFor({ timeout: 30000 })
  await pp.getByTestId("branding-card").scrollIntoViewIfNeeded()
  check("the card on a phone, without sideways scrolling", await pp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await pp.screenshot({ path: `${SHOTS}branding-phone.png` })
  check("no page errors", errors.length === 0, errors.join(" | "))
} finally {
  await browser.close()
  cleanup()
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll branding checks passed")
process.exit(failures ? 1 : 0)
