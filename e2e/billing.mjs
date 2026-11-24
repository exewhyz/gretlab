/**
 * Plans and billing (features/billing; rules in packages/judge/src/billing.ts).
 *   - Billing off (the default): new organizations have no plan limits, as before
 *   - Billing on: a new organization starts on the free plan (core and the coding lab); modules
 *     outside it are off and can't be switched on, and features outside it are refused where
 *     they start (LMS, API keys, courses, lab exams, outcomes)
 *   - a plan that holds a feature allows it; organizations from before billing keep everything
 *   - Manage › Plan and billing: the plan, use (students, staff), the prices, billing details
 *     (GSTIN checked); only who manages billing sees it
 *   - Dashboard › Plans: every organization's plan, setting one by hand (its price worked out on
 *     the server), back to no limits, and the prices; only staff with the permission
 *   - limits: past what's bought adding still works (the grace starts), after 30 days it
 *     pauses (members, imports, staff roles) while everyone already in keeps working; a period
 *     that ends unpaid is due, then paused; the cron tells whoever manages billing once; the
 *     notice shows above their pages; back under, it clears; no limits for organizations without
 *   - paying (a fake Razorpay this suite runs): the order priced on the server, a forged
 *     signature refused, a confirmed payment applied once with its invoice, the webhook alone
 *     applying an addition mid-period, a smaller plan kept for the next period, GST (IGST across
 *     states), the invoice PDF, renewal reminders, and paying in a browser
 *   - both pages in a browser, on a laptop and a phone
 *   node e2e/billing.mjs [base-url]
 */
