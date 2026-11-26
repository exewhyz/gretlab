/**
 * File storage (apps/web/lib/storage): Cloudflare R2, with S3Mock standing in (e2e/run.sh).
 *   - an image upload lands in the public bucket; its address redirects to a link signed for 7
 *     days (no custom domain, as on the live site), cached a day; the bytes are the same; the
 *     same image again is one object
 *   - an image still kept in the database is served as before; the move job copies them all to
 *     the bucket, and their addresses keep working
 *   - a finished export's file goes to the private bucket; its download is a link signed for
 *     five minutes, given only to its starter; nothing of it is in the public bucket
 *   - Monitoring says where images are, and who may move them
 *   node e2e/storage.mjs [base-url]
 */
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SECRET = process.env.NEXTAUTH_SECRET ?? "e2e-only-secret"
const DB = process.env.E2E_DB ?? "gretlab_test"
const S3 = (process.env.STORAGE_ENDPOINT ?? "http://127.0.0.1:9190").replace(/\/+$/, "")
let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 1500)}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-v", "ON_ERROR_STOP=1", "-Atqc", q]).toString().trim()
const cookieOf = async (email) => `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
const cleanup = () => {
  psql(`delete from jobs where created_by in (select id from users where email = 'admin@example.com' or email like 'st-%@example.com')`)
  psql(`delete from assignments where slug = 'st-export'`)
  psql(`delete from uploads where uploaded_by in (select id from users where email like 'st-%@example.com') or hash like 'st-%'`)
  psql(`delete from users where email like 'st-%@example.com'`)
}
const waitFor = async (fn, ms = 60_000) => {
  for (const until = Date.now() + ms; Date.now() < until; await new Promise((r) => setTimeout(r, 500))) {
    const v = await fn()
    if (v) return v
  }
  return null
}

cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
psql(`insert into users (email, name, role) values ('st-other@example.com', 'St Other', 'admin'), ('st-student@example.com', 'St Student', 'student')`)
const admin = await cookieOf("admin@example.com")
const other = await cookieOf("st-other@example.com")
const api = (cookie, path, init = {}) => fetch(BASE + "/api/v1" + path, { redirect: "manual", ...init, headers: { cookie, origin: BASE, ...(init.headers ?? {}) } })

// ---------- an image goes to the public bucket
// A PNG unique to this run (its last byte), so it's a new object.
const png = Buffer.concat([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"), Buffer.from(String(Date.now()))])
const form = () => { const f = new FormData(); f.append("file", new Blob([png], { type: "image/png" }), "st.png"); return f }
const up = await (await api(admin, "/uploads", { method: "POST", body: form() })).json()
const hash = createHash("sha256").update(png).digest("hex")
check("an image uploads, with its usual address", /^\/api\/v1\/uploads\/[0-9a-f-]{36}$/.test(up?.url ?? ""), JSON.stringify(up))
check("…kept in file storage, not the database", psql(`select stored_in || ':' || coalesce(key, '') || ':' || (data is null) from uploads where id = '${up.id}'`) === `r2:images/${hash}.png:true`)
const served = await fetch(BASE + up.url, { redirect: "manual" })
const imageLink = served.headers.get("location") ?? ""
check("its address redirects to a link signed for 7 days, the redirect cached a day", served.status === 302 && imageLink.startsWith(`${S3}/gretlab-public/images/${hash}.png?`) && /X-Amz-Expires=604800/.test(imageLink) && /s-maxage=86400/.test(served.headers.get("cache-control") ?? ""), JSON.stringify({ status: served.status, location: imageLink.slice(0, 160), cache: served.headers.get("cache-control") }))
const there = await fetch(served.headers.get("location"))
check("…where the bytes are the same, as an image", there.status === 200 && there.headers.get("content-type") === "image/png" && Buffer.from(await there.arrayBuffer()).equals(png))
const again = await (await api(admin, "/uploads", { method: "POST", body: form() })).json()
check("the same image again is the same upload", again?.id === up.id)

// ---------- your images: reuse instead of uploading again
const library = async (cookie, extra = "") => (await api(cookie, `/me/uploads?page=1${extra}`)).json()
const mine = await library(admin)
check("an upload is in its uploader's images, with its file name", mine?.items?.[0]?.id === up.id && mine.items[0].name === "st.png" && mine.items[0].url === up.url, JSON.stringify(mine?.items?.[0]))
const otherForm = () => { const f = new FormData(); f.append("file", new Blob([png], { type: "image/png" }), "same-picture.png"); return f }
const sameByOther = await (await api(other, "/uploads", { method: "POST", body: otherForm() })).json()
const theirs = await library(other)
check("the same image uploaded by someone else is stored once, and in their images too", sameByOther?.id === up.id && theirs?.items?.some((i) => i.id === up.id && i.name === "same-picture.png") && psql(`select count(*) from uploads where hash = '${hash}'`) === "1")
const gif = Buffer.concat([Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"), Buffer.from(String(Date.now()))])
const gifForm = () => { const f = new FormData(); f.append("file", new Blob([gif], { type: "image/gif" }), "st-anim.gif"); return f }
const gifUp = await (await api(other, "/uploads", { method: "POST", body: gifForm() })).json()
check("nobody sees another person's images", !(await library(admin)).items.some((i) => i.id === gifUp.id))
check("searched by file name", (await library(other, "&q=anim")).items.map((i) => i.id).join() === gifUp.id)
check("only PNG and JPEG for a logo", !(await library(other, "&for=logo")).items.some((i) => i.id === gifUp.id) && (await library(other, "&for=logo")).items.some((i) => i.id === up.id))
const picked = await api(other, `/me/uploads/${up.id}`, { method: "POST" })
check("picking one moves it to the top, at the same address", picked.status === 200 && (await library(other)).items[0].id === up.id)
check("…but only one of your own", (await api(admin, `/me/uploads/${gifUp.id}`, { method: "POST" })).status === 404)
const forgot = await api(other, `/me/uploads/${up.id}`, { method: "DELETE" })
check("removing it from your images forgets it there only: it's still served, and still the other person's", forgot.status === 200 && !(await library(other)).items.some((i) => i.id === up.id) && (await library(admin)).items.some((i) => i.id === up.id) && (await fetch(BASE + up.url, { redirect: "manual" })).status === 302)

// ---------- images kept in the database: served as before, then moved
const old = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64")
const oldId = psql(`insert into uploads (hash, content_type, size, data, stored_in) values ('st-old-${Date.now()}', 'image/png', ${old.length}, decode('${old.toString("hex")}', 'hex'), 'db') returning id`)
const fromDb = await fetch(`${BASE}/api/v1/uploads/${oldId}`, { redirect: "manual" })
check("an image still in the database is served as before", fromDb.status === 200 && fromDb.headers.get("x-content-type-options") === "nosniff" && Buffer.from(await fromDb.arrayBuffer()).equals(old))
const student = await cookieOf("st-student@example.com")
check("only those who manage settings may move images", (await api(student, "/admin/storage/move", { method: "POST" })).status === 403)
const moving = await (await api(admin, "/admin/storage/move", { method: "POST" })).json()
const moved = await waitFor(async () => {
  const j = await (await api(admin, `/jobs/${moving?.job}`)).json()
  return j?.status === "done" ? j : null
})
check("the move copies every image kept in the database", moved?.status === "done" && psql(`select count(*) from uploads where stored_in = 'db'`) === "0", JSON.stringify(moved))
const movedServe = await fetch(`${BASE}/api/v1/uploads/${oldId}`, { redirect: "manual" })
const movedBytes = movedServe.status === 302 ? Buffer.from(await (await fetch(movedServe.headers.get("location"))).arrayBuffer()) : null
check("…and its address still works, now from file storage", movedServe.status === 302 && movedBytes?.equals(old))

// ---------- an export's file goes to the private bucket
const problem = psql(`select id from problems where published and listed order by slug limit 1`)
const hours = (h) => new Date(Date.now() + h * 3_600_000).toISOString()
const made = await (await api(admin, "/admin/assignments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "St export", slug: "st-export", description: "", opensAt: hours(-1), dueAt: hours(24), allowLate: false, latePenaltyPercent: 0, published: true, problems: [{ problemId: problem, points: 10 }] }) })).json()
const direct = await (await api(admin, `/admin/assignments/${made.id}/gradebook?format=csv`)).text()
const job = (await (await api(admin, `/admin/assignments/${made.id}/gradebook/export`, { method: "POST" })).json())?.job
await waitFor(async () => (await (await api(admin, `/jobs/${job}`)).json())?.status === "done")
const kept = psql(`select stored_in || ':' || coalesce(key, '') || ':' || (data is null) from job_files where job_id = '${job}'`)
check("a finished export's file is in the private bucket, not the database", kept === `r2:jobs/${job}/st-export-grades.csv:true`, kept)
const download = await api(admin, `/jobs/${job}/file`)
const link = download.headers.get("location") ?? ""
check("its download is a link signed for five minutes", download.status === 302 && link.startsWith(`${S3}/gretlab-private/jobs/${job}/`) && /X-Amz-Expires=300/.test(link) && /X-Amz-Signature=/.test(link), link.slice(0, 200))
const file = await fetch(link)
check("…which gives the same CSV as the instant download", file.status === 200 && (await file.text()) === direct)
check("someone else gets no link", (await api(other, `/jobs/${job}/file`)).status === 404)
check("nothing of it is in the public bucket", (await fetch(`${S3}/gretlab-public/jobs/${job}/st-export-grades.csv`)).status === 404)

// ---------- the picker in the editor
{
  const { chromium } = createRequire(ROOT + "package.json")("playwright")
  const browser = await chromium.launch()
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    await ctx.addCookies([{ name: "next-auth.session-token", value: (await cookieOf("admin@example.com")).split("=")[1], url: BASE }])
    const page = await ctx.newPage()
    await page.goto(`${BASE}/admin/problems/new`)
    const editor = page.getByTestId("markdown-editor").first()
    await editor.waitFor({ timeout: 30000 })
    await editor.getByRole("button", { name: "Image", exact: true }).click()
    const picker = page.getByTestId("image-picker")
    await picker.getByTestId("my-images").waitFor({ timeout: 15000 })
    await picker.getByRole("button", { name: "Use st.png" }).first().click()
    await picker.waitFor({ state: "detached", timeout: 10000 })
    const text = await editor.locator("textarea").first().inputValue()
    check("the editor's image button picks one of your images, putting it in without uploading", text.includes(`![st](${up.url})`), text.slice(0, 200))
    await editor.getByRole("button", { name: "Image", exact: true }).click()
    await page.getByTestId("image-picker").getByTestId("my-images").waitFor({ timeout: 15000 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: "/tmp/gretlab-e2e/image-picker.png" })
    const phone = await browser.newContext({ viewport: { width: 390, height: 844 } })
    await phone.addCookies([{ name: "next-auth.session-token", value: (await cookieOf("admin@example.com")).split("=")[1], url: BASE }])
    const pp = await phone.newPage()
    await pp.goto(`${BASE}/admin/problems/new`)
    await pp.getByTestId("markdown-editor").first().getByRole("button", { name: "Image", exact: true }).click()
    await pp.getByTestId("image-picker").getByTestId("my-images").waitFor({ timeout: 15000 })
    const box = await pp.getByTestId("image-picker").boundingBox()
    check("the picker fits a phone's screen", box && box.x >= 0 && box.x + box.width <= 391, JSON.stringify(box))
    await pp.screenshot({ path: "/tmp/gretlab-e2e/image-picker-phone.png" })
  } finally {
    await browser.close()
  }
}

// ---------- Monitoring
const health = await (await api(admin, "/admin/monitoring")).json()
check("Monitoring says file storage is set up, and where the images are", health?.storage?.ready === true && health.storage.imagesInDatabase === 0 && health.storage.imagesInStorage >= 2 && health.can?.moveFiles === true, JSON.stringify({ storage: health?.storage, can: health?.can }))

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
