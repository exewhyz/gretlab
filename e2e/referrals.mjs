/**
 * Refer and earn: everyone's personal link (the same code each time), following it and
 * registering a school attributes the school to it once (never your own), paying a plan earns
 * the referrer their share before GST in the window and nothing after it, a campaign coupon gives
 * its discount (shown on the invoice) and earns nobody, used-up and expired codes are refused,
 * a creator link earns its creator at its own share, only the platform's referral managers see
 * the dashboard and mark payouts paid (logged), and the pages on a laptop and a phone.
 *   node e2e/referrals.mjs http://localhost:3100 /tmp/gretlab-e2e/
 */
import { execFileSync } from "node:child_process"
import { createHmac, randomBytes } from "node:crypto"
import { mkdirSync } from "node:fs"
import { createServer } from "node:http"
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
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-v", "ON_ERROR_STOP=1", "-Atqc", q]).toString().trim()
const session = async (email) => (await encode({ token: { email }, secret: SECRET }))
const client = async (email, extraCookie = "") => {
  const cookie = `next-auth.session-token=${await session(email)}${extraCookie ? `; ${extraCookie}` : ""}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, origin: BASE, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}

// ---------- a fake Razorpay (as in e2e/billing.mjs)
const RZP_KEY = "rzp_test_e2e", RZP_SECRET = "e2e-razorpay-secret"
const fake = createServer((req, res) => {
  let body = ""
  req.on("data", (c) => (body += c))
  req.on("end", () => {
    if (req.method !== "POST" || req.url !== "/v1/orders" || req.headers.authorization !== `Basic ${Buffer.from(`${RZP_KEY}:${RZP_SECRET}`).toString("base64")}`) {
      res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: { description: "Authentication failed" } }))
      return
    }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ id: `order_${randomBytes(7).toString("hex")}`, ...JSON.parse(body), status: "created" }))
  })
})
await new Promise((r) => fake.listen(3197, "127.0.0.1", r))
const sign = (text) => createHmac("sha256", RZP_SECRET).update(text).digest("hex")

const cleanup = () => {
  psql(`delete from referral_earnings where org_id in (select id from organizations where slug like 'rf-%')`)
  psql(`delete from payments where org_id in (select id from organizations where slug like 'rf-%')`)
  psql(`delete from organizations where slug like 'rf-%'`)
  psql(`delete from referral_codes where code like 'RF-%' or owner_id in (select id from users where email like 'rf-%')`)
  psql(`delete from users where email like 'rf-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
for (const h of ["rf-ref", "rf-owner", "rf-two", "rf-three", "rf-creator", "rf-c-org", "rf-pal", "rf-four"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','Rf ${h.slice(3)}','student','${h}')`)
const admin = await client("admin@example.com")
const before = (await admin("/admin/settings")).json
await admin("/admin/settings", { method: "PATCH", body: { "orgs.self_signup": "open", "billing.enabled": true, "billing.gst_registered": false } })
await admin("/admin/referrals/settings", { method: "PATCH", body: { "referral.enabled": true, "referral.percent": 5, "referral.months": 3 } })

// ---------- your link
const ref = await client("rf-ref@example.com")
const mine = (await ref("/me/referrals")).json
check("everyone has a personal code and link", /^[A-HJKMNP-Z2-9]{8}$/.test(mine?.code ?? "") && mine.path === `/r/${mine.code}` && mine.percent === 5 && mine.months === 3, JSON.stringify(mine))
check("…the same one each time", (await ref("/me/referrals")).json?.code === mine.code)
const followed = await fetch(`${BASE}/r/${mine.code.toLowerCase()}`, { redirect: "manual" })
const setCookie = followed.headers.get("set-cookie") ?? ""
check("following it remembers the code for 30 days and goes to the site", followed.status === 307 && setCookie.includes(`gl_ref=${mine.code}`) && /Max-Age=2592000/i.test(setCookie), `${followed.status} ${setCookie}`)
check("an unknown code just goes to the site", !((await fetch(`${BASE}/r/NOPE1234`, { redirect: "manual" })).headers.get("set-cookie") ?? "").includes("gl_ref"))

// ---------- registering through it
const owner = await client("rf-owner@example.com", `gl_ref=${mine.code}`)
const school = (await owner("/schools", { body: { name: "Rf School", slug: "rf-school", type: "school", year: null, grades: null } })).json
const schoolId = psql(`select id from organizations where slug = 'rf-school'`)
check("a school registered from that browser is the referrer's", Boolean(school?.slug) && psql(`select r.code || '|' || (r.referrer_id = u.id) from org_referrals r join users u on u.email = 'rf-ref@example.com' where r.org_id = '${schoolId}'`) === `${mine.code}|true`, JSON.stringify(school))
const self = await client("rf-ref@example.com", `gl_ref=${mine.code}`)
await self("/schools", { body: { name: "Rf Own", slug: "rf-own", type: "school", year: null, grades: null } })
check("…but your own school isn't referred by your own link", psql(`select count(*) from org_referrals r join organizations o on o.id = r.org_id where o.slug = 'rf-own'`) === "0")
check("the referrer sees it, not paying yet", (await ref("/me/referrals")).json?.referrals?.some((r) => r.name === "Rf School" && r.stage === "active"))

// ---------- paying earns the referrer
const want = { features: ["coding"], students: 100, staff: 5, judges: 0, storagePacks: 0, period: "year" }
const pay = async (api, slug, body, id) => {
  const order = (await api(`/orgs/${slug}/billing/checkout`, { body })).json
  if (!order?.orderId) return { order, paid: null }
  const paid = (await api(`/orgs/${slug}/billing/confirm`, { body: { orderId: order.orderId, paymentId: id, signature: sign(`${order.orderId}|${id}`) } })).json
  return { order, paid }
}
const first = await pay(owner, "rf-school", want, "pay_rf1")
const earned = () => psql(`select coalesce(string_agg(amount || ':' || percent || ':' || status, ',' order by created_at), '') from referral_earnings where org_id = '${schoolId}'`)
check("its first payment earns the referrer 5% before GST", first.paid?.paid === true && earned() === `${Math.floor(first.order.total * 0.05)}:5:owed`, `${earned()} · ${JSON.stringify(first.order)?.slice(0, 120)}`)
check("…and opens the window", psql(`select first_paid_at is not null from org_referrals where org_id = '${schoolId}'`) === "t")
const second = await pay(owner, "rf-school", { ...want, students: 200 }, "pay_rf2")
check("a payment within the months earns too", earned().split(",").length === 2 && second.paid?.paid === true, earned())
psql(`update org_referrals set first_paid_at = now() - interval '4 months' where org_id = '${schoolId}'`)
await pay(owner, "rf-school", { ...want, students: 300 }, "pay_rf3")
check("…one after them doesn't", earned().split(",").length === 2, earned())
check("the referrer sees it paying, and what's owed", (await ref("/me/referrals")).json?.referrals?.find((r) => r.name === "Rf School")?.stage === "paying" && (await ref("/me/referrals")).json?.owed > 0)

// ---------- campaign coupons and creator links
check("only the platform's referral managers see the dashboard", (await ref("/admin/referrals")).status === 403)
const mk = (body) => admin("/admin/referrals/codes", { body: { percent: null, months: null, validFrom: null, validTo: null, maxUses: null, active: true, note: "", discountPercent: 0, ownerEmail: null, ...body } })
check("a campaign coupon is made", (await mk({ code: "rf-diwali", kind: "campaign", discountPercent: 10, maxUses: 1 })).json?.code === "RF-DIWALI")
check("someone's personal code can't be taken", (await mk({ code: mine.code, kind: "campaign" })).json?.error?.code === "code_taken")
await admin("/admin/organizations", { body: { name: "Rf Two", slug: "rf-two", type: "college", ownerEmail: "rf-two@example.com" } })
const two = await client("rf-two@example.com")
const full = (await two("/orgs/rf-two/billing/checkout", { body: want })).json
const coupon = await pay(two, "rf-two", { ...want, coupon: "rf-diwali" }, "pay_rf4")
const twoId = psql(`select id from organizations where slug = 'rf-two'`)
check("a coupon takes its discount off, worked out on the server", coupon.order?.total === full.total - Math.round(full.total * 0.1) && psql(`select coupon || ':' || discount from payments where org_id = '${twoId}' and status = 'paid'`) === `RF-DIWALI:${Math.round(full.total * 0.1)}`, `${coupon.order?.total} vs ${full.total}`)
check("…shown on the invoice", psql(`select invoice->'lines'->1->>'description' from payments where org_id = '${twoId}' and status = 'paid'`) === "Promo code: RF-DIWALI")
check("…and earns nobody", psql(`select count(*) from referral_earnings where org_id = '${twoId}'`) === "0" && psql(`select referrer_id is null from org_referrals where org_id = '${twoId}'`) === "t")
await admin("/admin/organizations", { body: { name: "Rf Three", slug: "rf-three", type: "college", ownerEmail: "rf-three@example.com" } })
const three = await client("rf-three@example.com")
const usedUp = await three("/orgs/rf-three/billing/checkout", { body: { ...want, coupon: "RF-DIWALI" } })
check("a used-up coupon is refused, saying so", usedUp.status === 400 && /used up/.test(usedUp.json?.error?.message ?? ""), JSON.stringify(usedUp.json))
await mk({ code: "rf-old", kind: "campaign", discountPercent: 20, validTo: new Date(Date.now() - 86_400_000).toISOString() })
check("an expired one too", /expired/.test((await three("/orgs/rf-three/billing/checkout", { body: { ...want, coupon: "rf-old" } })).json?.error?.message ?? ""))
check("a creator link earns its creator at its own share", (await mk({ code: "rf-asha", kind: "creator", ownerEmail: "rf-creator@example.com", percent: 10 })).status === 200)
await admin("/admin/organizations", { body: { name: "Rf Creator Org", slug: "rf-c-org", type: "college", ownerEmail: "rf-c-org@example.com", referralCode: "rf-asha" } })
const cOrg = await client("rf-c-org@example.com")
const cPaid = await pay(cOrg, "rf-c-org", want, "pay_rf5")
check("…the organization made with it, paying, earns them 10%", psql(`select r.amount || ':' || r.percent from referral_earnings r join organizations o on o.id = r.org_id where o.slug = 'rf-c-org'`) === `${Math.floor(cPaid.order.total * 0.1)}:10`)

// ---------- Apply, who a code is for, and codes that combine
const quote = (api, slug, code, body = want) => api(`/orgs/${slug}/billing/coupon`, { body: { ...body, coupon: code } })
await mk({ code: "rf-new", kind: "campaign", discountPercent: 15, forOrgs: ["new"] })
await mk({ code: "rf-back", kind: "campaign", discountPercent: 20, forOrgs: ["inactive"] })
const threeId = psql(`select id from organizations where slug = 'rf-three'`)
const threeFull = (await three("/orgs/rf-three/billing/checkout", { body: want })).json
const q1 = await quote(three, "rf-three", "rf-new")
check("Apply shows a code's discount and what's left to pay", q1.status === 200 && q1.json?.lines?.length === 1 && q1.json.lines[0].code === "RF-NEW" && q1.json.discount === Math.round(threeFull.total * 0.15) && q1.json.total === threeFull.total - q1.json.discount, JSON.stringify(q1.json))
check("…without making an order or attributing the organization", psql(`select count(*) from payments where org_id = '${threeId}' and coupon = 'RF-NEW'`) === "0" && psql(`select count(*) from org_referrals where org_id = '${threeId}'`) === "0")
const notInactive = await quote(three, "rf-three", "rf-back")
check("a code for inactive organizations is refused for a new one, saying who it's for", notInactive.status === 400 && notInactive.json?.error?.message === "This code is for inactive organizations.", JSON.stringify(notInactive.json))
check("an unknown code is refused", (await quote(three, "rf-three", "rf-nothing")).json?.error?.message === "There's no such code.")
check("Apply needs a code", (await quote(three, "rf-three", " ")).status === 400)
const bigger = { ...want, students: 150 }
const notNew = await quote(two, "rf-two", "rf-new", bigger)
check("a code for new organizations is refused for one that has paid", notNew.status === 400 && notNew.json?.error?.message === "This code is for new organizations.", JSON.stringify(notNew.json))
psql(`update subscriptions set status = 'past_due' where org_id = '${twoId}'`)
check("…and a code for inactive ones works once its plan is past due", (await quote(two, "rf-two", "rf-back", bigger)).json?.lines?.[0]?.code === "RF-BACK")
psql(`update subscriptions set status = 'active' where org_id = '${twoId}'`)
await mk({ code: "rf-pal", kind: "creator", ownerEmail: "rf-pal@example.com", percent: 5, discountPercent: 10 })
await mk({ code: "rf-plus", kind: "campaign", discountPercent: 5, combines: true })
await mk({ code: "rf-solo", kind: "campaign", discountPercent: 5, combines: false })
await admin("/admin/organizations", { body: { name: "Rf Four", slug: "rf-four", type: "college", ownerEmail: "rf-four@example.com", referralCode: "rf-pal" } })
const four = await client("rf-four@example.com")
const fourFull = (await four("/orgs/rf-four/billing/checkout", { body: want })).json
psql(`update payments set status = 'abandoned' where org_id = (select id from organizations where slug = 'rf-four')`)
const plus = (await quote(four, "rf-four", "rf-plus")).json
const ref10 = Math.round((fourFull.total / 0.9) * 0.1)
check("a code that combines adds to the referral discount", plus?.lines?.map((l) => l.code).join() === "RF-PAL,RF-PLUS" && plus.replaced === false && plus.discount === plus.lines[0].amount + plus.lines[1].amount, JSON.stringify(plus))
const solo = (await quote(four, "rf-four", "rf-solo")).json
check("…one that doesn't replaces it, and says so", solo?.lines?.map((l) => l.code).join() === "RF-SOLO" && solo.replaced === true, JSON.stringify(solo))
check("…and its own referral discount alone is what it had", Math.abs(plus.lines[0].amount - ref10) <= 1, `${plus.lines[0].amount} vs ${ref10}`)
const paidPlus = await pay(four, "rf-four", { ...want, coupon: "rf-plus" }, "pay_rf6")
check("paying charges what Apply showed", paidPlus.order?.total === plus.total, `${paidPlus.order?.total} vs ${plus.total}`)
check("…and the invoice lists each discount", psql(`select string_agg(l->>'description', '|') from payments p, jsonb_array_elements(p.invoice->'lines') l where p.org_id = (select id from organizations where slug = 'rf-four') and p.status = 'paid'`).includes("Referral discount: RF-PAL|Promo code: RF-PLUS"))

// ---------- payouts
const board = (await admin("/admin/referrals")).json
const owed = board?.earnings?.filter((e) => e.status === "owed" && e.referrer === "rf-ref@example.com") ?? []
check("the dashboard lists what's owed, first", owed.length === 2 && board.earnings[0].status === "owed" && board.owed >= owed.reduce((n, e) => n + e.amount, 0))
const settled = await admin("/admin/referrals/payouts", { body: { ids: owed.map((e) => e.id), status: "paid", note: "UPI 123" } })
check("marking them paid", settled.status === 200 && psql(`select string_agg(distinct status || ':' || payout_note, ',') from referral_earnings where org_id = '${schoolId}'`) === "paid:UPI 123")
check("…is logged", Number(psql(`select count(*) from audit_log where action = 'referral.payout' and summary like '%paid%'`)) >= 1)
check("…and the referrer sees it paid", (await ref("/me/referrals")).json?.paid === owed.reduce((n, e) => n + e.amount, 0))
check("a referrer can't mark their own paid", (await ref("/admin/referrals/payouts", { body: { ids: [owed[0].id], status: "paid" } })).status === 403)

// ---------- the pages
const browser = await chromium.launch()
const errors = []
try {
  const open = async (email, width) => {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } })
    await ctx.addCookies([{ name: "next-auth.session-token", value: await session(email), url: BASE }])
    const p = await ctx.newPage()
    p.on("pageerror", (e) => errors.push(e.message.slice(0, 200)))
    return p
  }
  const r = await open("rf-ref@example.com", 1440)
  await r.goto(`${BASE}/account/referrals`)
  await r.getByTestId("refer-and-earn").waitFor({ timeout: 30000 })
  check("Account › Refer and earn shows the link", (await r.getByTestId("referral-link").textContent()).includes(`/r/${mine.code}`))
  await r.screenshot({ path: SHOTS + "refer-and-earn.png", fullPage: true })
  const rp = await open("rf-ref@example.com", 390)
  await rp.goto(`${BASE}/account/referrals`)
  await rp.getByTestId("refer-and-earn").waitFor({ timeout: 30000 })
  check("…on a phone, without sideways scrolling", await rp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await rp.screenshot({ path: SHOTS + "refer-and-earn-phone.png", fullPage: true })
  const a = await open("admin@example.com", 1440)
  await a.goto(`${BASE}/admin/referrals`)
  await a.getByRole("tab", { name: "Earnings" }).waitFor({ timeout: 30000 })
  await a.screenshot({ path: SHOTS + "referrals-admin.png", fullPage: true })
  check("the dashboard's page opens, with the sidebar entry", (await a.getByRole("link", { name: "Referrals" }).count()) > 0)
  await a.getByRole("tab", { name: "Links and coupons" }).click()
  await a.getByRole("button", { name: "New link or coupon" }).click()
  await a.getByTestId("code-sheet").waitFor({ timeout: 10000 })
  await a.screenshot({ path: SHOTS + "referrals-code-sheet.png" })
  const plan = await open("rf-three@example.com", 1440)
  await plan.goto(`${BASE}/orgs/rf-three/manage/billing`)
  await plan.getByLabel("Referral code or coupon").waitFor({ timeout: 30000 })
  await plan.getByLabel("Referral code or coupon").fill("rf-back")
  await plan.getByRole("button", { name: "Apply" }).click()
  await plan.getByTestId("coupon-error").waitFor({ timeout: 15000 })
  check("Apply says why a code can't be used", (await plan.getByTestId("coupon-error").innerText()).includes("inactive organizations"))
  await plan.getByLabel("Referral code or coupon").fill("rf-new")
  await plan.getByRole("button", { name: "Apply" }).click()
  await plan.getByTestId("applied-code").waitFor({ timeout: 15000 })
  check("an applied code shows with its discount and the total", (await plan.getByTestId("applied-code").innerText()).includes("RF-NEW") && (await plan.getByTestId("coupon-total").innerText()).includes("To pay"))
  check("…and there's no box for a second code", (await plan.getByLabel("Referral code or coupon").count()) === 0)
  await plan.getByTestId("applied-code").scrollIntoViewIfNeeded()
  await plan.screenshot({ path: SHOTS + "coupon-applied.png", fullPage: true })
  await plan.getByRole("button", { name: "Remove code RF-NEW" }).click()
  check("Remove brings the box back", (await plan.getByLabel("Referral code or coupon").count()) === 1)
  await a.goto(`${BASE}/admin/referrals`)
  await a.getByRole("tab", { name: "Links and coupons" }).click()
  await a.getByRole("button", { name: "Edit RF-NEW" }).click()
  await a.getByTestId("code-sheet").waitFor({ timeout: 10000 })
  check("a code's sheet shows who can use it and whether it combines", await a.getByRole("checkbox", { name: /New/ }).isChecked() && !(await a.getByRole("switch", { name: "Combine with a referral discount" }).isChecked()))
  await a.screenshot({ path: SHOTS + "referrals-code-rules.png" })
  check("no page errors", errors.length === 0, errors.join(" | "))
} finally {
  await browser.close()
  fake.close()
  await admin("/admin/settings", { method: "PATCH", body: { "orgs.self_signup": before?.["orgs.self_signup"] ?? "off", "billing.enabled": false } })
  cleanup()
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll referral checks passed")
process.exit(failures ? 1 : 0)