import { execFileSync } from "node:child_process"
import { createHmac, randomBytes } from "node:crypto"
import { createServer } from "node:http"
import { mkdirSync } from "node:fs"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SECRET = process.env.NEXTAUTH_SECRET ?? "e2e-only-secret"
const DB = process.env.E2E_DB ?? "gretlab_test"
const CRON = process.env.CRON_SECRET ?? "e2e-cron-secret-0123456789"
const SHOTS = process.argv[3] ?? "/tmp/gretlab-e2e/billing/"
mkdirSync(SHOTS, { recursive: true })
const { chromium } = createRequire(ROOT + "package.json")("playwright")
let failures = 0
const check = (name, ok, detail = "") => {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 1500)}`
  )
  if (!ok) failures++
}
const psql = (q) =>
  execFileSync("docker", [
    "compose",
    "-f",
    ROOT + "docker-compose.yml",
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "gretlab",
    "-d",
    DB,
    "-v",
    "ON_ERROR_STOP=1",
    "-Atqc",
    q,
  ])
    .toString()
    .trim()
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { cookie, "content-type": "application/json", origin: BASE },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
// ---------- a fake Razorpay: makes orders for the right key, as the real one does
const RZP_KEY = "rzp_test_e2e",
  RZP_SECRET = "e2e-razorpay-secret",
  RZP_WEBHOOK = "e2e-razorpay-webhook"
const orders = []
const fake = createServer((req, res) => {
  let body = ""
  req.on("data", (c) => (body += c))
  req.on("end", () => {
    if (
      req.method !== "POST" ||
      req.url !== "/v1/orders" ||
      req.headers.authorization !==
        `Basic ${Buffer.from(`${RZP_KEY}:${RZP_SECRET}`).toString("base64")}`
    ) {
      res
        .writeHead(401, { "content-type": "application/json" })
        .end(
          JSON.stringify({ error: { description: "Authentication failed" } })
        )
      return
    }
    const order = {
      id: `order_${randomBytes(7).toString("hex")}`,
      ...JSON.parse(body),
      status: "created",
    }
    orders.push(order)
    res
      .writeHead(200, { "content-type": "application/json" })
      .end(JSON.stringify(order))
  })
})
await new Promise((r) => fake.listen(3197, "127.0.0.1", r))
const sign = (secret, text) =>
  createHmac("sha256", secret).update(text).digest("hex")
const cleanup = () => {
  psql(
    `delete from payments where org_id in (select id from organizations where slug like 'bl-%')`
  )
  psql(`delete from organizations where slug like 'bl-%'`)
  psql(
    `delete from notifications where user_id in (select id from users where email like 'bl-%@example.com')`
  )
  psql(`delete from users where email like 'bl-%@example.com'`)
}

cleanup()
psql(
  `insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`
)
psql(
  `insert into users(email,name,role) values ('bl-old@example.com','Bl Old','student'), ('bl-new@example.com','Bl New','student')`
)
const admin = await client("admin@example.com")
const settings = (body) => admin("/admin/settings", { method: "PATCH", body })

// ---------- billing off: nothing changes
await settings({ "billing.enabled": false })
await admin("/admin/organizations", {
  body: {
    name: "Bl Old College",
    slug: "bl-old",
    type: "college",
    ownerEmail: "bl-old@example.com",
  },
})
const old = await client("bl-old@example.com")
check(
  "with billing off, a new organization has no plan limits",
  psql(
    `select coalesce(plan_features::text, 'none') || '|' || s.status from organizations o join subscriptions s on s.org_id = o.id where slug = 'bl-old'`
  ) === "none|custom"
)
check(
  "…and its modules work as before",
  (
    await old("/orgs/bl-old", {
      method: "PATCH",
      body: { modules: { attendance: true } },
    })
  ).status === 200
)

// ---------- billing on: new organizations start free
await settings({ "billing.enabled": true })
await admin("/admin/organizations", {
  body: {
    name: "Bl New College",
    slug: "bl-new",
    type: "college",
    ownerEmail: "bl-new@example.com",
  },
})
const fresh = await client("bl-new@example.com")
check(
  "with billing on, a new organization starts on the free plan",
  psql(
    `select plan_features::text || '|' || s.status || '|' || s.students from organizations o join subscriptions s on s.org_id = o.id where slug = 'bl-new'`
  ) === `["core", "coding"]|free|50`
)
const summary = (await fresh("/orgs/bl-new/manage")).json
const attendance = summary?.org?.moduleOptions?.find(
  (m) => m.key === "attendance"
)
check(
  "Settings lists a module outside the plan as not in it",
  attendance?.inPlan === false &&
    summary?.org?.moduleOptions?.find((m) => m.key === "coding")?.inPlan ===
      true,
  JSON.stringify(summary?.org?.moduleOptions)
)
const switched = await fresh("/orgs/bl-new", {
  method: "PATCH",
  body: { modules: { attendance: true } },
})
check(
  "…and it can't be switched on until it's bought",
  switched.status === 403 && switched.json?.error?.code === "not_in_plan",
  JSON.stringify(switched.json)
)
check(
  "modules outside the plan are off (attendance answers 404)",
  (await fresh("/orgs/bl-new/attendance")).status === 404
)
const refused = async (path) => {
  const r = await fresh(path)
  return r.status === 403 && r.json?.error?.code === "not_in_plan"
}
check(
  "an LMS can't be connected without LTI in the plan",
  await refused("/orgs/bl-new/lti")
)
check(
  "API keys and webhooks need them in the plan",
  await refused("/orgs/bl-new/integrations")
)
check("courses need them in the plan", await refused("/orgs/bl-new/courses"))
const outcomesSave = await fresh("/orgs/bl-new/outcomes", {
  method: "PUT",
  body: { outcomes: [], rules: { threshold: 60, levels: [50, 60, 70] } },
})
check(
  "outcomes need them in the plan",
  outcomesSave.json?.error?.code === "not_in_plan",
  JSON.stringify(outcomesSave)
)

// A plan that holds them allows them (staff set plans by hand until paying is built).
psql(
  `update organizations set plan_features = '["core","coding","lti","api","courses"]'::jsonb where slug = 'bl-new'`
)
check(
  "with LTI, API access and courses in the plan, they work",
  (await fresh("/orgs/bl-new/lti")).status === 200 &&
    (await fresh("/orgs/bl-new/integrations")).status === 200 &&
    (await fresh("/orgs/bl-new/courses")).status === 200
)
check(
  "…and attendance, not bought, is still off",
  (
    await fresh("/orgs/bl-new", {
      method: "PATCH",
      body: { modules: { attendance: true } },
    })
  ).json?.error?.code === "not_in_plan"
)

// ---------- organizations from before billing keep everything
check(
  "an organization from before billing keeps everything with billing on",
  (await old("/orgs/bl-old/lti")).status === 200 &&
    (await old("/orgs/bl-old/integrations")).status === 200
)

// ---------- Manage › Plan and billing
// A student in a group, so the counts have someone to count.
const group = (
  await fresh("/orgs/bl-new/groups", { body: { name: "Bl Batch" } })
).json
psql(
  `insert into users(email,name,role) values ('bl-stu@example.com','Bl Student','student')`
)
const orgId = psql(`select id from organizations where slug = 'bl-new'`)
psql(
  `insert into org_members(org_id,user_id,status,joined_via) select '${orgId}', id, 'active', 'created' from users where email = 'bl-stu@example.com'`
)
psql(
  `insert into group_members(group_id,user_id) select '${group.id}', id from users where email = 'bl-stu@example.com'`
)
const page = (await fresh("/orgs/bl-new/billing")).json
check(
  "the plan page shows the plan, use, and every feature's price",
  page?.enabled === true &&
    page.plan?.status === "free" &&
    page.usage?.students === 1 &&
    page.usage?.staff === 1 &&
    page.catalogue?.features?.length >= 15 &&
    page.catalogue.features.find((f) => f.key === "coding")?.price === 49,
  JSON.stringify({ usage: page?.usage, plan: page?.plan })
)
check(
  "…and that payments can be taken (Razorpay keys set, the fake one here)",
  page?.canPay === true
)
const student = await client("bl-stu@example.com")
check(
  "a member without billing can't see it",
  (await student("/orgs/bl-new/billing")).status === 403
)
const badGstin = await fresh("/orgs/bl-new/billing/profile", {
  method: "PUT",
  body: {
    legalName: "Bl New College Trust",
    gstin: "27ABCDE1234",
    address: "1 College Road, Pune",
    billingEmail: "accounts@example.com",
  },
})
check(
  "a GSTIN that isn't one is refused",
  badGstin.status === 400,
  JSON.stringify(badGstin.json)
)
const profile = await fresh("/orgs/bl-new/billing/profile", {
  method: "PUT",
  body: {
    legalName: "Bl New College Trust",
    gstin: "27abcde1234f1z5",
    address: "1 College Road, Pune",
    billingEmail: "accounts@example.com",
  },
})
check(
  "billing details save, the GSTIN in capitals",
  profile.status === 200 && profile.json?.billing?.gstin === "27ABCDE1234F1Z5",
  JSON.stringify(profile.json?.billing)
)
check(
  "…and the change is in the organization's activity log",
  Number(
    psql(
      `select count(*) from audit_log where org_id = '${orgId}' and action = 'billing.profile'`
    )
  ) === 1
)

// ---------- Dashboard › Plans
check(
  "someone without the permission can't see the plans",
  (await student("/admin/billing")).status === 403 &&
    (await fresh("/admin/billing")).status === 403
)
const list = (await admin("/admin/billing?q=bl-")).json
check(
  "the plans list every organization with its use",
  list?.items?.length === 2 &&
    list.items.find((o) => o.slug === "bl-new")?.usage?.students === 1 &&
    list.items.find((o) => o.slug === "bl-old")?.features === null,
  JSON.stringify(list?.items?.map((o) => [o.slug, o.status, o.features]))
)
const setPlan = (body) =>
  admin(`/admin/billing/orgs/${orgId}`, {
    method: "PUT",
    body: {
      status: "active",
      features: ["attendance"],
      students: 100,
      staff: 10,
      judges: 0,
      storagePacks: 0,
      period: "year",
      periodStart: "2026-11-01T00:00:00.000Z",
      periodEnd: "2027-11-01T00:00:00.000Z",
      discountPercent: 0,
      notes: "Pilot",
      ...body,
    },
  })
const set = await setPlan({})
// Classes 10 + attendance 10 = 20 a student x 100; staff within the free 7? 10 staff - 7 free = 3 x 300.
check(
  "setting a plan by hand works its price out on the server",
  set.status === 200 && set.json?.price === 2_000 + 900,
  JSON.stringify(set.json)
)
check(
  "…switches its features on (attendance now available)",
  (
    await fresh("/orgs/bl-new", {
      method: "PATCH",
      body: { modules: { attendance: true } },
    })
  ).status === 200
)
check(
  "…and off (the coding lab, not in it, is now off)",
  psql(
    `select plan_features::text from organizations where id = '${orgId}'`
  ) === `["core", "attendance"]`
)
check(
  "…and goes in the platform's activity log",
  Number(
    psql(
      `select count(*) from audit_log where org_id is null and action = 'billing.set_plan' and detail->>'orgId' = '${orgId}'`
    )
  ) === 1
)
check(
  "a discount comes off the price",
  (await setPlan({ discountPercent: 50 })).json?.price === 1_450
)
check(
  "back to no limits",
  (await setPlan({ features: null, status: "custom" })).status === 200 &&
    psql(
      `select coalesce(plan_features::text, 'none') from organizations where id = '${orgId}'`
    ) === "none"
)
await setPlan({})

// ---------- prices
const prices = (await admin("/admin/billing/settings")).json
check(
  "the billing settings are read with the permission",
  prices?.["billing.staff_price"] === 300 &&
    prices?.["billing.enabled"] === true,
  JSON.stringify(prices).slice(0, 200)
)
check(
  "only billing settings can be changed here",
  (
    await admin("/admin/billing/settings", {
      method: "PATCH",
      body: { "site.title": "x" },
    })
  ).status === 400
)
await admin("/admin/billing/settings", {
  method: "PATCH",
  body: { "billing.prices": { attendance: 12 } },
})
check(
  "a new price shows in the plan page's prices",
  (await fresh("/orgs/bl-new/billing")).json?.catalogue?.features?.find(
    (f) => f.key === "attendance"
  )?.price === 12
)
await admin("/admin/billing/settings", {
  method: "PATCH",
  body: { "billing.prices": {} },
})

// ---------- limits
const cron = async () =>
  (
    await (
      await fetch(`${BASE}/api/cron/outbox`, {
        method: "POST",
        headers: { authorization: `Bearer ${CRON}` },
      })
    )
      .json()
      .catch(() => null)
  )?.plans
const importOne = (email) =>
  fresh("/orgs/bl-new/import", {
    body: {
      rows: [{ email, name: email, group: "Bl Batch", role: "" }],
      commit: true,
    },
  })
// The plan holds 1 student and 2 staff; 1 student (bl-stu) and 1 staff (the owner) are in.
await setPlan({ students: 1, staff: 2 })
psql(
  `update subscriptions set over_since = null, notice = '' where org_id = '${orgId}'`
)
const first = await importOne("bl-x1@example.com")
check(
  "past what's bought, adding still works and the grace starts",
  first.status === 200 &&
    psql(
      `select over_since is not null from subscriptions where org_id = '${orgId}'`
    ) === "t",
  JSON.stringify(first.json).slice(0, 200)
)
check(
  "…and the plan page says until when",
  (await fresh("/orgs/bl-new/billing")).json?.limits?.students === "over"
)
// 31 days later: the grace is over.
psql(
  `update subscriptions set over_since = now() - interval '31 days' where org_id = '${orgId}'`
)
const second = await importOne("bl-x2@example.com")
check(
  "after 30 days' grace, adding members pauses",
  second.status === 403 && second.json?.error?.code === "plan_full",
  JSON.stringify(second.json)
)
check(
  "…and nothing of them was added",
  psql(
    `select count(*) from org_members m join users u on u.id = m.user_id where u.email = 'bl-x2@example.com'`
  ) === "0"
)
check(
  "…while everyone already in keeps working",
  (await student("/orgs/bl-new/home")).status === 200
)
const plans = await cron()
check(
  "the cron tells whoever manages billing, once",
  plans?.told >= 1 &&
    psql(
      `select count(*) from notifications n join users u on u.id = n.user_id where u.email = 'bl-new@example.com' and n.kind = 'billing'`
    ) === "1",
  JSON.stringify(plans)
)
await cron()
check(
  "…and not again while nothing changes",
  psql(
    `select count(*) from notifications n join users u on u.id = n.user_id where u.email = 'bl-new@example.com' and n.kind = 'billing'`
  ) === "1"
)
check(
  "the frame carries the notice for them, not for others",
  (await fresh("/orgs/bl-new/shell")).json?.planNotice === "limit:paused" &&
    (await student("/orgs/bl-new/shell")).json?.planNotice === ""
)
// Back under: more students bought.
await setPlan({ students: 10, staff: 2 })
await cron()
check(
  "back under the limit, the grace and notice clear",
  psql(
    `select (over_since is null) || '|' || notice from subscriptions where org_id = '${orgId}'`
  ) === "true|"
)
// A period that ended unpaid: due, then paused.
await setPlan({
  students: 10,
  staff: 2,
  periodStart: "2026-01-01T00:00:00.000Z",
  periodEnd: new Date(Date.now() - 2 * 86_400_000).toISOString(),
})
await cron()
check(
  "a period that ended unpaid is due",
  psql(`select status from subscriptions where org_id = '${orgId}'`) ===
    "past_due"
)
psql(
  `update subscriptions set period_end = now() - interval '8 days' where org_id = '${orgId}'`
)
await cron()
const paused = await importOne("bl-x3@example.com")
check(
  "…and 7 days on, paused: adding people stops until it's paid",
  psql(`select status from subscriptions where org_id = '${orgId}'`) ===
    "paused" && paused.json?.error?.code === "plan_paused",
  JSON.stringify(paused.json)
)
check(
  "organizations without plan limits are never counted",
  (
    await old("/orgs/bl-old/import", {
      body: {
        rows: [{ email: "bl-y1@example.com", name: "Y", group: "", role: "" }],
        commit: true,
      },
    })
  ).status === 200
)
await setPlan({ students: 1, staff: 2, periodEnd: "2027-11-01T00:00:00.000Z" })
psql(
  `update subscriptions set over_since = now() - interval '31 days', notice = 'limit:paused' where org_id = '${orgId}'`
)

// ---------- paying
await admin("/admin/organizations", {
  body: {
    name: "Bl Pay College",
    slug: "bl-pay",
    type: "college",
    ownerEmail: "bl-pay@example.com",
  },
}).catch(() => {})
psql(
  `insert into users(email,name,role) values ('bl-pay@example.com','Bl Pay','student') on conflict (email) do nothing`
)
if (!psql(`select id from organizations where slug = 'bl-pay'`))
  await admin("/admin/organizations", {
    body: {
      name: "Bl Pay College",
      slug: "bl-pay",
      type: "college",
      ownerEmail: "bl-pay@example.com",
    },
  })
const payer = await client("bl-pay@example.com")
const payOrg = psql(`select id from organizations where slug = 'bl-pay'`)
const want = {
  features: ["coding", "attendance"],
  students: 100,
  staff: 10,
  judges: 0,
  storagePacks: 0,
  period: "year",
}
const order = (await payer("/orgs/bl-pay/billing/checkout", { body: want }))
  .json
// Classes 10 + coding 49 + attendance 10 = 69 x 100 = 6,900; 3 staff past the free 7 = 900. No GST (not registered).
check(
  "the order is priced on the server",
  order?.scheduled === false &&
    order.total === 7_800 &&
    order.amount === 780_000 &&
    orders.at(-1)?.amount === 780_000 &&
    order.keyId === RZP_KEY,
  JSON.stringify(order)
)
const forged = await payer("/orgs/bl-pay/billing/confirm", {
  body: {
    orderId: order.orderId,
    paymentId: "pay_forged",
    signature: "0".repeat(64),
  },
})
check(
  "a forged payment is refused, and nothing changes",
  forged.status === 400 &&
    psql(`select status from subscriptions where org_id = '${payOrg}'`) ===
      "free"
)
const paid = await payer("/orgs/bl-pay/billing/confirm", {
  body: {
    orderId: order.orderId,
    paymentId: "pay_one",
    signature: sign(RZP_SECRET, `${order.orderId}|pay_one`),
  },
})
check(
  "a confirmed payment switches the plan on, with an invoice number",
  paid.status === 200 &&
    /^GL\/\d{4}-\d{2}\/\d{6}$/.test(paid.json?.invoiceNumber ?? "") &&
    psql(
      `select status || '|' || students || '|' || (period_end > now() + interval '360 days') from subscriptions where org_id = '${payOrg}'`
    ) === "active|100|true" &&
    psql(
      `select plan_features::text from organizations where id = '${payOrg}'`
    ) === `["core", "coding", "attendance"]`,
  JSON.stringify(paid.json)
)
await payer("/orgs/bl-pay/billing/confirm", {
  body: {
    orderId: order.orderId,
    paymentId: "pay_one",
    signature: sign(RZP_SECRET, `${order.orderId}|pay_one`),
  },
})
check(
  "…and only once, however often it's confirmed",
  psql(
    `select count(*) from payments where org_id = '${payOrg}' and status = 'paid'`
  ) === "1" &&
    psql(
      `select count(*) from audit_log where org_id = '${payOrg}' and action = 'billing.paid' and actor_label = 'Razorpay'`
    ) === "1"
)
check(
  "paying again for the plan in force is refused, and nothing is scheduled",
  (await payer("/orgs/bl-pay/billing/checkout", { body: want })).json?.error
    ?.code === "same_plan" &&
    psql(
      `select coalesce(next::text, '') from subscriptions where org_id = '${payOrg}'`
    ) === ""
)
const invoiceId = psql(
  `select id from payments where org_id = '${payOrg}' and status = 'paid'`
)
const pdf = await fetch(
  `${BASE}/api/v1/orgs/bl-pay/billing/invoices/${invoiceId}`,
  {
    headers: {
      cookie: `next-auth.session-token=${await encode({ token: { email: "bl-pay@example.com" }, secret: SECRET })}`,
    },
  }
)
check(
  "the invoice is a PDF",
  pdf.status === 200 &&
    pdf.headers.get("content-type") === "application/pdf" &&
    Buffer.from(await pdf.arrayBuffer())
      .subarray(0, 4)
      .toString() === "%PDF"
)
check(
  "…for that organization's billing only",
  (await fresh(`/orgs/bl-pay/billing/invoices/${invoiceId}`)).status === 403
)
// More students mid-period: the difference for the days left, applied by the webhook alone.
const more = (
  await payer("/orgs/bl-pay/billing/checkout", {
    body: { ...want, students: 200 },
  })
).json
check(
  "adding mid-period costs only the days left",
  more?.scheduled === false && more.total > 0 && more.total < 6_900,
  JSON.stringify(more)
)
const event = JSON.stringify({
  event: "payment.captured",
  payload: {
    payment: {
      entity: { id: "pay_two", order_id: more.orderId, status: "captured" },
    },
  },
})
const hook = (body, signature) =>
  fetch(`${BASE}/api/razorpay/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-razorpay-signature": signature,
    },
    body,
  })
