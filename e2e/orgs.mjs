/**
 * Organizations: creating them, joining (open, approval, domain, invite), groups, roles
 * with group scope, the no-escalation rule, owner protection, the activity log, privacy
 * and belonging to several organizations. Then the pages people use.
 *   node e2e/orgs.mjs [base-url] [screenshot-dir]
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

const PEOPLE = {
  admin: ["org-admin@example.com", "admin"],
  owner: ["org-owner@example.com", "student"],
  teacher: ["org-teacher@example.com", "student"],
  s1: ["org-s1@example.com", "student"],
  s2: ["org-s2@example.com", "student"],
  outsider: ["org-outsider@example.com", "student"],
  campus: ["org-d@campus.test", "student"],
  s3: ["org-s3@example.com", "student"],
}
const cleanup = () => {
  // Organizations' problems would outlive them as platform problems, so they go first,
  // after whatever still uses them.
  psql(`delete from assignments where org_id in (select id from organizations where slug like 'orgtest-%')`)
  psql(`delete from contests where org_id in (select id from organizations where slug like 'orgtest-%')`)
  psql(`delete from problems where slug like 'orgtest-%'`)
  psql(`delete from organizations where slug like 'orgtest-%'`)
  psql(`delete from users where email like 'org-%'`)
  psql(`delete from settings where key = 'submissions.per_minute'`)
}
cleanup()
for (const [email, role] of Object.values(PEOPLE)) {
  const handle = email.split("@")[0]
  psql(`insert into users(email,name,role,handle) values ('${email}','${handle}','${role}','${handle}') on conflict (email) do update set role='${role}', disabled=false`)
}
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
psql(`insert into settings(key,value) values ('submissions.per_minute','600') on conflict (key) do update set value='600'`)
const api = Object.fromEntries(await Promise.all(Object.entries(PEOPLE).map(async ([key, [email]]) => [key, await client(email)])))
const anon = async (path) => {
  const res = await fetch(BASE + "/api/v1" + path)
  return { status: res.status, json: await res.json().catch(() => null) }
}
const userId = (key) => psql(`select id from users where email='${PEOPLE[key][0]}'`)
const O = "/orgs/orgtest-college"

// ---------- creating an organization
check("only platform admins create organizations", (await api.owner("/admin/organizations", { body: { name: "X", slug: "orgtest-x", type: "college", ownerEmail: PEOPLE.owner[0] } })).status === 403)
const created = await api.admin("/admin/organizations", { body: { name: "Test College", slug: "orgtest-college", type: "college", ownerEmail: PEOPLE.owner[0] } })
check("platform admin creates a college with an owner", created.status === 200, JSON.stringify(created.json).slice(0, 150))
check("the address must be unique", (await api.admin("/admin/organizations", { body: { name: "Dup", slug: "orgtest-college", type: "college", ownerEmail: PEOPLE.owner[0] } })).status === 409)
const summary = (await api.owner(`${O}/manage`)).json
check("the owner can manage it, with every permission", summary?.isOwner && summary.permissions.length === 16 && summary.org.groupLevels.join() === "Branch,Batch", JSON.stringify(summary?.org))
check("others can't open management", (await api.s1(`${O}/manage`)).status === 403)
const roles = (await api.owner(`${O}/roles`)).json
const role = (key) => roles.find((r) => r.systemKey === key)
check("four built-in roles", ["owner", "admin", "teacher", "member"].every((k) => role(k)))

// ---------- joining
check("listed in the directory", (await anon("/orgs?q=Test%20Coll")).json.some((o) => o.slug === "orgtest-college"))
check("anyone can see a listed organization", (await anon(O)).json?.joinOption === "request")
const asked = await api.s1(`${O}/join`, { body: { shareProgress: true } })
check("approval policy: joining makes a request", asked.json?.status === "pending")
check("a pending member has no roles", (await api.s1(O)).json.permissions.length === 0)
const pending = (await api.owner(`${O}/members?status=pending`)).json
check("the owner sees the request", pending.some((m) => m.email === PEOPLE.s1[0] && m.status === "pending"))
check("a student can't approve requests", (await api.s2(`${O}/members/${userId("s1")}`, { method: "PATCH", body: { status: "active" } })).status === 403)
await api.owner(`${O}/members/${userId("s1")}`, { method: "PATCH", body: { status: "active" } })
check("approved: now an active member", (await api.s1(O)).json.membership.status === "active")

await api.owner(O, { method: "PATCH", body: { emailDomains: ["@campus.test"] } })
check("a matching email domain joins at once", (await api.campus(`${O}/join`, { body: { shareProgress: false } })).json?.status === "active")
await api.owner(O, { method: "PATCH", body: { joinPolicy: "invite" } })
check("invite-only: joining without a link is refused", (await api.outsider(`${O}/join`, { body: { shareProgress: false } })).status === 403)

// ---------- groups
const g = async (name, parentId = null) => (await api.owner(`${O}/groups`, { body: { name, parentId } })).json
const cse = await g("CSE"), ece = await g("ECE")
const batchA = await g("2026-A", cse.id)
check("groups nest as branch then batch", batchA.parentId === cse.id)
check("no deeper than the levels allow", (await api.owner(`${O}/groups`, { body: { name: "Too deep", parentId: batchA.id } })).status === 400)
check("students can't create groups", (await api.s1(`${O}/groups`, { body: { name: "Mine" } })).status === 403)

// ---------- invites
const teacherInvite = (await api.owner(`${O}/invites`, { body: { label: "CSE teachers", roleId: role("teacher").id, groupId: cse.id, maxUses: 1, expiresInDays: 7 } })).json
check("invite link shows what it's for, before sign-in", (await anon(`/invites/${teacherInvite.token}`)).json?.role === "Teacher" && (await anon(`/invites/${teacherInvite.token}`)).json.group === "CSE")
check("a teacher joins with it", (await api.teacher(`/invites/${teacherInvite.token}`, { body: { shareProgress: false } })).status === 200)
check("a one-use link can't be used twice", (await api.s2(`/invites/${teacherInvite.token}`, { body: { shareProgress: false } })).status === 410)
const personal = (await api.owner(`${O}/invites`, { body: { label: "for s2", email: PEOPLE.s2[0] } })).json
check("a personal invite refuses anyone else", (await api.outsider(`/invites/${personal.token}`, { body: { shareProgress: false } })).status === 403)
check("and lets its person in", (await api.s2(`/invites/${personal.token}`, { body: { shareProgress: false } })).status === 200)
const revoked = (await api.owner(`${O}/invites`, { body: { label: "old" } })).json
await api.owner(`${O}/invites/${revoked.id}`, { method: "DELETE" })
check("a turned-off link stops working", (await api.outsider(`/invites/${revoked.token}`, { body: { shareProgress: false } })).status === 410)
check("owners can't be added by invite", (await api.owner(`${O}/invites`, { body: { roleId: role("owner").id } })).status === 403)

// ---------- group-scoped access
await api.owner(`${O}/members/${userId("s1")}`, { method: "PATCH", body: { groupIds: [batchA.id] } })
const seen = (await api.teacher(`${O}/members`)).json.map((m) => m.email)
check("a CSE teacher sees CSE's members", seen.includes(PEOPLE.s1[0]))
check("and nobody outside CSE", !seen.includes(PEOPLE.s2[0]) && !seen.includes(PEOPLE.campus[0]), seen.join(","))
check("a teacher can't remove members", (await api.teacher(`${O}/members/${userId("s1")}`, { method: "DELETE" })).status === 403)

const coordinator = (await api.owner(`${O}/roles`, { body: { name: "Batch coordinator", description: "Runs one batch", permissions: ["org.members.view", "org.members.manage"] } })).json
await api.owner(`${O}/members/${userId("teacher")}/roles`, { body: { roleId: coordinator.id, groupId: batchA.id } })
check("a batch coordinator can move people into their batch", (await api.teacher(`${O}/members/${userId("s2")}`, { method: "PATCH", body: { groupIds: [batchA.id] } })).status === 200)
check("but not into another branch", (await api.teacher(`${O}/members/${userId("s2")}`, { method: "PATCH", body: { groupIds: [batchA.id, ece.id] } })).status === 403)

// ---------- no escalation
const roleManager = (await api.owner(`${O}/roles`, { body: { name: "Role manager", permissions: ["org.roles.manage"] } })).json
await api.owner(`${O}/members/${userId("teacher")}/roles`, { body: { roleId: roleManager.id, groupId: null } })
check("can't create a role with more than you have", (await api.teacher(`${O}/roles`, { body: { name: "Sneaky", permissions: ["org.settings.manage"] } })).status === 403)
check("can't hand out Admin without having it", (await api.teacher(`${O}/members/${userId("s1")}/roles`, { body: { roleId: role("admin").id } })).status === 403)
check("can create a role within what you have", (await api.teacher(`${O}/roles`, { body: { name: "Helper", permissions: ["org.roles.manage"] } })).status === 200)
check("built-in roles can't be edited", (await api.owner(`${O}/roles/${role("teacher").id}`, { method: "PUT", body: { name: "Teacher", permissions: [] } })).status === 400)
check("built-in roles can't be deleted", (await api.owner(`${O}/roles/${role("admin").id}`, { method: "DELETE" })).status === 400)
check("unknown permissions are refused", (await api.owner(`${O}/roles`, { body: { name: "Weird", permissions: ["org.everything"] } })).status === 400)

// ---------- owners
await api.owner(`${O}/members/${userId("s1")}/roles`, { body: { roleId: role("admin").id } })
check("an admin can't make owners", (await api.s1(`${O}/members/${userId("s2")}/roles`, { body: { roleId: role("owner").id } })).status === 403)
check("an admin can't remove the owner", (await api.s1(`${O}/members/${userId("owner")}`, { method: "DELETE" })).status === 403)
check("the last owner can't leave", (await api.owner(`${O}/membership`, { method: "DELETE" })).status === 409)
const ownerAssignment = (await api.owner(`${O}/members`)).json.find((m) => m.email === PEOPLE.owner[0]).roles.find((r) => r.systemKey === "owner")
check("or lose the owner role", (await api.owner(`${O}/role-assignments/${ownerAssignment.assignmentId}`, { method: "DELETE" })).status === 409)
const memberRole = (await api.owner(`${O}/members`)).json.find((m) => m.email === PEOPLE.s2[0]).roles.find((r) => r.systemKey === "member")
check("everyone keeps the Member role", (await api.owner(`${O}/role-assignments/${memberRole.assignmentId}`, { method: "DELETE" })).status === 400)

// ---------- activity log
const log = (await api.owner(`${O}/audit`)).json
check("changes are in the activity log", ["org.create", "member.approve", "role.create", "role.assign", "invite.revoke", "group.create", "member.groups"].every((a) => log.some((e) => e.action === a)), log.map((e) => e.action).join(","))
check("the log needs its permission", (await api.campus(`${O}/audit`)).status === 403)

// ---------- several organizations, leaving, privacy
await api.admin("/admin/organizations", { body: { name: "Test Company", slug: "orgtest-company", type: "company", ownerEmail: PEOPLE.owner[0] } })
await api.owner("/orgs/orgtest-company", { method: "PATCH", body: { joinPolicy: "open" } })
check("a company names its groups as teams", (await api.owner("/orgs/orgtest-company/manage")).json.org.groupLevels.join() === "Team")
check("open policy: join at once", (await api.s1("/orgs/orgtest-company/join", { body: { shareProgress: false } })).json?.status === "active")
const mine = (await api.s1("/me/orgs")).json
check("one person, two organizations", mine.length === 2 && mine.find((o) => o.slug === "orgtest-college").roles.includes("Admin"), JSON.stringify(mine.map((o) => [o.slug, o.roles])))
check("leaving works", (await api.campus(`${O}/membership`, { method: "DELETE" })).status === 200 && (await api.campus(O)).json.membership === null)
await api.owner("/orgs/orgtest-company", { method: "PATCH", body: { listed: false } })
check("an unlisted organization is hidden from outsiders", (await api.outsider("/orgs/orgtest-company")).status === 404 && !(await anon("/orgs")).json.some((o) => o.slug === "orgtest-company"))
check("but its members still see it", (await api.s1("/orgs/orgtest-company")).status === 200)
await api.admin(`/admin/organizations/${psql("select id from organizations where slug='orgtest-college'")}`, { method: "PATCH", body: { active: false } })
check("a suspended organization takes no one", (await api.outsider(`/invites/${(await api.owner(`${O}/invites`, { body: {} })).json?.token ?? "x"}`, { body: { shareProgress: false } })).status >= 400)
await api.admin(`/admin/organizations/${psql("select id from organizations where slug='orgtest-college'")}`, { method: "PATCH", body: { active: true } })


// ================= part 2: content belongs to organizations and is aimed at groups =================
const C = O
const platformProblems = (await api.admin("/admin/problems")).json.problems
const P1 = platformProblems.find((p) => p.slug === "p1").id
const hours = (h) => new Date(Date.now() + h * 3_600_000).toISOString()
const groupsNow = (await api.owner(`${C}/groups`)).json.groups
const gid = (name) => groupsNow.find((g) => g.name === name).id

// ---------- import
const csvRows = [
  { email: PEOPLE.s3[0], name: "S Three", group: "ECE", role: "" },
  { email: "org-new1@example.com", name: "New One", group: "CSE / 2026-B", role: "" },
  { email: "org-new2@example.com", name: "New Two", group: "ECE", role: "Teacher" },
  { email: "not-an-email", name: "", group: "", role: "" },
  { email: PEOPLE.s3[0], name: "", group: "", role: "" },
  { email: "org-new3@example.com", name: "", group: "", role: "Owner" },
]
check("students can't import", (await api.s2(`${C}/import`, { body: { rows: csvRows } })).status === 403)
check("teachers can't import without the permission", (await api.teacher(`${C}/import`, { body: { rows: csvRows } })).status === 403)
const dry = (await api.owner(`${C}/import`, { body: { rows: csvRows } })).json
const why = (line) => dry.rows.find((r) => r.line === line)
check("import check: a missing group is an error until allowed", why(3).action === "error" && /2026-B/.test(why(3).note), JSON.stringify(why(3)))
check("import check: bad email, duplicate and owner rows are errors", why(5).action === "error" && why(6).action === "error" && why(7).action === "error")
check("import check changes nothing", (await api.s3(C)).json.membership === null)
const dry2 = (await api.owner(`${C}/import`, { body: { rows: csvRows, createGroups: true } })).json
check("with creating groups: one new group planned", dry2.counts.newGroups === 1 && dry2.counts.error === 3, JSON.stringify(dry2.counts))
const done = (await api.owner(`${C}/import`, { body: { rows: csvRows, createGroups: true, commit: true } })).json
check("import commits the valid rows", done.committed && done.counts.invite === 2 && done.counts.add === 1, JSON.stringify(done.counts))
check("an imported person is a member, in their group", (await api.s3(C)).json.membership?.status === "active")
const afterImport = (await api.owner(`${C}/members`)).json
const groupsAfter = (await api.owner(`${C}/groups`)).json.groups
const gname = (id) => groupsAfter.find((g) => g.id === id)?.name
check("new people land in a new 2026-B under CSE", afterImport.find((m) => m.email === "org-new1@example.com")?.groupIds.map(gname).includes("2026-B") && groupsAfter.find((g) => g.name === "2026-B").parentId === gid("CSE"))
check("an imported teacher gets the role", afterImport.find((m) => m.email === "org-new2@example.com")?.roles.some((r) => r.systemKey === "teacher"))
check("imports are logged", (await api.owner(`${C}/audit`)).json.some((e) => e.action === "member.import"))

// ---------- the organization's own problems
const template = (await api.admin(`/admin/problems/${P1}`)).json
const problemBody = (over) => ({ ...template, tests: template.tests.map(({ input, expected, isSample, points }) => ({ input, expected, isSample, points })), tags: [], ...over })
const draft = await api.owner(`${C}/problems`, { body: problemBody({ slug: "orgtest-prob", title: "College Problem", published: false }) })
check("an organization writes a draft problem", draft.status === 200, JSON.stringify(draft.json).slice(0, 150))
check("a draft isn't public", (await anon("/problems/orgtest-prob")).status === 404 && !(await anon("/catalog")).json.problems.some((p) => p.id === "orgtest-prob"))
const sub = (api, slug, contestSlug) => api("/submissions", { body: { kind: "run", language: "python", entry: "main.py", files: [{ path: "main.py", content: "print(1)" }], problemSlug: slug, contestSlug, runCases: [{ input: "" }] } })
check("members can't run someone's draft", (await sub(api.s2, "orgtest-prob")).status === 404)
check("its writers can try it", (await sub(api.owner, "orgtest-prob")).status !== 404)
check("platform staff don't see it in their list", !(await api.admin("/admin/problems")).json.problems.some((p) => p.slug === "orgtest-prob"))
await api.owner(`${C}/problems/${draft.json.id}`, { method: "PUT", body: problemBody({ slug: "orgtest-prob", title: "College Problem", published: true }) })
check("published: in the library, credited", (await anon("/catalog")).json.problems.find((p) => p.id === "orgtest-prob")?.by === "Test College")
check("another organization can't open it by id", (await api.owner(`/orgs/orgtest-company/problems/${draft.json.id}`)).status === 404)
const companyDraft = (await api.owner("/orgs/orgtest-company/problems", { body: problemBody({ slug: "orgtest-company-draft", title: "Company Draft", published: false }) })).json

// ---------- contests for a group
const contestBody = (over) => ({ title: "CSE Contest", slug: "orgtest-cse-contest", description: "", startsAt: hours(-0.1), endsAt: hours(2), scoring: "icpc", penaltyMinutes: 20, freezeMinutes: 0, published: true, registrationOpen: true, problemIds: [P1], audience: [[gid("2026-A")]], ...over })
check("a CSE teacher can't run an ECE contest", (await api.teacher(`${C}/contests`, { body: contestBody({ slug: "orgtest-ece", audience: [[gid("ECE")]] }) })).status === 403)
check("or one for the whole college", (await api.teacher(`${C}/contests`, { body: contestBody({ slug: "orgtest-all", audience: [] }) })).status === 403)
check("or use another organization's draft", (await api.teacher(`${C}/contests`, { body: contestBody({ slug: "orgtest-x", problemIds: [companyDraft.id] }) })).status === 400)
const contest = await api.teacher(`${C}/contests`, { body: contestBody({}) })
check("a CSE teacher runs a contest for 2026-A", contest.status === 200, JSON.stringify(contest.json).slice(0, 150))
check("2026-A sees it", (await api.s2("/contests")).json.some((c) => c.slug === "orgtest-cse-contest" && c.org?.name === "Test College") && (await api.s2("/contests/orgtest-cse-contest")).status === 200)
check("ECE doesn't", !(await api.s3("/contests")).json.some((c) => c.slug === "orgtest-cse-contest") && (await api.s3("/contests/orgtest-cse-contest")).status === 404)
check("outsiders and visitors don't", (await api.outsider("/contests/orgtest-cse-contest")).status === 404 && (await anon("/contests/orgtest-cse-contest")).status === 404)
check("2026-A can register", (await api.s2("/contests/orgtest-cse-contest/registration", { body: {} })).status === 200)
check("ECE can't register", (await api.s3("/contests/orgtest-cse-contest/registration", { body: {} })).status === 404)
check("ECE can't read its leaderboard", (await api.s3("/contests/orgtest-cse-contest/leaderboard")).status === 404)
check("2026-A submits to it", (await sub(api.s2, "p1", "orgtest-cse-contest")).status === 200)
check("ECE can't submit to it", (await sub(api.s3, "p1", "orgtest-cse-contest")).status === 404)
check("the platform contest list doesn't include it", !(await api.admin("/admin/contests")).json.some((c) => c.slug === "orgtest-cse-contest"))
check("another organization can't edit it by id", (await api.owner(`/orgs/orgtest-company/contests/${contest.json.id}`, { method: "DELETE" })).status === 404)

// ---------- assignments and grades for a group
const asgBody = (over) => ({ title: "CSE Week 1", slug: "orgtest-cse-week-1", description: "", opensAt: hours(-1), dueAt: hours(48), allowLate: false, latePenaltyPercent: 0, published: true, problems: [{ problemId: P1, points: 100 }], audience: [[gid("CSE")]], ...over })
const asg = await api.teacher(`${C}/assignments`, { body: asgBody({}) })
check("a CSE teacher sets a CSE assignment", asg.status === 200, JSON.stringify(asg.json).slice(0, 150))
check("CSE students have it", (await api.s2("/assignments")).json.some((a) => a.slug === "orgtest-cse-week-1" && a.org?.name === "Test College"))
check("ECE students don't", !(await api.s3("/assignments")).json.some((a) => a.slug === "orgtest-cse-week-1") && (await api.s3("/assignments/orgtest-cse-week-1")).status === 404)
check("the problem page mentions it to CSE only", (await api.s2("/problems/p1/assignments")).json.some((a) => a.slug === "orgtest-cse-week-1") && !(await api.s3("/problems/p1/assignments")).json.some((a) => a.slug === "orgtest-cse-week-1"))
const book = (await api.teacher(`${C}/assignments/${asg.json.id}/gradebook`)).json
const bookEmails = book.rows.map((r) => r.email)
check("gradebook: CSE students, including 2026-B", bookEmails.includes(PEOPLE.s2[0]) && bookEmails.includes("org-new1@example.com"), bookEmails.join(","))
check("gradebook: no ECE students, no teachers or admins", !bookEmails.includes(PEOPLE.s3[0]) && !bookEmails.includes(PEOPLE.teacher[0]) && !bookEmails.includes(PEOPLE.s1[0]))
const wide = (await api.owner(`${C}/assignments`, { body: asgBody({ slug: "orgtest-all-week", title: "Everyone", audience: [] }) })).json
const wideForTeacher = (await api.teacher(`${C}/assignments/${wide.id}/gradebook`)).json.rows.map((r) => r.email)
check("a college-wide assignment: a CSE teacher sees only CSE grades", wideForTeacher.includes(PEOPLE.s2[0]) && !wideForTeacher.includes(PEOPLE.s3[0]))
check("the owner sees everyone's", (await api.owner(`${C}/assignments/${wide.id}/gradebook`)).json.rows.some((r) => r.email === PEOPLE.s3[0]))
const csv = await fetch(`${BASE}/api/v1${C}/assignments/${asg.json.id}/gradebook?format=csv`, { headers: { cookie: `next-auth.session-token=${await encode({ token: { email: PEOPLE.teacher[0] }, secret: SECRET })}` } })
check("a teacher downloads grades as CSV", csv.status === 200 && (await csv.text()).includes(PEOPLE.s2[0]))
check("students can't see grades", (await api.s2(`${C}/assignments/${asg.json.id}/gradebook`)).status === 403)
check("another organization can't read them by id", (await api.owner(`/orgs/orgtest-company/assignments/${asg.json.id}/gradebook`)).status === 404)
check("the platform assignment list doesn't include it", !(await api.admin("/admin/assignments")).json.some((a) => a.slug === "orgtest-cse-week-1"))

// ---------- notices and what members see
check("a teacher posts a notice", (await api.teacher(`${C}/notes`, { body: { text: "Lab moved to room 204" } })).status === 200)
const feed = (await api.s2(`${C}/feed`)).json
check("members see notices, assignments and contests", feed.notices.some((n) => n.text === "Lab moved to room 204") && feed.assignments.some((a) => a.slug === "orgtest-cse-week-1") && feed.contests.some((c) => c.slug === "orgtest-cse-contest"))
check("ECE's view leaves out CSE's assignment", !(await api.s3(`${C}/feed`)).json.assignments.some((a) => a.slug === "orgtest-cse-week-1"))
check("outsiders can't read it", (await api.outsider(`${C}/feed`)).status === 404)
check("organization notices never appear on platform pages", !(await api.admin("/admin/notes")).json.some((n) => n.text === "Lab moved to room 204"))

// ================= part 3: teaching and reports =================
const groups3 = (await api.owner(`${C}/groups`)).json.groups
const g3 = (name) => groups3.find((g) => g.name === name).id
check("teachers see Teach; students don't", (await api.teacher("/me")).json.user.teaches === true && (await api.s2("/me")).json.user.teaches === false)
const home = (await api.teacher("/teach")).json.orgs.find((o) => o.slug === "orgtest-college")
const homeGroups = home?.groups.map((g) => g.name) ?? []
check("teacher home: only the teacher's groups", ["CSE", "2026-A", "2026-B"].every((n) => homeGroups.includes(n)) && !homeGroups.includes("ECE"), homeGroups.join(","))
const T = `${C}/teaching/${g3("2026-A")}`
const topics = [
  { id: "t1", title: "Variables", plannedFor: "2026-01-01" },
  { id: "t2", title: "Strings", plannedFor: "2026-01-02" },
  { id: "t3", title: "Loops", plannedFor: "2099-01-01" },
  { id: "t4", title: "Functions", plannedFor: null },
]
check("students can't edit a syllabus", (await api.s2(T, { method: "PUT", body: { topics } })).status === 403)
check("or for a group the teacher doesn't teach", (await api.teacher(`${C}/teaching/${g3("ECE")}`, { method: "PUT", body: { topics } })).status === 403)
check("a teacher sets their group's syllabus", (await api.teacher(T, { method: "PUT", body: { topics } })).status === 200)
const todayStr = (await api.teacher(T)).json.today
const logged = await api.teacher(`${C}/sessions`, { body: { groupId: g3("2026-A"), day: todayStr, minutes: 60, topicIds: ["t1"], note: "Intro" } })
check("a teacher logs a class", logged.status === 200)
check("not in the future", (await api.teacher(`${C}/sessions`, { body: { groupId: g3("2026-A"), day: "2099-01-01", minutes: 60 } })).status === 400)
check("only syllabus topics", (await api.teacher(`${C}/sessions`, { body: { groupId: g3("2026-A"), day: todayStr, minutes: 60, topicIds: ["nope"] } })).status === 400)
check("not for another group", (await api.teacher(`${C}/sessions`, { body: { groupId: g3("ECE"), day: todayStr, minutes: 60 } })).status === 403)
check("students can't log classes", (await api.s2(`${C}/sessions`, { body: { groupId: g3("2026-A"), day: todayStr, minutes: 60 } })).status === 403)
const progress = (await api.teacher(T)).json.progress
check("progress: covered and behind", progress.covered === 1 && progress.total === 4 && progress.behind.join() === "Strings" && progress.next === "Strings", JSON.stringify(progress))
const other = (await api.owner(`${C}/sessions`, { body: { groupId: g3("2026-A"), day: todayStr, minutes: 30 } })).json
check("a teacher can't remove someone else's class", (await api.teacher(`${C}/sessions/${other.id}`, { method: "DELETE" })).status === 403)
check("the owner can", (await api.owner(`${C}/sessions/${other.id}`, { method: "DELETE" })).status === 200)
check("teacher home counts this week's classes", (await api.teacher("/teach")).json.orgs.find((o) => o.slug === "orgtest-college").myClassesThisWeek === 1)

const report = (await api.teacher(`${C}/reports`)).json
const reportEmails = report.students.map((r) => r.email)
check("reports: a CSE teacher sees CSE students", reportEmails.includes(PEOPLE.s2[0]) && reportEmails.includes("org-new1@example.com"), reportEmails.join(","))
check("reports: no ECE students and no teachers", !reportEmails.includes(PEOPLE.s3[0]) && !reportEmails.includes(PEOPLE.teacher[0]))
const s2row = report.students.find((r) => r.email === PEOPLE.s2[0])
check("work for the organization counts as activity", s2row.activeThisWeek === true)
check("practice stays private without consent", s2row.practiceSolved === null)
check("reports list assignments and teaching", report.assignments.some((a) => a.title === "CSE Week 1") && report.teaching.groups.some((g) => g.path === "CSE › 2026-A"))
check("students can't see reports", (await api.s2(`${C}/reports`)).status === 403)
check("a teacher can't report on another branch", (await api.teacher(`${C}/reports?group=${g3("ECE")}`)).status === 403)
await api.s3(`${C}/membership`, { method: "PATCH", body: { shareProgress: true } })
const ownerReport = (await api.owner(`${C}/reports`)).json
check("the owner sees everyone, and shared practice", typeof ownerReport.students.find((r) => r.email === PEOPLE.s3[0])?.practiceSolved === "number")
const reportCsv = await fetch(`${BASE}/api/v1${C}/reports?format=csv`, { headers: { cookie: `next-auth.session-token=${await encode({ token: { email: PEOPLE.teacher[0] }, secret: SECRET })}` } })
const reportText = await reportCsv.text()
check("reports download as CSV, in the teacher's scope", reportCsv.status === 200 && reportText.includes(PEOPLE.s2[0]) && !reportText.includes(PEOPLE.s3[0]))

// ================= part 4: members-only problems, code in gradebooks, feedback, rules =================
const settleOrg = async (api, id) => {
  for (let i = 0; i < 600; i++) {
    const r = await api(`/submissions/${id}`)
    if (r.json?.status === "done") return r.json
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error("timeout")
}
const SI = 'principal = float(input())\nrate = float(input())\ntime = float(input())\nsi = principal * rate * time / 100\nprint(f"Simple Interest: {si:.2f}")\nprint(f"Total Amount: {principal + si:.2f}")\n'
const runAs = (api, slug, language = "python", contestSlug) => api("/submissions", { body: { kind: "run", language, entry: language === "python" ? "main.py" : "main.js", files: [{ path: language === "python" ? "main.py" : "main.js", content: language === "python" ? "print(1)" : "console.log(1)" }], problemSlug: slug, contestSlug, runCases: [{ input: "" }] } })

// ---------- members-only problems
const priv = await api.owner(`${C}/problems`, { body: problemBody({ slug: "orgtest-private", title: "Members Only Problem", published: true, membersOnly: true }) })
check("an organization publishes a members-only problem", priv.status === 200)
check("it's not on public pages or in the library", (await anon("/problems/orgtest-private")).status === 404 && !(await anon("/catalog")).json.problems.some((p) => p.id === "orgtest-private"))
check("members find it on the organization's page", (await api.s2(`${C}/practice`)).json.summaries.some((p) => p.id === "orgtest-private" && p.membersOnly))
check("members open it there", (await api.s2(`${C}/practice/orgtest-private`)).status === 200)
check("outsiders can't open it", (await api.outsider(`${C}/practice/orgtest-private`)).status === 404)
check("outsiders can't run it", (await runAs(api.outsider, "orgtest-private")).status === 404)
check("members can run it", (await runAs(api.s2, "orgtest-private")).status === 200)
check("outsiders can't read its solution", (await api.outsider("/problems/orgtest-private/solution")).status === 404)
check("other organizations can't pick it", !(await api.owner("/orgs/orgtest-company/problems?for=picker")).json.problems.some((p) => p.slug === "orgtest-private"))
check("or put it in their contests", (await api.owner("/orgs/orgtest-company/contests", { body: contestBody({ slug: "orgtest-steal", audience: [], problemIds: [priv.json.id] }) })).status === 400)
const privAsg = await api.owner(`${C}/assignments`, { body: asgBody({ slug: "orgtest-private-week", title: "Private week", audience: [], problems: [{ problemId: priv.json.id, points: 10 }] }) })
check("its own organization can assign it", privAsg.status === 200)
check("the assignment links to the members' page", (await api.s2("/assignments/orgtest-private-week")).json.problems[0].href === "/orgs/orgtest-college/practice/orgtest-private")

// ---------- code from the gradebook
const graded = await api.s2("/submissions", { body: { kind: "submit", language: "python", entry: "main.py", files: [{ path: "main.py", content: SI }], problemSlug: "p1" } })
await settleOrg(api.s2, graded.json.id)
const attemptsUrl = (email) => `${C}/assignments/${asg.json.id}/attempts?student=${encodeURIComponent(email)}&problem=${P1}`
const seenCode = (await api.teacher(attemptsUrl(PEOPLE.s2[0]))).json
check("a teacher reads a student's graded code from the gradebook", seenCode?.attempts?.some((a) => a.files[0].content.includes("principal") && a.verdict === "AC"), JSON.stringify(seenCode).slice(0, 150))
check("not for students outside their groups", (await api.teacher(`${C}/assignments/${wide.id}/attempts?student=${encodeURIComponent(PEOPLE.s3[0])}&problem=${P1}`)).status === 404)
check("students can't read others' code", (await api.s3(attemptsUrl(PEOPLE.s2[0]))).status === 403)

// ---------- class feedback
const toRate = (await api.s2(`${C}/classes-to-rate`)).json
check("students see their group's recent classes to rate", toRate.some((c) => c.group === "2026-A"))
check("teachers aren't asked to rate their own", !(await api.teacher(`${C}/classes-to-rate`)).json.some((c) => c.group === "2026-A"))
const sessionId = toRate.find((c) => c.group === "2026-A").id
check("a student rates a class", (await api.s2(`${C}/sessions/${sessionId}/feedback`, { body: { rating: 4, comment: "Clear examples" } })).status === 200)
check("only once", (await api.s2(`${C}/sessions/${sessionId}/feedback`, { body: { rating: 1 } })).status === 403)
check("not a class from another group", (await api.s3(`${C}/sessions/${sessionId}/feedback`, { body: { rating: 1 } })).status === 403)
check("ratings stay between 1 and 5", (await api.s3(`${C}/sessions/${sessionId}/feedback`, { body: { rating: 9 } })).status === 400)
const rated = (await api.teacher(T)).json.sessions.find((x) => x.id === sessionId)
check("teachers see the average and comments, without names", rated.rating?.average === 4 && rated.rating.count === 1 && rated.rating.comments[0] === "Clear examples" && !JSON.stringify(rated).includes(PEOPLE.s2[0]))
check("reports show teachers' ratings", (await api.owner(`${C}/reports`)).json.teaching.teachers.some((t) => t.rating === 4))

// ---------- the organization's rules: languages and pasting
check("settings: Python only, no pasting", (await api.owner(C, { method: "PATCH", body: { languages: ["python"], allowPaste: false } })).status === 200)
const contestProblem = (await api.s2("/contests/orgtest-cse-contest/problems/A")).json.problem
check("contest problems offer only allowed languages, and block pasting", contestProblem.allowedLanguages?.join() === "python" && contestProblem.pasteBlocked === true, JSON.stringify([contestProblem.allowedLanguages, contestProblem.pasteBlocked]))
check("other languages are refused in its contests", (await runAs(api.s2, "p1", "javascript", "orgtest-cse-contest")).json?.error?.code === "language_unavailable")
check("and on its members-only problems", (await runAs(api.s2, "orgtest-private", "javascript")).json?.error?.code === "language_unavailable")
check("but not on public problems", (await runAs(api.s2, "p1", "javascript")).status === 200)
await api.owner(C, { method: "PATCH", body: { languages: null, allowPaste: true } })

// ================= part 5: conditions (3rd year AND CAC) and managing a group's people =================
// Third year with two sections, and subjects as their own groups.
const y3 = (await api.owner(`${C}/groups`, { body: { name: "3rd Year", parentId: null } })).json
const secA = (await api.owner(`${C}/groups`, { body: { name: "Sec A", parentId: y3.id } })).json
const secB = (await api.owner(`${C}/groups`, { body: { name: "Sec B", parentId: y3.id } })).json
const cac = (await api.owner(`${C}/groups`, { body: { name: "CAC", parentId: null } })).json
const dsa = (await api.owner(`${C}/groups`, { body: { name: "DSA", parentId: null } })).json
await api.owner(`${C}/import`, { body: { commit: true, rows: [
  { email: "org-ya1@example.com", name: "Y A1", group: "3rd Year / Sec A" },
  { email: "org-yb1@example.com", name: "Y B1", group: "3rd Year / Sec B" },
  { email: "org-ya2@example.com", name: "Y A2", group: "3rd Year / Sec A" },
  { email: "org-cact@example.com", name: "CAC Teacher", group: "" },
] } })
const uid = (email) => psql(`select id from users where email='${email}'`)
check("a group's people can be added directly", (await api.owner(`${C}/groups/${cac.id}/members`, { body: { userIds: [uid("org-ya1@example.com"), uid("org-yb1@example.com")] } })).status === 200)
await api.owner(`${C}/groups/${dsa.id}/members`, { body: { userIds: [uid("org-ya2@example.com")] } })
check("only members can be added", (await api.owner(`${C}/groups/${cac.id}/members`, { body: { userIds: [uid(PEOPLE.outsider[0])] } })).status === 400)
check("students can't add people to groups", (await api.s2(`${C}/groups/${cac.id}/members`, { body: { userIds: [uid(PEOPLE.s2[0])] } })).status === 403)
const y3people = (await api.owner(`${C}/groups/${y3.id}/members`)).json.people
check("a year shows everyone in its sections, with where they sit", y3people.length === 3 && y3people.find((p) => p.email === "org-ya1@example.com")?.in.includes("Sec A"), JSON.stringify(y3people.map((p) => [p.email, p.in])))

const preview = async (audience) => (await api.owner(`${C}/audience`, { body: { audience } })).json.count
check("3rd Year reaches all three", (await preview([[y3.id]])) === 3)
check("3rd Year and also CAC reaches CAC students of every section", (await preview([[y3.id], [cac.id]])) === 2)
check("Sec A and also CAC reaches one", (await preview([[secA.id], [cac.id]])) === 1)
check("CAC or DSA, in 3rd Year, reaches all three", (await preview([[y3.id], [cac.id, dsa.id]])) === 3)

const y3cac = await api.owner(`${C}/assignments`, { body: asgBody({ slug: "orgtest-y3-cac", title: "3rd year CAC", audience: [[y3.id], [cac.id]] }) })
check("an assignment for 3rd Year and also CAC", y3cac.status === 200)
const has = async (email) => (await (await client(email))("/assignments")).json.some((a) => a.slug === "orgtest-y3-cac")
check("CAC students of both sections get it", (await has("org-ya1@example.com")) && (await has("org-yb1@example.com")))
check("a 3rd year student without CAC doesn't", !(await has("org-ya2@example.com")))
const cacBook = (await api.owner(`${C}/assignments/${y3cac.json.id}/gradebook`)).json.rows.map((r) => r.email).sort()
check("its gradebook is exactly those students", cacBook.join() === "org-ya1@example.com,org-yb1@example.com", cacBook.join())

const teacherRole = (await api.owner(`${C}/roles`)).json.find((r) => r.systemKey === "teacher")
await api.owner(`${C}/members/${uid("org-cact@example.com")}/roles`, { body: { roleId: teacherRole.id, groupId: cac.id } })
const cacTeacher = await client("org-cact@example.com")
check("a CAC teacher may set work for 3rd Year and also CAC", (await cacTeacher(`${C}/assignments`, { body: asgBody({ slug: "orgtest-cact-1", title: "CAC quiz", audience: [[y3.id], [cac.id]] }) })).status === 200)
check("but not for all of 3rd Year", (await cacTeacher(`${C}/assignments`, { body: asgBody({ slug: "orgtest-cact-2", title: "Year quiz", audience: [[y3.id]] }) })).status === 403)
check("conditions must be the organization's groups", (await api.owner(`${C}/assignments`, { body: asgBody({ slug: "orgtest-foreign", audience: [[draft.json.id]] }) })).status === 404)
check("removing someone from a group works", (await api.owner(`${C}/groups/${dsa.id}/members/${uid("org-ya2@example.com")}`, { method: "DELETE" })).status === 200 && (await preview([[dsa.id]])) === 0)

// ================= part 6: adding to a parent adds to every last-level group inside =================
const imp = async (rows, commit = true) => (await api.owner(`${C}/import`, { body: { commit, rows } })).json
const yzCheck = (await imp([{ email: "org-yz@example.com", name: "Y Z", group: "3rd Year" }], false)).rows[0]
check("an import into a year says it joins every section", yzCheck.action !== "error" && /joins all 2 groups inside 3rd Year/.test(yzCheck.note), yzCheck.note)
await imp([{ email: "org-yz@example.com", name: "Y Z", group: "3rd Year" }])
check("and puts them in each section", (await preview([[secA.id]])) === 3 && (await preview([[secB.id]])) === 2)
await api.owner(`${C}/groups/${y3.id}/members`, { body: { userIds: [uid("org-ya2@example.com")] } })
check("adding to a year from its panel adds to each section", (await preview([[secB.id]])) === 3)
await api.owner(`${C}/groups/${secB.id}/members/${uid("org-ya2@example.com")}`, { method: "DELETE" })
await api.owner(`${C}/members/${uid(PEOPLE.s3[0])}`, { method: "PATCH", body: { groupIds: [gid("ECE"), y3.id] } })
check("ticking a year in the member editor adds each section", (await preview([[secA.id], [gid("ECE")]])) === 1)
await api.owner(`${C}/members/${uid(PEOPLE.s3[0])}`, { method: "PATCH", body: { groupIds: [gid("ECE")] } })
check("student invites into a year are fine now", (await api.owner(`${C}/invites`, { body: { groupId: y3.id } })).status === 200)

// Labs inside sections: Sec A gets one, Sec B two. 3rd Year then has three at the bottom.
check("adding a level works", (await api.owner(C, { method: "PATCH", body: { groupLevels: ["Year", "Section", "Lab"] } })).status === 200)
const lab1 = (await api.owner(`${C}/groups`, { body: { name: "Lab 1", parentId: secA.id } })).json
check("a section's first lab takes its people with it", lab1.movedDown === 3 && (await preview([[lab1.id]])) === 3, JSON.stringify(lab1))
check("they still count for their section and year", (await preview([[secA.id]])) === 3 && (await preview([[y3.id], [cac.id]])) === 2)
const lab2 = (await api.owner(`${C}/groups`, { body: { name: "Lab 2", parentId: secB.id } })).json
const lab3 = (await api.owner(`${C}/groups`, { body: { name: "Lab 3", parentId: secB.id } })).json
check("a second lab starts empty", lab3.movedDown === 0 && (await preview([[lab3.id]])) === 0 && (await preview([[lab2.id]])) === 2)
const ywNote = (await imp([{ email: "org-yw@example.com", name: "Y W", group: "3rd Year" }], false)).rows[0].note
check("a year with labs: one in Sec A, two in Sec B, three in all", /joins all 3 groups inside/.test(ywNote), ywNote)
await imp([{ email: "org-yw@example.com", name: "Y W", group: "3rd Year" }])
check("and the person lands in all three", [lab1, lab2, lab3].every(Boolean) && (await preview([[lab1.id]])) === 4 && (await preview([[lab2.id]])) === 3 && (await preview([[lab3.id]])) === 1)
const panelNote = (await api.owner(`${C}/groups/${y3.id}/members`)).json
check("the year's panel lists those three as where people go", panelNote.places.length === 3)

// Deleting a group with people asks first; forcing it takes them out, moving nobody.
check("a lab with people isn't deleted without saying so", (await api.owner(`${C}/groups/${lab2.id}`, { method: "DELETE" })).json?.error?.code === "group_not_empty" && (await preview([[lab2.id]])) === 3)
check("deleting it anyway takes its people out of it", (await api.owner(`${C}/groups/${lab2.id}?force=true`, { method: "DELETE" })).status === 200)
check("and moves nobody into the section's other labs", (await preview([[secB.id]])) === 1 && (await preview([[lab3.id]])) === 1)
check("nobody is left waiting in the section", (await api.owner(`${C}/groups`)).json.groups.find((g) => g.id === secB.id).notPlaced === 0)
const emptyLab = (await api.owner(`${C}/groups`, { body: { name: "Lab Empty", parentId: secB.id } })).json
check("an empty group deletes straight away", (await api.owner(`${C}/groups/${emptyLab.id}`, { method: "DELETE" })).status === 200)
check("removing a level that's in use is refused", (await api.owner(C, { method: "PATCH", body: { groupLevels: ["Year", "Section"] } })).json?.error?.code === "levels_in_use")
// Someone sitting directly in a section with labs (from older data) can still be placed.
psql(`insert into group_members(group_id, user_id) values ('${secB.id}', '${uid("org-yz@example.com")}'), ('${secB.id}', '${uid("org-yb1@example.com")}') on conflict do nothing`)
check("people sitting in a section with labs show as not placed", (await api.owner(`${C}/groups`)).json.groups.find((g) => g.id === secB.id).notPlaced === 2)
check("placing needs a group inside", (await api.owner(`${C}/groups/${secB.id}/place`, { body: { into: secA.id, userIds: [uid("org-yz@example.com")] } })).status === 400)
check("placing moves them in", (await api.owner(`${C}/groups/${secB.id}/place`, { body: { into: lab3.id, userIds: [uid("org-yz@example.com")] } })).status === 200 && (await preview([[lab3.id]])) === 2)
// Before deleting: move people elsewhere, or empty the group and keep it.
const labM = (await api.owner(`${C}/groups`, { body: { name: "Lab M", parentId: secB.id } })).json
await api.owner(`${C}/groups/${labM.id}/members`, { body: { userIds: [uid("org-yw@example.com")] } })
check("moving people into a group inside the one being emptied is refused", (await api.owner(`${C}/groups/${secB.id}/move`, { body: { into: labM.id } })).status === 400)
check("students can't move a group's people", (await api.s2(`${C}/groups/${labM.id}/move`, { body: { into: lab3.id } })).status === 403)
check("moving a group's people out works", (await api.owner(`${C}/groups/${labM.id}/move`, { body: { into: lab1.id } })).json?.moved === 1 && (await preview([[labM.id]])) === 0 && (await preview([[lab1.id]])) >= 1)
check("an emptied-by-moving group deletes without forcing", (await api.owner(`${C}/groups/${labM.id}`, { method: "DELETE" })).status === 200)
const labE = (await api.owner(`${C}/groups`, { body: { name: "Lab E", parentId: secB.id } })).json
await api.owner(`${C}/groups/${labE.id}/members`, { body: { userIds: [uid("org-yw@example.com")] } })
check("emptying a group keeps it and takes everyone out", (await api.owner(`${C}/groups/${labE.id}/empty`, { body: {} })).json?.removed === 1 && (await api.owner(`${C}/groups`)).json.groups.some((g) => g.id === labE.id) && (await preview([[labE.id]])) === 0)
check("students can't empty groups", (await api.s2(`${C}/groups/${labE.id}/empty`, { body: {} })).status === 403)
await api.owner(`${C}/groups/${labE.id}`, { method: "DELETE" })
// A lab to move people out of from the page.
const labY = (await api.owner(`${C}/groups`, { body: { name: "Lab Y", parentId: secA.id } })).json
await api.owner(`${C}/groups/${labY.id}/members`, { body: { userIds: [uid("org-ya1@example.com")] } })

// A lab with one person, for deleting from the page.
const labZ = (await api.owner(`${C}/groups`, { body: { name: "Lab Z", parentId: secA.id } })).json
await api.owner(`${C}/groups/${labZ.id}/members`, { body: { userIds: [uid("org-ya2@example.com")] } })
const labX = lab3
// Moving and removing chosen people, as the panel does.
const lab4 = (await api.owner(`${C}/groups`, { body: { name: "Lab 4", parentId: secB.id } })).json
const lab1Count = await preview([[lab1.id]])
check("chosen people move between labs of one section", (await api.owner(`${C}/groups/${lab3.id}/move`, { body: { into: lab4.id, userIds: [uid("org-yz@example.com")] } })).json?.moved === 1 && (await preview([[lab3.id]])) === 1 && (await preview([[lab4.id]])) === 1)
check("and from a section into one of its own labs", (await api.owner(`${C}/groups/${secB.id}/move`, { body: { into: lab3.id, userIds: [uid("org-yz@example.com")] } })).status === 200 && (await preview([[lab3.id]])) === 2 && (await preview([[lab4.id]])) === 0)
check("moving people into the group they're in is refused", (await api.owner(`${C}/groups/${lab3.id}/move`, { body: { into: lab3.id, userIds: [uid("org-yz@example.com")] } })).status === 400)
await api.owner(`${C}/groups/${lab4.id}/members`, { body: { userIds: [uid("org-yw@example.com")] } })
check("students can't remove people from groups", (await api.s2(`${C}/groups/${secB.id}/members/remove`, { body: { userIds: [uid("org-yw@example.com")] } })).status === 403)
check("removing from a section takes them out of its labs", (await api.owner(`${C}/groups/${secB.id}/members/remove`, { body: { userIds: [uid("org-yw@example.com")] } })).status === 200 && (await preview([[lab4.id]])) === 0)
check("and leaves their other groups alone", (await preview([[lab1.id]])) === lab1Count)
await api.owner(`${C}/groups/${lab3.id}/members`, { body: { userIds: [uid("org-yw@example.com")] } }) // they were in Lab 3 too

if (process.env.ORGS_API_ONLY) {
  cleanup()
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
  process.exit(failures ? 1 : 0)
}

// ---------- the pages
const browser = await chromium.launch()
const errors = []
const open = async (email) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  if (email) await ctx.addCookies([{ name: "next-auth.session-token", value: await encode({ token: { email }, secret: SECRET }), url: BASE }])
  const page = await ctx.newPage()
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 200)))
  page.on("console", (m) => {
    if (m.type() === "error" && !/40\d|Failed to load/.test(m.text())) errors.push(`${page.url().replace(BASE, "")}: ${m.text().slice(0, 160)}`)
  })
  return page
}

const s = await open(PEOPLE.s1[0])
await s.goto(`${BASE}/orgs`)
await s.getByTestId("my-org").first().waitFor({ timeout: 30000 })
check("my organizations lists both", (await s.getByTestId("my-org").count()) === 2)
await s.screenshot({ path: SHOTS + "orgs.png", fullPage: true })

const o = await open(PEOPLE.owner[0])
await o.goto(`${BASE}${O}/manage`)
await o.getByRole("heading", { name: "Test College" }).waitFor({ timeout: 30000 })
await o.getByRole("link", { name: /^Members/ }).click()
await o.getByTestId("member-row").first().waitFor({ timeout: 15000 })
check("members page lists people with roles and groups", await o.getByTestId("member-row").filter({ hasText: PEOPLE.s1[0] }).getByText("Admin").first().isVisible())
await o.screenshot({ path: SHOTS + "org-members.png", fullPage: true })
// Group pickers: a searchable tree in a popover. Searching shows full paths.
const pick = async (page, path) => {
  const picker = page.getByTestId("group-picker")
  await picker.waitFor({ timeout: 15000 })
  await picker.getByLabel("Search groups").fill(path.split(" › ").pop())
  await picker.getByRole("option", { name: path, exact: true }).click()
  await picker.waitFor({ state: "hidden", timeout: 15000 })
}
await o.getByTestId("member-row").filter({ hasText: PEOPLE.s2[0] }).getByRole("button", { name: "Groups" }).click()
const groupsDialog = o.getByRole("dialog", { name: /^Groups for / })
await groupsDialog.waitFor({ timeout: 15000 })
await groupsDialog.getByRole("checkbox", { name: `CSE for ${PEOPLE.s2[0]}` }).check()
check("a member's group editor ticks a branch's batches too", await groupsDialog.getByRole("checkbox", { name: `2026-A for ${PEOPLE.s2[0]}` }).isChecked())
await groupsDialog.getByLabel("Find a group").fill("Lab 3")
await groupsDialog.getByRole("checkbox", { name: `Lab 3 for ${PEOPLE.s2[0]}` }).waitFor({ timeout: 15000 })
check("the group editor searches, keeping the groups above a match", await groupsDialog.getByRole("checkbox", { name: `Sec B for ${PEOPLE.s2[0]}` }).isVisible() && !(await groupsDialog.getByRole("checkbox", { name: `ECE for ${PEOPLE.s2[0]}` }).isVisible()))
await o.waitForTimeout(400)
await o.screenshot({ path: SHOTS + "member-groups-dialog.png", fullPage: true })
await groupsDialog.getByRole("button", { name: "Cancel" }).click()
await groupsDialog.waitFor({ state: "hidden", timeout: 15000 })
// Giving a role for one group, picked from the tree.
await o.getByTestId("member-row").filter({ hasText: PEOPLE.s2[0] }).getByRole("button", { name: "Add role" }).click()
const roleDialog = o.getByRole("dialog", { name: /a role$/ })
await roleDialog.getByLabel("Role to give").selectOption({ label: "Teacher" })
await roleDialog.getByRole("button", { name: "Where it applies" }).click()
check("the picker shows the tree with level names", await o.getByTestId("group-picker").getByRole("option", { name: "3rd Year", exact: true }).isVisible() && /Year/.test(await o.getByTestId("group-picker").textContent()))
await o.getByTestId("group-picker").getByLabel("Search groups").fill("Lab")
await o.getByTestId("group-picker").getByRole("option", { name: "3rd Year › Sec B › Lab 3", exact: true }).waitFor({ timeout: 15000 })
await o.waitForTimeout(300)
await o.screenshot({ path: SHOTS + "group-picker.png", fullPage: true })
await o.getByTestId("group-picker").getByRole("option", { name: "3rd Year › Sec B › Lab 3", exact: true }).click()
check("and the choice shows its path", (await roleDialog.getByRole("button", { name: "Where it applies" }).textContent()).includes("3rd Year › Sec B › Lab 3"))
await roleDialog.getByRole("button", { name: "Give role" }).click()
const s2member = o.getByTestId("member-row").filter({ hasText: PEOPLE.s2[0] })
await s2member.getByText("3rd Year › Sec B › Lab 3").waitFor({ timeout: 15000 })
check("a role can be given for one group from the members page", true)
await s2member.getByRole("button", { name: `Remove Teacher from ${PEOPLE.s2[0]}` }).click()
await o.getByRole("alertdialog").getByRole("button", { name: "Take role" }).click()
await s2member.getByText("3rd Year › Sec B › Lab 3").waitFor({ state: "detached", timeout: 15000 })
check("and taken away after confirming", true)
await o.getByRole("link", { name: /^Groups/ }).click()
await o.getByRole("button", { name: "Open CSE" }).waitFor({ timeout: 15000 })
await o.getByLabel(/^New (branch|year)$/).fill("MECH")
await o.getByRole("button", { name: /^Add (branch|year)$/ }).click()
await o.getByRole("dialog", { name: "People in MECH" }).waitFor({ timeout: 10000 })
await o.keyboard.press("Escape")
await o.getByText("MECH").first().waitFor({ timeout: 10000 })
check("groups page adds a branch", true)
await o.screenshot({ path: SHOTS + "org-groups.png", fullPage: true })
await o.getByRole("link", { name: /^Roles/ }).click()
await o.getByRole("button", { name: "New role" }).click()
await o.getByRole("checkbox", { name: "All of Teaching" }).check()
check("an area's checkbox ticks all its permissions", (await o.getByRole("checkbox", { name: "Set assignments" }).isChecked()) && (await o.getByRole("checkbox", { name: "See grades" }).isChecked()))
await o.getByRole("checkbox", { name: "All of Teaching" }).uncheck()
check("and unticks them", !(await o.getByRole("checkbox", { name: "Set assignments" }).isChecked()))
await o.getByLabel("Role name").fill("Viewer UI")
await o.getByRole("checkbox", { name: "See members" }).check()
await o.getByRole("button", { name: "Create role" }).click()
await o.getByText("Viewer UI").first().waitFor({ timeout: 10000 })
check("roles page creates a role from checkboxes", (await api.owner(`${O}/roles`)).json.some((r) => r.name === "Viewer UI" && r.permissions.join() === "org.members.view"))
await o.screenshot({ path: SHOTS + "org-roles.png", fullPage: true })
await o.getByRole("link", { name: /^Invites/ }).click()
await o.getByLabel("Label").fill("UI link")
await o.getByRole("button", { name: "Create link" }).click()
await o.getByText("UI link").first().waitFor({ timeout: 10000 })
const link = await o.getByTestId("invite-link").first().textContent()
check("invites page makes a shareable link", /\/join\/[A-Za-z0-9_-]{16,}/.test(link), link)
await o.getByRole("link", { name: /^Activity/ }).click()
await o.getByText(/Created invite "UI link"/).waitFor({ timeout: 10000 })
check("activity shows the latest changes", true)

const x = await open(PEOPLE.outsider[0])
await x.goto(link.trim())
await x.getByRole("button", { name: /Join Test College/ }).waitFor({ timeout: 30000 })
await x.screenshot({ path: SHOTS + "org-join.png", fullPage: true })
await x.getByRole("button", { name: /Join Test College/ }).click()
await x.waitForURL(/\/orgs\/orgtest-college$/, { timeout: 15000 })
check("joining from an invite link lands on the organization", (await api.outsider(O)).json.membership?.status === "active")

const tch = await open(PEOPLE.teacher[0])
await tch.goto(`${BASE}${O}/manage/assignments/new`)
await tch.getByText("Who it's for").waitFor({ timeout: 30000 })
await tch.getByRole("checkbox", { name: "2026-A" }).waitFor({ timeout: 15000 }).catch(() => {})
check("a teacher's assignment form offers the college's groups", await tch.getByRole("checkbox", { name: "2026-A" }).isVisible())
await tch.screenshot({ path: SHOTS + "org-assignment-form.png", fullPage: true })
await o.goto(`${BASE}${O}/manage/import`)
await o.getByLabel("Or paste the CSV").fill("email,name,group\norg-ui1@example.com,UI One,ECE\nbroken,,\n")
await o.getByRole("button", { name: "Check" }).click()
await o.getByTestId("import-summary").waitFor({ timeout: 15000 })
check("the import screen previews each row", (await o.getByTestId("import-row").count()) === 2 && /1 new accounts/.test(await o.getByTestId("import-summary").textContent()))
await o.getByRole("button", { name: /Import 1 person/ }).click()
await o.getByText(/Done: 1 imported/).waitFor({ timeout: 15000 })
check("and imports the good ones", (await api.owner(`${O}/members?q=org-ui1`)).json.length === 1)
await o.screenshot({ path: SHOTS + "org-import.png", fullPage: true })
const member = await open(PEOPLE.s2[0])
await member.goto(`${BASE}${O}`)
await member.getByTestId("org-notice").first().waitFor({ timeout: 30000 })
check("the organization page shows members its notices and assignments", await member.getByTestId("org-assignment").first().isVisible())
await member.screenshot({ path: SHOTS + "org-member-view.png", fullPage: true })

await tch.goto(`${BASE}/teach`)
await tch.getByTestId("teach-org").first().waitFor({ timeout: 30000 })
check("Teach is in the teacher's menu", await tch.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Teach" }).isVisible())
await tch.screenshot({ path: SHOTS + "teach.png", fullPage: true })
await tch.goto(`${BASE}${O}/manage/teaching/${g3("2026-A")}`)
await tch.getByTestId("session-row").first().waitFor({ timeout: 30000 })
check("group page: syllabus, behind warning and classes", (await tch.getByTestId("topic").count()) === 4 && (await tch.getByTestId("behind").first().isVisible()))
await tch.screenshot({ path: SHOTS + "group-teaching.png", fullPage: true })
await tch.goto(`${BASE}${O}/manage/reports`)
await tch.getByTestId("report-student").first().waitFor({ timeout: 30000 })
check("reports page lists students", (await tch.getByTestId("report-student").count()) >= 2)
await tch.screenshot({ path: SHOTS + "org-reports.png", fullPage: true })

// An Excel member list, built here so the upload goes through the real file reader.
const { zipSync, strToU8 } = createRequire(ROOT + "apps/web/")("fflate")
const cell = (ref, text) => `<c r="${ref}" t="inlineStr"><is><t>${text}</t></is></c>`
const xlsx = zipSync({
  "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
  "_rels/.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
  "xl/workbook.xml": strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Members" sheetId="1" r:id="rId1"/></sheets></workbook>'),
  "xl/_rels/workbook.xml.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
  "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">${cell("A1", "email")}${cell("B1", "name")}${cell("C1", "group")}</row><row r="2">${cell("A2", "org-xl1@example.com")}${cell("B2", "Excel Person")}${cell("C2", "ECE")}</row><row r="3">${cell("A3", "org-xl2@example.com")}${cell("C3", "MECH")}</row></sheetData></worksheet>`),
})
await o.goto(`${BASE}${O}/manage/import`)
await o.getByLabel("CSV or Excel file").setInputFiles({ name: "members.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from(xlsx) })
await o.getByLabel("Or paste the CSV").waitFor({ timeout: 10000 })
await o.waitForFunction(() => document.querySelector("textarea")?.value.includes("org-xl1@example.com"), null, { timeout: 10000 })
await o.getByRole("button", { name: "Check" }).click()
await o.getByTestId("import-summary").waitFor({ timeout: 15000 })
check("an Excel file goes through the same preview", /2 new accounts/.test(await o.getByTestId("import-summary").textContent()), await o.getByTestId("import-summary").textContent())

await tch.goto(`${BASE}${O}/manage/assignments/${asg.json.id}/grades`)
await tch.getByTestId("grade-cell").first().waitFor({ timeout: 30000 })
await tch.getByTestId("grade-row").filter({ hasText: PEOPLE.s2[0] }).getByTestId("grade-cell").first().click()
await tch.getByTestId("student-code").locator("pre").first().waitFor({ timeout: 15000 })
check("clicking a mark shows the student's code", (await tch.getByTestId("student-code").locator("pre").first().textContent()).includes("principal"))
await tch.screenshot({ path: SHOTS + "gradebook-code.png", fullPage: true })

const s3page = await open(PEOPLE.s3[0])
await s3page.goto(`${BASE}${O}`)
await s3page.getByTestId("org-problem").first().waitFor({ timeout: 30000 })
check("members see the organization's problems on its page", await s3page.getByTestId("org-problem").filter({ hasText: "Members Only Problem" }).isVisible())
await s3page.getByTestId("org-problem").filter({ hasText: "Members Only Problem" }).click()
await s3page.locator(".monaco-editor .view-line").first().waitFor({ timeout: 60000 })
check("and solve members-only ones on the members' page", s3page.url().endsWith("/orgs/orgtest-college/practice/orgtest-private"))
await s3page.screenshot({ path: SHOTS + "org-practice.png", fullPage: true })

await o.goto(`${BASE}${O}/manage/groups`)
await o.getByLabel(/^New (branch|year)$/).fill("Lab Batch")
await o.getByRole("button", { name: /^Add (branch|year)$/ }).click()
await o.getByRole("dialog", { name: "People in Lab Batch" }).waitFor({ timeout: 15000 })
check("creating a group opens its people panel", true)
await o.getByLabel("Find members to add").fill("org-ya2")
await o.getByRole("checkbox", { name: "Add org-ya2@example.com" }).check()
await o.getByRole("button", { name: /Add 1 to Lab Batch/ }).click()
await o.getByTestId("group-person").first().waitFor({ timeout: 15000 })
check("and adds people to it", (await o.getByTestId("group-person").count()) === 1)
await o.waitForTimeout(400) // let the dialog finish opening
await o.screenshot({ path: SHOTS + "group-panel.png", fullPage: true })
await o.keyboard.press("Escape")
check("the tree starts folded", !(await o.getByRole("button", { name: "Open Sec A" }).isVisible()))
await o.getByRole("button", { name: "Expand 3rd Year" }).click()
await o.getByRole("button", { name: "Open Sec A" }).waitFor({ timeout: 15000 })
check("unfolding a year shows its sections, not their labs", !(await o.getByRole("button", { name: "Open Lab 1" }).isVisible()))
await o.getByRole("button", { name: "Collapse 3rd Year" }).click()
await o.getByRole("button", { name: "Open Sec A" }).waitFor({ state: "hidden", timeout: 15000 })
check("and folds again", true)
await o.getByRole("button", { name: "Open 3rd Year" }).click()
const y3panel = o.getByRole("dialog", { name: "People in 3rd Year" })
await y3panel.getByTestId("people-section").first().waitFor({ timeout: 15000 })
check("a year's panel counts everyone in its sections", /^5 people/.test(await y3panel.getByText(/people, in it or in groups/).textContent()))
check("and groups them by lab, folded", (await y3panel.getByTestId("people-section").count()) > 1 && (await y3panel.getByTestId("group-person").count()) === 0)
await y3panel.getByTestId("people-section").filter({ hasText: "Lab 1" }).click()
await y3panel.getByTestId("group-person").first().waitFor({ timeout: 15000 })
check("opening a lab shows its people", (await y3panel.getByTestId("group-person").count()) >= 1)
await y3panel.getByLabel("Search people in this group").fill("org-yb1")
await o.waitForTimeout(300)
check("searching shows only who matches", (await y3panel.getByTestId("group-person").count()) >= 1 && (await y3panel.getByTestId("group-person").filter({ hasNotText: "org-yb1" }).count()) === 0)
await o.waitForTimeout(400) // let the dialog finish opening
await o.screenshot({ path: SHOTS + "group-panel-sections.png", fullPage: true })
await o.keyboard.press("Escape")

await o.goto(`${BASE}${O}/manage/assignments/new`)
const box = (name) => o.getByRole("checkbox", { name: name, exact: true })
await box("3rd Year").check()
check("ticking a parent ticks everything inside it", (await box("Sec A").isChecked()) && (await box("Sec B").isChecked()))
await box("Sec A").uncheck()
check("unticking a child unticks its parent, shown as partly ticked", !(await box("3rd Year").isChecked()) && (await box("3rd Year").getAttribute("aria-checked")) === "mixed" && (await box("Sec B").isChecked()))
await o.getByTestId("audience-summary").filter({ hasText: "People in Sec B" }).waitFor({ timeout: 10000 })
await box("Sec A").check()
check("ticking the last child ticks the parent again", await box("3rd Year").isChecked())
await o.getByRole("button", { name: "+ And also in…" }).click()
await o.getByRole("checkbox", { name: "CAC (condition 2)" }).check()
await o.getByTestId("audience-summary").filter({ hasText: /also in CAC · 2 people/ }).waitFor({ timeout: 15000 })
check("the form says who an assignment will reach", /People in 3rd Year, also in CAC/.test(await o.getByTestId("audience-summary").textContent()), await o.getByTestId("audience-summary").textContent())
await o.screenshot({ path: SHOTS + "audience-builder.png", fullPage: true })

await o.goto(`${BASE}${O}/manage/groups`)
await o.getByTestId("not-placed").first().waitFor({ timeout: 15000 })
check("the groups page warns about people not placed", (await o.getByTestId("not-placed").first().textContent()).includes("1 not placed"))
await o.screenshot({ path: SHOTS + "groups-tree.png", fullPage: true })
await o.getByRole("button", { name: "Expand all" }).click()
await o.getByRole("button", { name: "Open Sec B" }).click()
const secBpanel = o.getByRole("dialog", { name: "People in Sec B" })
const notPlaced = secBpanel.getByTestId("people-section").filter({ hasText: "Not placed yet in Sec B" })
await notPlaced.waitFor({ timeout: 15000 })
await notPlaced.click()
await secBpanel.getByRole("button", { name: "Move org-yb1@example.com", exact: true }).click()
await pick(o, "3rd Year › Sec B › Lab 3")
await notPlaced.waitFor({ state: "detached", timeout: 15000 })
check("a person's Move places them", (await preview([[labX.id]])) === 3, JSON.stringify([await preview([[lab3.id]]), await preview([[lab4.id]]), await preview([[secB.id]])]))
// Between two labs of the same section.
await secBpanel.getByTestId("people-section").filter({ hasText: "Lab 3" }).click()
await secBpanel.getByRole("button", { name: "Move org-yb1@example.com", exact: true }).click()
await pick(o, "3rd Year › Sec B › Lab 4")
await secBpanel.getByTestId("people-section").filter({ hasText: "Lab 4" }).waitFor({ timeout: 15000 })
check("and moves them from one lab to another", (await preview([[lab3.id]])) === 2 && (await preview([[lab4.id]])) === 1, JSON.stringify([await preview([[lab3.id]]), await preview([[lab4.id]]), await preview([[secB.id]])]))
// Ticked people move together.
await secBpanel.getByTestId("people-section").filter({ hasText: "Lab 4" }).click()
await secBpanel.getByRole("checkbox", { name: "Tick org-yb1@example.com" }).check()
await secBpanel.getByTestId("bulk-bar").waitFor({ timeout: 15000 })
await secBpanel.getByRole("button", { name: "Move ticked people to" }).click()
await pick(o, "3rd Year › Sec B › Lab 3")
await secBpanel.getByTestId("bulk-bar").getByRole("button", { name: "Move", exact: true }).click()
await secBpanel.getByTestId("people-section").filter({ hasText: "Lab 4" }).waitFor({ state: "detached", timeout: 15000 })
check("ticked people move together", (await preview([[lab3.id]])) === 3 && (await preview([[lab4.id]])) === 0, JSON.stringify([await preview([[lab3.id]]), await preview([[lab4.id]]), await preview([[secB.id]])]))
await o.waitForTimeout(400)
await o.screenshot({ path: SHOTS + "placed.png", fullPage: true })
// Removing asks first, and Cancel keeps them.
await secBpanel.getByRole("button", { name: "Remove org-yb1@example.com" }).click()
const removeDialog = o.getByRole("alertdialog", { name: /^Remove .* from Lab 3\?$/ })
await removeDialog.waitFor({ timeout: 15000 })
check("removing a person asks first", /stay members of the organization/.test(await removeDialog.textContent()))
await o.waitForTimeout(400)
await o.screenshot({ path: SHOTS + "remove-confirm.png", fullPage: true })
await removeDialog.getByRole("button", { name: "Cancel" }).click()
await removeDialog.waitFor({ state: "hidden", timeout: 15000 })
check("and Cancel keeps them", (await preview([[lab3.id]])) === 3, JSON.stringify([await preview([[lab3.id]]), await preview([[lab4.id]]), await preview([[secB.id]])]))
await secBpanel.getByRole("button", { name: "Remove org-yb1@example.com" }).click()
await removeDialog.getByRole("button", { name: "Remove", exact: true }).click()
for (let i = 0; i < 30 && (await preview([[lab3.id]])) !== 2; i++) await o.waitForTimeout(300)
check("confirming removes them", (await preview([[lab3.id]])) === 2, JSON.stringify([await preview([[lab3.id]]), await preview([[lab4.id]]), await preview([[secB.id]])]))
await o.keyboard.press("Escape")

await o.goto(`${BASE}${O}/manage/groups`)
await o.getByRole("button", { name: "Expand all" }).click()
await o.getByRole("button", { name: "Open Lab Z" }).waitFor({ timeout: 15000 })
const labZRow = o.locator("div.grid").filter({ has: o.getByRole("button", { name: "Open Lab Z" }) }).last()
await labZRow.getByRole("button", { name: "Delete", exact: true }).click()
await o.getByRole("alertdialog", { name: "Delete Lab Z?" }).waitFor({ timeout: 15000 })
check("deleting a group with people asks first", /Lab Z has 1 person/.test(await o.getByRole("alertdialog", { name: "Delete Lab Z?" }).textContent()))
await o.waitForTimeout(400) // let the dialog finish opening
await o.screenshot({ path: SHOTS + "group-delete.png", fullPage: true })
await o.getByRole("button", { name: "Delete and take them out" }).click()
await o.getByRole("button", { name: "Open Lab Z" }).waitFor({ state: "detached", timeout: 15000 })
check("and deletes when told to", !(await api.owner(`${C}/groups`)).json.groups.some((g) => g.name === "Lab Z"))
const labYRow = o.locator("div.grid").filter({ has: o.getByRole("button", { name: "Open Lab Y" }) }).last()
await labYRow.getByRole("button", { name: "Delete", exact: true }).click()
const delY = o.getByRole("alertdialog", { name: "Delete Lab Y?" })
await delY.waitFor({ timeout: 15000 })
await delY.getByRole("button", { name: "Move them to" }).click()
await o.getByTestId("group-picker").getByLabel("Search groups").fill("Lab Y")
check("groups inside the one being deleted can't be picked", await o.getByTestId("group-picker").getByRole("option", { name: "3rd Year › Sec A › Lab Y", exact: true }).isDisabled())
await pick(o, "3rd Year › Sec A › Lab 1")
await delY.getByRole("button", { name: "Move and delete" }).click()
await o.getByRole("button", { name: "Open Lab Y" }).waitFor({ state: "detached", timeout: 15000 })
check("move and delete from the dialog keeps the people", (await api.owner(`${C}/groups/${lab1.id}/members`)).json.people.some((p) => p.email === "org-ya1@example.com"))

check("no console or hydration errors", errors.length === 0, [...new Set(errors)].slice(0, 5).join(" || "))
await browser.close()
cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
