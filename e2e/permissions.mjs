/**
 * Fine-grained roles: a custom role with a child action (grade, create, publish, delete,
 * change groups, remove, assign roles) does exactly that and no more, while a role with the
 * coarse parent still does everything. Proves the hierarchy and that holding a parent lets
 * you hand out its children.
 *   node e2e/permissions.mjs [base-url]
 */
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SECRET = process.env.NEXTAUTH_SECRET ?? "e2e-only-secret"
const DB = process.env.E2E_DB ?? "gretlab_test"
let failures = 0
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 200)}`); if (!ok) failures++ }
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atqc", q]).toString().trim()
const days = (n) => new Date(Date.now() + n * 86_400_000).toISOString()
const allowed = (res) => res.status !== 403 && res.status !== 401
const denied = (res) => res.status === 403

const cleanup = () => {
  psql(`delete from assignments where title like 'prm %'`)
  psql(`delete from organizations where slug = 'permtest'`)
  psql(`delete from users where email like 'prm-%'`)
}
cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
for (const h of ["prm-o", "prm-grader", "prm-drafter", "prm-full", "prm-mgroups", "prm-mremove", "prm-assign", "prm-s1", "prm-s2", "prm-s3"]) psql(`insert into users(email,name,role,handle) values ('${h}@example.com','${h}','student','${h}')`)
const uid = (h) => psql(`select id from users where email='${h}@example.com'`)
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Perm College", slug: "permtest", type: "college", ownerEmail: "prm-o@example.com" } })
const O = "/orgs/permtest"
const orgId = psql(`select id from organizations where slug='permtest'`)
const owner = await client("prm-o@example.com")
const lab = (await owner(`${O}/groups`, { body: { name: "prm Lab" } })).json
for (const h of ["prm-grader", "prm-drafter", "prm-full", "prm-mgroups", "prm-mremove", "prm-assign", "prm-s1", "prm-s2", "prm-s3"]) psql(`insert into org_members(org_id,user_id,status,joined_via) values ('${orgId}','${uid(h)}','active','created')`)
await owner(`${O}/groups/${lab.id}/members`, { body: { userIds: ["prm-grader", "prm-drafter", "prm-full", "prm-s1", "prm-s2"].map(uid) } })

// --- custom fine-grained roles, each scoped to the lab
const mkRole = async (name, permissions, groupId = lab.id, who = uid("prm-full")) => {
  const r = (await owner(`${O}/roles`, { body: { name, permissions } })).json
  return r
}
const give = (h, roleId, groupId = lab.id) => owner(`${O}/members/${uid(h)}/roles`, { body: { roleId, groupId } })
const teacherRoleId = (await owner(`${O}/roles`)).json.find((r) => r.systemKey === "teacher").id

const grader = await mkRole("Grader", ["gradebook.view", "assignments.grade"])
const drafter = await mkRole("Drafter", ["gradebook.view", "assignments.create", "assignments.edit"])
await give("prm-grader", grader.id)
await give("prm-drafter", drafter.id)
await give("prm-full", teacherRoleId)              // parent, scoped to the lab
await give("prm-full", teacherRoleId, null)       // and org-wide, to hand out children org-wide
const [cGrader, cDrafter, cFull] = await Promise.all(["prm-grader", "prm-drafter", "prm-full"].map((h) => client(`${h}@example.com`)))

const problem = psql(`select id from problems where org_id is null and published and listed and not members_only and sharing='everyone' order by slug limit 1`)
const body = (title, published) => ({ title, slug: title.replace(/ /g, "-"), description: "", opensAt: days(-1), dueAt: days(3), allowLate: false, latePenaltyPercent: 0, published, holdFeedback: false, exam: null, audience: [[lab.id]], problems: [{ problemId: problem, points: 100, rubric: [{ id: "r1", label: "Style", points: 10 }], outcomes: [] }], questions: [] })

// ---------- create vs grade vs publish vs delete
check("Drafter can create a draft assignment", allowed(await cDrafter(`${O}/assignments`, { body: body("prm draft", false) })))
const draftId = psql(`select id from assignments where title='prm draft'`)
check("Drafter can edit it", allowed(await cDrafter(`${O}/assignments/${draftId}`, { method: "PUT", body: body("prm draft", false) })))
check("Drafter CANNOT publish it", denied(await cDrafter(`${O}/assignments/${draftId}`, { method: "PUT", body: body("prm draft", true) })))
check("Drafter CANNOT delete it", denied(await cDrafter(`${O}/assignments/${draftId}`, { method: "DELETE" })))

check("Grader CANNOT create an assignment", denied(await cGrader(`${O}/assignments`, { body: body("prm nope", false) })))
check("Grader CANNOT publish", denied(await cGrader(`${O}/assignments/${draftId}`, { method: "PUT", body: body("prm draft", true) })))
check("Grader CAN grade (reach the grading endpoint, not 403)", allowed(await cGrader(`${O}/assignments/${draftId}/marks`, { method: "PUT", body: { student: "prm-s1@example.com", problemId: problem, marks: { r1: 8 } } })))
check("Drafter CANNOT grade", denied(await cDrafter(`${O}/assignments/${draftId}/marks`, { method: "PUT", body: { student: "prm-s1@example.com", problemId: problem, marks: { r1: 8 } } })))

// ---------- the coarse parent still does everything (backward compatible)
check("Teacher (parent) can create", allowed(await cFull(`${O}/assignments`, { body: body("prm full", false) })))
const fullId = psql(`select id from assignments where title='prm full'`)
check("Teacher (parent) can publish", allowed(await cFull(`${O}/assignments/${fullId}`, { method: "PUT", body: body("prm full", true) })))
check("Teacher (parent) can grade", allowed(await cFull(`${O}/assignments/${fullId}/marks`, { method: "PUT", body: { student: "prm-s1@example.com", problemId: problem, marks: { r1: 9 } } })))
check("Teacher (parent) can delete", allowed(await cFull(`${O}/assignments/${fullId}`, { method: "DELETE" })))

// ---------- handing out children: parent-holder may, child-holder may not escalate
const roleManager = await mkRole("Role maker", ["org.roles.manage"])
await give("prm-full", roleManager.id, null)
check("someone with the parent can create a role granting a child", (await cFull(`${O}/roles`, { body: { name: "TA", permissions: ["assignments.grade"] } })).status === 200)
check("a child-only holder can't create a role granting a sibling it lacks", denied(await cGrader(`${O}/roles`, { body: { name: "Sneaky", permissions: ["assignments.publish"] } })))

// ---------- members: groups vs remove vs assign-roles are separate
const mGroups = await mkRole("Mover", ["org.members.view", "org.members.groups"])
const mRemove = await mkRole("Remover", ["org.members.view", "org.members.remove"])
const assigner = await mkRole("Assigner", ["org.members.view", "org.members.assign_roles"])
await give("prm-mgroups", mGroups.id); await give("prm-mremove", mRemove.id, null); await give("prm-assign", assigner.id)
await owner(`${O}/groups/${lab.id}/members`, { body: { userIds: [uid("prm-mgroups"), uid("prm-mremove"), uid("prm-assign")] } })
const [cMg, cMr, cAs] = await Promise.all(["prm-mgroups", "prm-mremove", "prm-assign"].map((h) => client(`${h}@example.com`)))
check("Mover can change a member's groups", allowed(await cMg(`${O}/members/${uid("prm-s3")}`, { method: "PATCH", body: { groupIds: [lab.id] } })))
check("Mover CANNOT remove a member", denied(await cMg(`${O}/members/${uid("prm-s2")}`, { method: "DELETE" })))
psql(`delete from group_members where group_id='${lab.id}' and user_id='${uid("prm-s3")}'`)
check("Remover CANNOT change groups (a separate, group-scoped action)", denied(await cMr(`${O}/members/${uid("prm-s3")}`, { method: "PATCH", body: { groupIds: [lab.id] } })))
check("Remover CAN remove a member", allowed(await cMr(`${O}/members/${uid("prm-s2")}`, { method: "DELETE" })))
const memberRoleId = (await owner(`${O}/roles`)).json.find((r) => r.systemKey === "member").id
check("Assigner can give someone a role they aren't escalating", allowed(await cAs(`${O}/members/${uid("prm-s1")}/roles`, { body: { roleId: memberRoleId, groupId: lab.id } })))
check("Assigner CANNOT hand out a role with permissions they lack", denied(await cAs(`${O}/members/${uid("prm-s1")}/roles`, { body: { roleId: grader.id, groupId: lab.id } })))
check("Assigner CANNOT edit the roles catalog", denied(await cAs(`${O}/roles`, { body: { name: "Nope", permissions: [] } })))

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