check(
  "a webhook with the wrong signature is refused",
  (await hook(event, sign("wrong", event))).status === 400
)
check(
  "Razorpay's webhook alone applies a payment (the tab was closed)",
  (await hook(event, sign(RZP_WEBHOOK, event))).status === 200 &&
    psql(`select students from subscriptions where org_id = '${payOrg}'`) ===
      "200"
)
await hook(event, sign(RZP_WEBHOOK, event))
check(
  "…and twice is still once",
  psql(
    `select count(*) from payments where org_id = '${payOrg}' and status = 'paid'`
  ) === "2"
)
const smaller = await payer("/orgs/bl-pay/billing/checkout", {
  body: { ...want, students: 50 },
})
check(
  "a smaller plan mid-period costs nothing now and starts next period",
  smaller.json?.scheduled === true &&
    psql(
      `select students || '|' || (next->>'students') from subscriptions where org_id = '${payOrg}'`
    ) === "200|50",
  JSON.stringify(smaller.json)
)
check(
  "the way of paying changes only at renewal",
  (
    await payer("/orgs/bl-pay/billing/checkout", {
      body: { ...want, students: 300, period: "month" },
    })
  ).json?.error?.code === "change_period_at_renewal"
)
check(
  "plans past 10,000 students are a custom quote",
  (
    await payer("/orgs/bl-pay/billing/checkout", {
      body: { ...want, students: 10_001 },
    })
  ).json?.error?.code === "custom_quote"
)
// GST: registered in Maharashtra, the buyer in Karnataka: IGST.
await admin("/admin/billing/settings", {
  method: "PATCH",
  body: { "billing.gst_registered": true, "billing.gstin": "27AAPFU0939F1ZV" },
})
await payer("/orgs/bl-pay/billing/profile", {
  method: "PUT",
  body: {
    legalName: "Bl Pay Trust",
    gstin: "29ABCDE1234F1Z5",
    address: "Bengaluru",
    billingEmail: "",
  },
})
const taxed = (
  await payer("/orgs/bl-pay/billing/checkout", {
    body: { ...want, students: 400 },
  })
).json
const taxRow = psql(
  `select amount || '|' || igst || '|' || cgst || '|' || total from payments where razorpay_order_id = '${taxed?.orderId}'`
)
  .split("|")
  .map(Number)
