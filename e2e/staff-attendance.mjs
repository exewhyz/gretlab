/**
 * Staff attendance: who counts as staff (not students); taking a day's register (times,
 * notes, corrections, no future days, staff only); who may take or see it; self check-in
 * (late after the school's time, once a day, switched off); approved staff leave on the
 * register and in the month; the month report; your own attendance; the log; the pages,
 * on a phone too.
 *   node e2e/staff-attendance.mjs [base-url] [screenshot-dir]
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
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 300)}`
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
    "-Atqc",
    q,
  ])
    .toString()
    .trim()
const cleanup = () => {
  psql(`delete from organizations where slug = 'sa-school'`)
  psql(`delete from users where email like 'sa-%'`)
}
cleanup()
psql(
  `insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`
)
for (const h of ["sa-o", "sa-t1", "sa-t2", "sa-office", "sa-view"])
  psql(
    `insert into users(email,name,role,handle) values ('${h}@example.com','Sa ${h.slice(3)}','student','${h}')`
  )
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, {
      method: method ?? (body === undefined ? "GET" : "POST"),
      headers: { cookie, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
await admin("/admin/organizations", {
  body: {
    name: "Sa School",
    slug: "sa-school",
    type: "school",
    ownerEmail: "sa-o@example.com",
  },
})
const O = "/orgs/sa-school",
  orgId = psql(`select id from organizations where slug='sa-school'`)
const [owner, t1, t2, office, viewer] = await Promise.all(
  ["sa-o", "sa-t1", "sa-t2", "sa-office", "sa-view"].map((h) =>
    client(`${h}@example.com`)
  )
)
const g = (await owner(`${O}/groups`, { body: { name: "Grade 7" } })).json
const a = (await owner(`${O}/groups`, { body: { name: "A", parentId: g.id } }))
  .json
for (const h of ["sa-t1", "sa-t2", "sa-office", "sa-view"])
  psql(
    `insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`
  )
const roles = (await owner(`${O}/roles`)).json
const teacherRole = roles.find((r) => r.systemKey === "teacher").id
await owner(`${O}/members/${uid("sa-t1")}/roles`, {
  body: { roleId: teacherRole, groupId: a.id },
})
await owner(`${O}/members/${uid("sa-t2")}/roles`, {
  body: { roleId: teacherRole, groupId: a.id },
})
const officeRole = (
  await owner(`${O}/roles`, {
    body: { name: "Office", permissions: ["staff_attendance.mark"] },
  })
).json
await owner(`${O}/members/${uid("sa-office")}/roles`, {
  body: { roleId: officeRole.id },
})
const viewRole = (
  await owner(`${O}/roles`, {
    body: { name: "Principal's desk", permissions: ["staff_attendance.view"] },
  })
).json
await owner(`${O}/members/${uid("sa-view")}/roles`, {
  body: { roleId: viewRole.id },
})
await owner(`${O}/academic-years`, {
  body: {
    name: "2026-2027",
    startsOn: "2026-01-01",
    endsOn: "2027-12-31",
    isCurrent: true,
  },
})
const kid = (
  await owner(`${O}/students`, {
    body: {
      name: "Sa Kid",
      email: "sa-s1@example.com",
      groupId: a.id,
      rollNo: 1,
    },
  })
).json
const student = await client("sa-s1@example.com")
check("the set-up worked", !!kid?.id)

// ---------- the register
check(
  "a school has staff attendance on by default",
  (await owner(`${O}/shell`)).json?.modules.includes("staffAttendance")
)
const reg0 = (await office(`${O}/staff-attendance`)).json
const today = reg0?.today
check(
  "staff are members with a role, not students",
  reg0?.staff.map((s) => s.name).join() ===
    "Sa o,Sa office,Sa t1,Sa t2,Sa view",
  reg0?.staff.map((s) => s.name).join()
)
check(
  "each shows their roles",
  reg0?.staff.find((s) => s.name === "Sa t1")?.roles.join() === "Teacher"
)
check(
  "a teacher can't see the staff register",
  (await t1(`${O}/staff-attendance`)).status === 403
)
check(
  "a student can't either",
  (await student(`${O}/staff-attendance`)).status === 403
)
const asViewer = (await viewer(`${O}/staff-attendance`)).json
check(
  "See staff attendance shows it, read only",
  asViewer?.canMark === false && asViewer.staff.length === 5
)
const put = (who, marks, day = today) =>
  who(`${O}/staff-attendance`, { method: "PUT", body: { day, marks } })
check(
  "...and can't mark it",
  (await put(viewer, [{ userId: uid("sa-t1"), status: "present" }])).status ===
    403
)
const marked = await put(office, [
  { userId: uid("sa-t1"), status: "present", checkIn: "08:50" },
  { userId: uid("sa-t2"), status: "absent" },
  { userId: uid("sa-o"), status: "late", checkIn: "09:20", note: "Traffic" },
])
check(
  "the office marks the day",
  marked.json?.counts.present === 1 &&
    marked.json.counts.late === 1 &&
    marked.json.counts.absent === 1,
  JSON.stringify(marked.json?.counts)
)
check(
  "times and notes are kept",
  marked.json?.staff.find((s) => s.name === "Sa o")?.note === "Traffic" &&
    marked.json.staff.find((s) => s.name === "Sa t1")?.checkIn === "08:50"
)
check(
  "those not sent are left unmarked",
  marked.json?.staff.find((s) => s.name === "Sa view")?.status === null
)
check(
  "a student can't be marked",
  (await put(office, [{ userId: kid.id, status: "present" }])).status === 400
)
const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000)
  .toISOString()
  .slice(0, 10)
check(
  "a day that hasn't come can't be marked",
  (await put(office, [{ userId: uid("sa-t1"), status: "present" }], tomorrow))
    .status === 400
)
check(
  "a bad time is refused",
  (
    await put(office, [
      { userId: uid("sa-t1"), status: "present", checkIn: "8:5" },
    ])
  ).status === 400
)
await put(office, [
  { userId: uid("sa-t2"), status: "half_day", note: "Doctor" },
])
check(
  "a correction is logged apart",
  psql(
    `select count(*) from audit_log where org_id='${orgId}' and action='staff_attendance.correct'`
  ) === "1"
)

// ---------- checking in
check(
  "someone already marked can't check in",
  (await t2(`${O}/staff-attendance/me/check-in`, { body: {} })).json?.error
    ?.code === "already_marked"
)
check(
  "a student has no staff attendance",
  (await student(`${O}/staff-attendance/me`)).status === 404 &&
    (await student(`${O}/staff-attendance/me/check-in`, { body: {} }))
      .status === 404
)
check(
  "a teacher can't change the late time",
  (
    await t1(`${O}/staff-attendance/settings`, {
      method: "PUT",
      body: { lateAfter: "10:00", selfCheckIn: true },
    })
  ).status === 403
)
await office(`${O}/staff-attendance/settings`, {
  method: "PUT",
  body: { lateAfter: "00:00", selfCheckIn: true },
})
const before = (await viewer(`${O}/staff-attendance/me`)).json
check(
  "staff not yet marked can check in",
  before?.canCheckIn === true && before.todays === null
)
const ci = await viewer(`${O}/staff-attendance/me/check-in`, { body: {} })
check(
  "checking in after the late time is late, with the time",
  ci.json?.status === "late" && /^\d\d:\d\d$/.test(ci.json.time),
  JSON.stringify(ci.json)
)
check(
  "once a day",
  (await viewer(`${O}/staff-attendance/me/check-in`, { body: {} })).status ===
    409
)
check(
  "the register shows they checked in",
  (await office(`${O}/staff-attendance`)).json?.staff.find(
    (s) => s.name === "Sa view"
  )?.selfCheckIn === true
)
await office(`${O}/staff-attendance/settings`, {
  method: "PUT",
  body: { lateAfter: "09:00", selfCheckIn: false },
})
check(
  "with self check-in off, nobody can",
  (await office(`${O}/staff-attendance/me/check-in`, { body: {} })).status ===
    403 && (await office(`${O}/staff-attendance/me`)).json?.canCheckIn === false
)
await office(`${O}/staff-attendance/settings`, {
  method: "PUT",
  body: { lateAfter: "09:00", selfCheckIn: true },
})

// ---------- approved staff leave
let leaveDay = new Date(Date.parse(`${today}T00:00:00Z`) + 7 * 86_400_000)
while ([0, 6].includes(leaveDay.getUTCDay()))
  leaveDay = new Date(leaveDay.getTime() + 86_400_000)
const ld = leaveDay.toISOString().slice(0, 10)
const lr = (
  await t1(`${O}/leave`, { body: { type: "casual", startsOn: ld, endsOn: ld } })
).json
await owner(`${O}/leave/${lr?.id}/decision`, { body: { status: "approved" } })
const onLeave = (await office(`${O}/staff-attendance?day=${ld}`)).json
check(
  "approved leave shows on the register",
  onLeave?.staff.find((s) => s.name === "Sa t1")?.onLeave === "On leave" &&
    onLeave.canMark === false,
  JSON.stringify(onLeave?.staff?.find((s) => s.name === "Sa t1"))
)
const month = (
  await office(`${O}/staff-attendance/month?month=${ld.slice(0, 7)}`)
).json
check(
  "...and in the month",
  month?.staff.find((s) => s.name === "Sa t1")?.cells[ld] === "on_leave"
)

// ---------- the month and your own
const thisMonth = (await viewer(`${O}/staff-attendance/month`)).json
const t2Row = thisMonth?.staff.find((s) => s.name === "Sa t2")
check(
  "the month counts each person's days",
  t2Row?.cells[today] === "half_day" &&
    t2Row.half === 1 &&
    t2Row.percent === 50,
  JSON.stringify(t2Row)
)
check(
  "the month lists every day, marking days off",
  thisMonth?.days.length >= 28 && thisMonth.days.some((d) => !d.school)
)
check(
  "a teacher can't see the month",
  (await t1(`${O}/staff-attendance/month`)).status === 403
)
const mine = (await t1(`${O}/staff-attendance/me`)).json
check(
  "a teacher sees their own attendance",
  mine?.todays?.status === "present" &&
    mine.todays.checkIn === "08:50" &&
    mine.summary.present === 1,
  JSON.stringify(mine?.todays)
)

// Check-in is only asked for on school days: make every day one, whichever day the suite runs.
const P1 = [
  { name: "Period 1", starts: "09:00", ends: "09:45", isBreak: false },
]
await owner(`${O}/timetable/periods`, {
  method: "PUT",
  body: { days: [1, 2, 3, 4, 5, 6, 7], periods: P1 },
})
const vHome = (await viewer(`${O}/home`)).json
check(
  "office staff who neither run the school nor teach get a staff home",
  vHome?.views.join() === "staff" &&
    vHome.staff.checkIn === true &&
    vHome.staff.links.some((l) => l.label === "Staff attendance"),
  JSON.stringify(vHome?.views)
)
check(
  "the staff home shows today's staff register in numbers",
  vHome?.staff.staffToday?.total === 5 &&
    typeof vHome.staff.staffToday.unmarked === "number",
  JSON.stringify(vHome?.staff?.staffToday)
)
check(
  "teachers have check-in on their home",
  (await t1(`${O}/home`)).json?.teacher?.checkIn === true
)
check(
  "teachers keep the teaching home",
  (await t1(`${O}/home`)).json?.views.join() === "teacher"
)

const log =
  (await owner(`${O}/audit?category=staff_attendance&limit=100`)).json
    ?.entries ?? []
check(
  "staff attendance is in the log",
  [
    "staff_attendance.take",
    "staff_attendance.correct",
    "staff_attendance.check_in",
    "staff_attendance.settings",
  ].every((x) => log.some((e) => e.action === x)),
  log.map((e) => e.action).join()
)

// ---------- the pages
const browser = await chromium.launch()
const view = async (email, width) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  await ctx.addCookies([
    {
      name: "next-auth.session-token",
      value: await encode({ token: { email }, secret: SECRET }),
      domain: new URL(BASE).hostname,
      path: "/",
    },
  ])
  return ctx.newPage()
}
const p = await view("sa-office@example.com", 1440)
await p.goto(`${BASE}${O}/manage/staff-attendance`)
await p.getByTestId("staff-row").first().waitFor({ timeout: 30000 })
check(
  "the register lists the staff",
  (await p.getByTestId("staff-row").count()) === 5
)
await p.getByRole("button", { name: "Sa t2: Present" }).click()
await p.getByRole("button", { name: "Save register" }).click()
await p.getByText("Saved.").waitFor({ timeout: 15000 })
check(
  "the office saves from the page",
  psql(
    `select status from staff_attendance where user_id='${uid("sa-t2")}' and day='${today}'`
  ) === "present"
)
await p.screenshot({ path: SHOTS + "staff-attendance.png", fullPage: true })
await p.getByRole("tab", { name: "Month" }).click()
await p.getByTestId("staff-month-row").first().waitFor({ timeout: 15000 })
check(
  "the month tab shows everyone",
  (await p.getByTestId("staff-month-row").count()) === 5
)
await p.screenshot({ path: SHOTS + "staff-month.png", fullPage: true })
const phone = await view("sa-office@example.com", 390)
await phone.goto(`${BASE}${O}/manage/staff-attendance`)
await phone.getByTestId("staff-row").first().waitFor({ timeout: 30000 })
check(
  "the register fits a phone",
  await phone.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth
  )
)
const tp = await view("sa-t1@example.com", 390)
await tp.goto(`${BASE}${O}/my-attendance`)
await tp.getByTestId("today-status").waitFor({ timeout: 30000 })
check(
  "a teacher's page shows today",
  (await tp.getByTestId("today-status").innerText()).includes("in at 08:50")
)
check(
  "...fitting a phone",
  await tp.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth
  )
)
await tp.screenshot({ path: SHOTS + "my-attendance.png", fullPage: true })
const sp = await view("sa-view@example.com", 1440)
await sp.goto(`${BASE}${O}`)
const nav = sp.getByRole("navigation", { name: "Organization" })
await nav
  .getByRole("link", { name: "My attendance" })
  .waitFor({ timeout: 30000 })
check(
  "staff have My attendance and the register in the sidebar",
  await nav.getByRole("link", { name: "Staff attendance" }).isVisible()
)
check(
  "their home shows today's check-in",
  (await sp.getByTestId("today-status").innerText()).includes("Late")
)
check(
  "...the staff register as a tile, and their pages as cards",
  (await sp
    .getByTestId("staff-tile")
    .filter({ hasText: "Staff present today" })
    .count()) === 1 &&
    (await sp
      .getByTestId("staff-page")
      .filter({ hasText: "Staff attendance" })
      .count()) === 1
)
await sp.screenshot({ path: SHOTS + "staff-home.png", fullPage: true })
const kp = await view("sa-s1@example.com", 1440)
await kp.goto(`${BASE}${O}`)
await kp
  .getByRole("navigation", { name: "Organization" })
  .getByRole("link", { name: "Leave" })
  .waitFor({ timeout: 30000 })
check(
  "students don't get My attendance",
  (await kp
    .getByRole("navigation", { name: "Organization" })
    .getByRole("link", { name: "My attendance" })
    .count()) === 0
)
await browser.close()

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
