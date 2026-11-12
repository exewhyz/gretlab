/**
 * The Hostel module: off until switched on, refused for a company; hostels (duplicate
 * names), runs of rooms (skipping ones there, a backward run), lettered beds; allotting
 * (scoped to a section, a taken bed, moving), the resident and their parent told; changing
 * beds (never an occupied one), renaming, removing rooms and hostels only when empty; a
 * list with first-free beds and a report; who sees whose name; moving out; what a resident
 * and a parent see; the audit; the page and its dialogs, on a phone too.
 *   node e2e/hostel.mjs [base-url] [screenshot-dir]
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
  psql(`delete from organizations where slug in ('hst-school','hst-co')`)
  psql(`delete from users where email like 'hst-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
const people = ["hst-o", "hst-office", "hst-duty", "hst-s1", "hst-s2", "hst-s3", "hst-s4"]
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
await admin("/admin/organizations", { body: { name: "Hst School", slug: "hst-school", type: "school", ownerEmail: "hst-o@example.com" } })
await admin("/admin/organizations", { body: { name: "Hst Co", slug: "hst-co", type: "company", ownerEmail: "hst-o@example.com" } })
const O = "/orgs/hst-school"
const orgId = psql(`select id from organizations where slug='hst-school'`)
const [owner, office, duty, s1] = await Promise.all(people.slice(0, 4).map((h) => client(`${h}@example.com`)))
const grade = (await owner(`${O}/groups`, { body: { name: "Grade 7" } })).json
const secA = (await owner(`${O}/groups`, { body: { name: "Section A", parentId: grade.id } })).json
const secB = (await owner(`${O}/groups`, { body: { name: "Section B", parentId: grade.id } })).json
for (const h of people.slice(1)) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
await owner(`${O}/groups/${secA.id}/members`, { body: { userIds: ["hst-s1", "hst-s2"].map(uid) } })
await owner(`${O}/groups/${secB.id}/members`, { body: { userIds: ["hst-s3", "hst-s4"].map(uid) } })
const officeRole = (await owner(`${O}/roles`, { body: { name: "Hostel office", permissions: ["hostel.rooms"] } })).json
const dutyRole = (await owner(`${O}/roles`, { body: { name: "Warden duty", permissions: ["hostel.allot"] } })).json
await owner(`${O}/members/${uid("hst-office")}/roles`, { body: { roleId: officeRole.id } })
await owner(`${O}/members/${uid("hst-duty")}/roles`, { body: { roleId: dutyRole.id, groupId: secA.id } })
await owner(`${O}/parents`, { body: { studentId: uid("hst-s1"), email: "hst-parent@example.com" } })

// ---------- the module
check("a school has hostels off until switched on", (await owner(`${O}/hostel`)).status === 404)
check("a company can't switch them on", (await owner("/orgs/hst-co", { method: "PATCH", body: { modules: { hostel: true } } })).json?.error?.code === "module_unavailable")
check("a school can", (await owner(O, { method: "PATCH", body: { modules: { hostel: true } } })).status === 200)
check("a student doesn't run hostels", (await s1(`${O}/hostel`)).status === 403)

// ---------- hostels, rooms, beds
const H = (await office(`${O}/hostel`, { body: { name: "Tagore House", forWhom: "Boys", warden: "Mr Rao", wardenPhone: "98450 11111" } })).json
check("the office adds a hostel", H?.name === "Tagore House")
check("the same name twice is refused", (await office(`${O}/hostel`, { body: { name: "tagore house" } })).json?.error?.code === "duplicate")
check("warden duty can't add hostels", (await duty(`${O}/hostel`, { body: { name: "Other" } })).status === 403)
const run = (body) => office(`${O}/hostel/${H.id}/rooms`, { body: { prefix: "", floor: "1", beds: 2, ...body } })
check("a run of rooms is added", (await run({ from: 101, to: 103 })).json?.added === 3)
const again = (await run({ from: 102, to: 104 })).json
check("rooms already there are skipped", again?.added === 1 && again.skipped === 2, JSON.stringify(again))
check("a backward run is refused", (await run({ from: 5, to: 4 })).json?.error?.code === "bad_run")
const rooms = async (who = owner) => (await who(`${O}/hostel/${H.id}/rooms`)).json?.rooms ?? []
const bedIn = async (room, label) => (await rooms()).find((r) => r.name === room).beds.find((b) => b.label === label)
const list = await rooms()
check("each room has lettered beds", list.length === 4 && list.every((r) => r.beds.map((b) => b.label).join() === "A,B"), JSON.stringify(list.map((r) => r.name)))

// ---------- allotting
const allot = async (who, h, room, label) => who(`${O}/hostel/residents`, { body: { userId: uid(h), bedId: (await bedIn(room, label)).id } })
check("the office can't allot beds", (await allot(office, "hst-s1", "101", "A")).status === 403)
check("warden duty gives a Section A student a bed", (await allot(duty, "hst-s1", "101", "A")).status === 200)
check("...not a Section B student", (await allot(duty, "hst-s3", "101", "B")).status === 403)
check("a taken bed is refused", (await allot(duty, "hst-s2", "101", "A")).json?.error?.code === "taken")
await allot(duty, "hst-s2", "101", "B")
check("moving a resident frees their old bed", (await allot(duty, "hst-s1", "102", "A")).status === 200 && !(await bedIn("101", "A")).taken)
const told = (await s1("/me/notifications")).json.notifications
check("the resident is told", told.some((n) => n.kind === "hostel" && n.title === "Your hostel bed: Tagore House, room 102, bed A"), JSON.stringify(told.map((n) => n.title)))
const parent = await client("hst-parent@example.com")
check("...and so is their parent", (await parent("/me/notifications")).json.notifications.some((n) => n.title === "hst-s1 Name: Your hostel bed: Tagore House, room 102, bed A"))
const stay = (await s1("/me/campus")).json.find((c) => c.slug === "hst-school")?.hostel?.stay
check("the resident sees their bed on My classes", stay?.room === "102" && stay.bed === "A" && stay.warden === "Mr Rao" && stay.floor === "1", JSON.stringify(stay))
check("a parent sees it on their child's page", (await parent(`${O}/children/${uid("hst-s1")}`)).json?.campus?.hostel?.stay?.room === "102")

// ---------- changing rooms
const roomId = async (name) => (await rooms()).find((r) => r.name === name).id
const editRoom = async (name, body) => office(`${O}/hostel/rooms/${await roomId(name)}`, { method: "PUT", body: { name, floor: "1", ...body } })
check("fewer beds removes a free one", (await editRoom("102", { beds: 1 })).status === 200 && (await rooms()).find((r) => r.name === "102").beds.length === 1)
check("...never an occupied one", (await editRoom("101", { beds: 1 })).json?.error?.code === "bed_in_use")
check("more beds adds letters", (await editRoom("103", { beds: 3 })).status === 200 && (await rooms()).find((r) => r.name === "103").beds.map((b) => b.label).join() === "A,B,C")
check("a room can't take another's name", (await office(`${O}/hostel/rooms/${await roomId("103")}`, { method: "PUT", body: { name: "101", beds: 3 } })).json?.error?.code === "duplicate")
check("an occupied room can't be removed", (await office(`${O}/hostel/rooms/${await roomId("102")}`, { method: "DELETE" })).json?.error?.code === "occupied")
check("an empty one can", (await office(`${O}/hostel/rooms/${await roomId("104")}`, { method: "DELETE" })).status === 200)
check("an occupied hostel can't be removed", (await office(`${O}/hostel/${H.id}`, { method: "DELETE" })).json?.error?.code === "occupied")

// ---------- a list, names, moving out
const imp = (await owner(`${O}/hostel/residents/import`, { body: { rows: [
  { email: "hst-s3@example.com", hostel: "tagore house", room: "103", bed: "" },
  { email: "hst-s4@example.com", hostel: "Tagore House", room: "101", bed: "a" },
  { email: "nobody-hst@example.com", hostel: "Tagore House", room: "101" },
  { email: "hst-s4@example.com", hostel: "Tagore House", room: "999" },
  { email: "hst-s4@example.com", hostel: "Tagore House", room: "103", bed: "Z" },
] } })).json
check("a list allots first-free and named beds, and reports the rest", imp?.allotted === 2 && imp.failed === 3 && (await bedIn("103", "A")).taken && (await bedIn("101", "A")).taken, JSON.stringify(imp))
const seen = (await rooms(duty)).flatMap((r) => r.beds).filter((b) => b.taken)
check("warden duty sees its section's names, others only as taken", seen.length === 4 && seen.filter((b) => b.resident).length === 2, JSON.stringify(seen))
check("warden duty moves a resident out", (await duty(`${O}/hostel/residents/${uid("hst-s2")}`, { method: "DELETE" })).status === 200 && !(await bedIn("101", "B")).taken)
check("...not another section's", (await duty(`${O}/hostel/residents/${uid("hst-s3")}`, { method: "DELETE" })).status === 403)
const setup = (await owner(`${O}/hostel`)).json.hostels[0]
check("the numbers add up", setup.rooms === 3 && setup.beds === 6 && setup.taken === 3, JSON.stringify(setup))
const log = (await owner(`${O}/audit?limit=200`)).json.entries
check("hostels are in the activity log", ["hostel.add", "hostel.rooms_add", "hostel.room_edit", "hostel.room_delete", "hostel.allot", "hostel.vacate", "hostel.import"].every((a) => log.some((e) => e.action === a)))

// ---------- the pages
const browser = await chromium.launch()
const page = async (email, width = 1100) => {
  const ctx = await browser.newContext({ viewport: { width, height: 1000 } })
  await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), domain: new URL(BASE).hostname, path: "/" }])
  return ctx.newPage()
}
const op = await page("hst-o@example.com")
await op.goto(`${BASE}${O}/manage/hostel`)
await op.getByTestId("rooms").waitFor({ timeout: 30000 })
check("the sidebar lists Hostel under Campus", /CAMPUS[\s\S]*Hostel/i.test(await op.locator('nav[aria-label="Organization"]').innerText()))
await op.getByRole("button", { name: "Add hostel" }).click()
const hd = op.getByRole("dialog", { name: "Add hostel" })
await hd.getByLabel("Name").fill("Sarojini House")
await hd.getByRole("button", { name: "Save" }).click()
await op.getByRole("tab", { name: /Sarojini House/ }).waitFor({ timeout: 15000 })
await op.getByRole("tab", { name: /Sarojini House/ }).click()
await op.getByRole("button", { name: "Add rooms" }).click()
const ad = op.getByRole("dialog", { name: "Add rooms to Sarojini House" })
await ad.getByLabel("Name before the number").fill("S-")
await ad.getByLabel("From").fill("1")
await ad.getByLabel("To").fill("4")
await ad.getByLabel("Beds in each").fill("3")
await ad.getByRole("button", { name: "Add 4 rooms" }).click()
await ad.getByTestId("rooms-report").waitFor({ timeout: 15000 })
await ad.getByRole("button", { name: "Done" }).click()
await op.getByTestId("bed-S-1-A").waitFor({ timeout: 15000 })
check("rooms are added from the dialog", (await op.getByTestId("room").count()) === 4)
await op.getByTestId("bed-S-1-A").click()
const bd = op.getByRole("dialog", { name: "Room S-1, bed A" })
await bd.getByLabel("Give this bed to").fill("hst-s2")
await bd.getByRole("button", { name: /hst-s2 Name/ }).click()
await op.getByTestId("bed-S-1-A").filter({ hasText: "hst-s2 Name" }).waitFor({ timeout: 15000 }).catch(() => {})
check("a free bed is allotted from its dialog", (await op.getByTestId("bed-S-1-A").innerText()).includes("hst-s2 Name"))
await op.screenshot({ path: SHOTS + "hostel.png", fullPage: true })
const sp = await page("hst-s2@example.com")
await sp.goto(`${BASE}/classes`)
await sp.getByTestId("campus-hostel").waitFor({ timeout: 30000 }).catch(() => {})
check("My classes shows the student's bed", (await sp.getByTestId("campus-hostel").innerText().catch(() => "")).includes("Sarojini House, room S-1, bed A"))
const phone = await page("hst-o@example.com", 390)
await phone.goto(`${BASE}${O}/manage/hostel`)
await phone.getByTestId("rooms").waitFor({ timeout: 30000 })
check("no sideways scrolling on a phone", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
await browser.close()

cleanup()
psql(`delete from users where email = 'hst-parent@example.com'`)
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