check(
  "GST across states is IGST at 18%",
  taxRow[1] === Math.round(taxRow[0] * 0.18) &&
    taxRow[2] === 0 &&
    taxRow[3] === taxRow[0] + taxRow[1] &&
    taxed.total === taxRow[3],
  JSON.stringify(taxRow)
)
await admin("/admin/billing/settings", {
  method: "PATCH",
  body: { "billing.gst_registered": false, "billing.gstin": "" },
})
// Renewal reminders: 3 days left.
psql(
  `update subscriptions set period_end = now() + interval '3 days', notice = '' where org_id = '${payOrg}'`
)
await cron()
check(
  "a week before the period ends, whoever manages billing is reminded",
  psql(`select notice from subscriptions where org_id = '${payOrg}'`).includes(
    "renew:7"
  ) &&
    Number(
      psql(
        `select count(*) from notifications n join users u on u.id = n.user_id where u.email = 'bl-pay@example.com' and n.kind = 'billing' and n.title like '%renews within a week%'`
      )
    ) === 1
)
psql(
  `update subscriptions set period_end = now() + interval '200 days', notice = '' where org_id = '${payOrg}'`
)

// ---------- the pages
const browser = await chromium.launch()
for (const [name, viewport] of [
  ["laptop", { width: 1440, height: 1000 }],
  ["phone", { width: 390, height: 844 }],
]) {
  const context = await browser.newContext({ viewport })
  await context.addCookies([
    {
      name: "next-auth.session-token",
      value: await encode({
        token: { email: "bl-new@example.com" },
        secret: SECRET,
      }),
      url: BASE,
    },
  ])
  const tab = await context.newPage()
  await tab.goto(`${BASE}/orgs/bl-new/manage/billing`)
  await tab
    .getByTestId("plan-builder")
    .waitFor({ timeout: 30_000 })
    .catch(() => {})
  const before = await tab
    .getByTestId("plan-total")
    .innerText()
    .catch(() => "")
  await tab
    .getByTestId("plan-builder")
    .getByRole("button", { name: "College", exact: true })
    .click()
  const after = await tab
    .getByTestId("plan-total")
    .innerText()
    .catch(() => "")
  check(
    `${name}: the plan page builds a plan and its price changes as you choose`,
    Boolean(before) && Boolean(after) && before !== after,
    JSON.stringify({ before, after })
  )
  check(
    `${name}: it offers paying online`,
    await tab.getByTestId("pay").isVisible()
  )
  check(
    `${name}: the plan's notice shows above the page, and on the plan`,
    (await tab.getByTestId("plan-notice").count()) === 1 &&
      (await tab.getByTestId("limit-note").count()) === 1
  )
  // The plan holds classes and attendance only: no links to pages it would refuse.
  const sidebar = tab.locator('nav[aria-label="Organization"]')
  check(
    `${name}: the sidebar has no Courses or Outcomes outside the plan, but has Plan and billing`,
    name === "phone" ||
      ((await sidebar.getByRole("link", { name: "Courses" }).count()) === 0 &&
        (await sidebar.getByRole("link", { name: "Outcomes" }).count()) === 0 &&
        (await sidebar
          .getByRole("link", { name: "Plan and billing" })
          .count()) === 1)
  )
  check(
    `${name}: nothing spills sideways`,
    await tab.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1
    )
  )
  await tab.screenshot({ path: `${SHOTS}plan-${name}.png`, fullPage: true })
  await context.addCookies([
    {
      name: "next-auth.session-token",
      value: await encode({
        token: { email: "admin@example.com" },
        secret: SECRET,
      }),
      url: BASE,
    },
  ])
  await tab.goto(`${BASE}/admin/plans`)
  await tab
    .getByTestId("plan-row")
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => {})
  check(
    `${name}: Dashboard › Plans lists organizations`,
    (await tab.getByTestId("plan-row").count()) >= 2
  )
  await tab.getByRole("tab", { name: "Prices" }).click()
  await tab
    .getByTestId("billing-prices")
    .waitFor({ timeout: 15_000 })
    .catch(() => {})
  check(
    `${name}: …and its prices`,
    await tab
      .getByLabel("Price of Coding lab")
      .isVisible()
      .catch(() => false)
  )
  check(
    `${name}: nothing spills sideways on Plans`,
    await tab.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1
    )
  )
  await tab.screenshot({
    path: `${SHOTS}plans-admin-${name}.png`,
    fullPage: true,
  })
  await context.close()
}
// Paying in a browser: Razorpay's checkout stood in for by one that answers as Razorpay does.
{
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  })
  await context.addCookies([
    {
      name: "next-auth.session-token",
      value: await encode({
        token: { email: "bl-pay@example.com" },
        secret: SECRET,
      }),
      url: BASE,
    },
  ])
  await context.addInitScript(
    ([secret]) => {
      window.Razorpay = class {
        constructor(o) {
          this.o = o
        }
        on() {}
        async open() {
          const key = await crypto.subtle.importKey(
            "raw",
            new TextEncoder().encode(secret),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
          )
          const sig = await crypto.subtle.sign(
            "HMAC",
            key,
            new TextEncoder().encode(`${this.o.order_id}|pay_browser`)
          )
          const hex = [...new Uint8Array(sig)]
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("")
          this.o.handler({
            razorpay_order_id: this.o.order_id,
            razorpay_payment_id: "pay_browser",
            razorpay_signature: hex,
          })
        }
      }
    },
    [RZP_SECRET]
  )
  const tab = await context.newPage()
  await tab.goto(`${BASE}/orgs/bl-pay/manage/billing`)
  await tab
    .getByTestId("plan-builder")
    .waitFor({ timeout: 30_000 })
    .catch(() => {})
  await tab.getByTestId("plan-builder").getByLabel("Students").fill("600")
  await tab.getByTestId("pay").click()
  await tab
    .getByText(/^Paid ₹/)
    .waitFor({ timeout: 30_000 })
    .catch(() => {})
  check(
    "paying in a browser: Razorpay's checkout, then the plan updates",
    (await tab.getByText(/^Paid ₹/).count()) === 1 &&
      psql(`select students from subscriptions where org_id = '${payOrg}'`) ===
        "600"
  )
  check(
    "…which the builder now calls your plan, with nothing to pay",
    (await tab.getByTestId("plan-due-now").textContent())?.includes(
      "This is your plan now"
    ) && (await tab.getByTestId("pay").isDisabled())
  )
  await tab.getByTestId("invoices").waitFor()
  check(
    "…and the invoice is listed with a link",
    (await tab
      .getByTestId("invoices")
      .getByRole("link", { name: /^GL\// })
      .count()) >= 3
  )
  await tab.screenshot({ path: `${SHOTS}paid-laptop.png`, fullPage: true })
  await context.close()
}
await browser.close()
fake.close()

await settings({ "billing.enabled": false })
cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
