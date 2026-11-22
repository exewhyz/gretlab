/**
 * One organization at a size real ones reach (a university of tens of thousands): what works
 * for a class must work for all of them. The people are written straight into the database
 * (the API adds them one at a time), then each check goes through the API as a person would.
 *   - a notice to a grade of 20,000 students reaches every one of them, in the bell and by email
 *   - with parent accounts, 5,000 parents each get a copy naming their own child
 *   node e2e/large-org.mjs [base-url]
 */
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SECRET = process.env.NEXTAUTH_SECRET ?? "e2e-only-secret"
const DB = process.env.E2E_DB ?? "gretlab_test"
const STUDENTS = Number(process.env.LARGE_ORG_STUDENTS ?? 20_000)
const SECTIONS = 4
const PARENTS = Math.min(5_000, STUDENTS)
let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 2000)}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-v", "ON_ERROR_STOP=1", "-Atqc", q], { maxBuffer: 64 * 1024 * 1024 }).toString().trim()
const cleanup = () => {
  psql(`delete from email_outbox where to_address like 'lo-%@example.com'`)
  psql(`delete from organizations where slug = 'lo-uni'`)
  psql(`delete from users where email like 'lo-%@example.com'`)
}
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body === undefined ? "GET" : "POST"), headers: { cookie, "content-type": "application/json", origin: BASE }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, json: await res.json().catch(() => null) }
  }
}

cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
psql(`insert into users(email,name,role,handle) values ('lo-o@example.com','Lo Owner','student','lo-o')`)

// ---------- a university: one grade, its sections, and STUDENTS students spread across them
const admin = await client("admin@example.com")
await admin("/admin/organizations", { body: { name: "Lo University", slug: "lo-uni", type: "college", ownerEmail: "lo-o@example.com" } })
const O = "/orgs/lo-uni"
const orgId = psql(`select id from organizations where slug = 'lo-uni'`)
const owner = await client("lo-o@example.com")
const year = (await owner(`${O}/groups`, { body: { name: "First year" } })).json
const sections = []
for (let i = 1; i <= SECTIONS; i++) sections.push((await owner(`${O}/groups`, { body: { name: `Section ${i}`, parentId: year.id } })).json)
let started = Date.now()
psql(`
  insert into users (email, name, role, handle)
    select 'lo-s-' || g || '@example.com', 'Lo Student ' || g, 'student', 'lo-s-' || g
    from generate_series(1, ${STUDENTS}) g;
  insert into org_members (org_id, user_id, status, joined_via)
    select '${orgId}', id, 'active', 'created' from users where email like 'lo-s-%@example.com';
  insert into group_members (group_id, user_id)
    select (array[${sections.map((s) => `'${s.id}'::uuid`).join(",")}])[1 + (substring(email from 'lo-s-([0-9]+)@')::int % ${SECTIONS})], id
    from users where email like 'lo-s-%@example.com';
`)
const placed = Number(psql(`select count(*) from group_members gm join org_groups g on g.id = gm.group_id where g.org_id = '${orgId}'`))
// Parents for the first PARENTS students, with the module on.
await owner(O, { method: "PATCH", body: { modules: { parents: true } } })
psql(`
  insert into users (email, name, role, handle)
    select 'lo-p-' || g || '@example.com', 'Lo Parent ' || g, 'student', 'lo-p-' || g
    from generate_series(1, ${PARENTS}) g;
  insert into guardians (org_id, parent_id, student_id, relation)
    select '${orgId}', p.id, s.id, 'mother'
    from generate_series(1, ${PARENTS}) g
    join users p on p.email = 'lo-p-' || g || '@example.com'
    join users s on s.email = 'lo-s-' || g || '@example.com';
`)
check(`the set-up worked: ${STUDENTS} students in ${SECTIONS} sections (${Date.now() - started} ms)`, !!year?.id && sections.every((s) => s?.id) && placed === STUDENTS, JSON.stringify({ year, placed }))

// ---------- a notice to the whole year reaches everyone
started = Date.now()
const notice = await owner(`${O}/classes/${year.id}/stream`, { body: { text: "Exams start on Monday." } })
const took = Date.now() - started
check(`posting a notice to ${STUDENTS} students answers (${took} ms)`, notice.status === 200, JSON.stringify(notice.json))
const bells = Number(psql(`select count(*) from notifications n join users u on u.id = n.user_id where u.email like 'lo-s-%@example.com' and n.kind = 'notice'`))
check(`every student has it in their bell (${bells} of ${STUDENTS})`, bells === STUDENTS)
const emails = Number(psql(`select count(*) from email_outbox where to_address like 'lo-s-%@example.com'`))
check(`an email is queued for every student (${emails} of ${STUDENTS})`, emails === STUDENTS)
const copies = Number(psql(`select count(*) from notifications n join users u on u.id = n.user_id where u.email like 'lo-p-%@example.com' and n.kind = 'child_update'`))
check(`every parent gets a copy (${copies} of ${PARENTS})`, copies === PARENTS)
const named = psql(`select n.title || '|' || n.href from notifications n join users u on u.id = n.user_id where u.email = 'lo-p-42@example.com' and n.kind = 'child_update'`)
const child42 = psql(`select id from users where email = 'lo-s-42@example.com'`)
check("…naming their own child and linking to them", named.startsWith("Lo Student 42: New notice in First year|") && named.endsWith(`/children/${child42}`), named)
const parentEmails = Number(psql(`select count(*) from email_outbox where to_address like 'lo-p-%@example.com'`))
check(`…and by email (${parentEmails} of ${PARENTS})`, parentEmails === PARENTS)
const student = await client("lo-s-7@example.com")
const mine = (await student("/me/notifications")).json
check("a student sees the notice in their bell", JSON.stringify(mine ?? "").includes("New notice in First year"), JSON.stringify(mine).slice(0, 300))

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
