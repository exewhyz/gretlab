/**
 * Background jobs (features/jobs): long work done in steps outside the request.
 *   - a gradebook export of 6,000+ students as a job (two steps of 5,000): its progress, and a file identical to the
 *     instant ?format=csv download
 *   - only its starter sees it, cancels it or downloads it; anyone else is told it doesn't exist
 *   - jobs move forward from the email cron alone (nobody waiting on them)
 *   - a job whose runner died is picked up again after its lease and finishes, whole
 *   - cancelling stops a job; a step that keeps failing ends as failed, with a reference
 *   - apps/worker, when it runs, takes jobs as they're queued
 *   node e2e/jobs.mjs [base-url]
 */
import { execFileSync, spawn } from "node:child_process"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const { encode } = createRequire(ROOT + "apps/web/")("next-auth/jwt")
const BASE = process.argv[2] ?? "http://localhost:3100"
const SECRET = process.env.NEXTAUTH_SECRET ?? "e2e-only-secret"
const DB = process.env.E2E_DB ?? "gretlab_test"
const CRON = process.env.CRON_SECRET ?? "e2e-cron-secret-0123456789"
const STUDENTS = 6_000
let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === "" ? "" : "  -- " + String(detail).slice(0, 1500)}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-v", "ON_ERROR_STOP=1", "-Atqc", q], { maxBuffer: 64 * 1024 * 1024 }).toString().trim()
const cleanup = () => {
  psql(`delete from jobs where created_by in (select id from users where email = 'admin@example.com' or email like 'jb-%@example.com')`)
  psql(`delete from assignments where slug = 'jb-export'`)
  psql(`delete from users where email like 'jb-%@example.com'`)
}
const client = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body, raw } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, {
      method: method ?? (body ? "POST" : "GET"),
      headers: { cookie, origin: BASE, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: res.status, text: raw ? await res.text() : null, json: raw ? null : await res.json().catch(() => null) }
  }
}
const cron = async () => (await (await fetch(`${BASE}/api/cron/outbox`, { method: "POST", headers: { authorization: `Bearer ${CRON}` } })).json().catch(() => null))?.jobs
const waitFor = async (fn, ms = 60_000) => {
  const until = Date.now() + ms
  while (Date.now() < until) {
    const v = await fn()
    if (v) return v
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}

cleanup()
psql(`insert into users(email,name,role) values ('admin@example.com','Admin','admin') on conflict (email) do nothing`)
psql(`insert into users (email, name, role, handle) select 'jb-' || g || '@example.com', 'Jb Student ' || g, 'student', 'jb-' || g from generate_series(1, ${STUDENTS}) g`)
psql(`insert into users (email, name, role) values ('jb-other@example.com', 'Jb Other', 'admin')`)
const admin = await client("admin@example.com")
const other = await client("jb-other@example.com")
const student = await client("jb-1@example.com")
const problem = psql(`select id from problems where published and listed order by slug limit 1`)
const hours = (h) => new Date(Date.now() + h * 3_600_000).toISOString()
const made = await admin("/admin/assignments", { body: { title: "Jb export", slug: "jb-export", description: "", opensAt: hours(-1), dueAt: hours(24), allowLate: false, latePenaltyPercent: 0, published: true, problems: [{ problemId: problem, points: 10 }] } })
const assignment = made.json?.id
check("the set-up worked", made.status === 200 && Boolean(assignment), JSON.stringify(made.json).slice(0, 200))
const direct = (await admin(`/admin/assignments/${assignment}/gradebook?format=csv`, { raw: true })).text
const students = Number(psql(`select count(*) from users where role = 'student' and not disabled`))

// ---------- an export as a job
check("a student can't start a platform export", (await student(`/admin/assignments/${assignment}/gradebook/export`, { method: "POST" })).status === 403)
const started = await admin(`/admin/assignments/${assignment}/gradebook/export`, { method: "POST" })
const jobId = started.json?.job
check("starting an export answers at once with a job", started.status === 200 && /^[0-9a-f-]{36}$/.test(jobId ?? ""), JSON.stringify(started.json))
const seen = []
const finished = await waitFor(async () => {
  const j = (await admin(`/jobs/${jobId}`)).json
  if (j) seen.push(`${j.status}:${j.progress}/${j.total}`)
  return j?.status === "done" ? j : null
})
check(`the job works through ${students} students in steps, then is done`, finished?.progress === students && finished.total === students && finished.file?.name === "jb-export-grades.csv" && /students exported/.test(finished.result?.summary ?? ""), JSON.stringify({ finished, seen: seen.slice(-6) }))
const file = await admin(`/jobs/${jobId}/file`, { raw: true })
check("its file is exactly the instant download's CSV", file.status === 200 && file.text === direct && direct.split("\r\n").length === students + 2, JSON.stringify({ status: file.status, got: file.text?.length, want: direct?.length }))

// ---------- only its starter
check("someone else is told it doesn't exist (view, file, cancel)", (await other(`/jobs/${jobId}`)).status === 404 && (await other(`/jobs/${jobId}/file`, { raw: true })).status === 404 && (await other(`/jobs/${jobId}/cancel`, { method: "POST" })).status === 404)
check("a malformed id is just not found", (await admin(`/jobs/not-a-job`)).status === 404)

// ---------- from the cron alone, and a job whose runner died
const adminId = psql(`select id from users where email = 'admin@example.com'`)
const input = JSON.stringify({ assignmentId: assignment, scope: "all" })
const queued = psql(`insert into jobs (kind, created_by, input) values ('gradebook.csv', '${adminId}', '${input}') returning id`)
const dead = psql(`insert into jobs (kind, created_by, input, status, locked_by, locked_until, attempts) values ('gradebook.csv', '${adminId}', '${input}', 'running', 'web-dead', now() - interval '1 minute', 1) returning id`)
const ran = await cron()
check("the email cron moves jobs forward with nobody waiting", ran?.steps >= 2, JSON.stringify(ran))
const doneBy = async (id) => waitFor(async () => (psql(`select status from jobs where id = '${id}'`) === "done" ? true : (await cron(), null)), 90_000)
check("a queued job finishes from the cron alone", Boolean(await doneBy(queued)) && (await admin(`/jobs/${queued}/file`, { raw: true })).text === direct)
check("a job whose runner died is picked up after its lease and finishes whole", Boolean(await doneBy(dead)) && (await admin(`/jobs/${dead}/file`, { raw: true })).text === direct)

// ---------- cancelling, and failing
const later = psql(`insert into jobs (kind, created_by, input, next_attempt_at) values ('gradebook.csv', '${adminId}', '${input}', now() + interval '1 hour') returning id`)
const cancelled = await admin(`/jobs/${later}/cancel`, { method: "POST" })
await cron()
check("cancelling stops a job, and nothing runs it after", cancelled.json?.status === "cancelled" && psql(`select status || ':' || progress from jobs where id = '${later}'`) === "cancelled:0")
check("…and a cancelled job has no file", (await admin(`/jobs/${later}/file`, { raw: true })).status === 404)
const broken = psql(`insert into jobs (kind, created_by, input) values ('gradebook.csv', '${adminId}', '{"assignmentId":"00000000-0000-0000-0000-000000000000","scope":"all"}') returning id`)
await cron()
const retrying = (await admin(`/jobs/${broken}`)).json
check("a step that fails is tried again later, with a reference to quote", retrying?.status === "queued" && /ref [0-9a-f]{8}/.test(retrying.error ?? ""), JSON.stringify(retrying))
psql(`update jobs set attempts = 4, next_attempt_at = now() where id = '${broken}'`)
await cron()
const gaveUp = (await admin(`/jobs/${broken}`)).json
check("…and after the fifth failure it has failed", gaveUp?.status === "failed" && gaveUp.finishedAt, JSON.stringify(gaveUp))

// ---------- apps/worker takes jobs as they're queued
const worker = spawn(ROOT + "apps/worker/node_modules/.bin/tsx", ["src/main.ts"], { cwd: ROOT + "apps/worker", env: { ...process.env, SITE_URL: BASE, CRON_SECRET: CRON, DATABASE_URL: process.env.DATABASE_URL ?? `postgres://gretlab:gretlab_dev_only@127.0.0.1:5433/${DB}` }, stdio: ["ignore", "pipe", "pipe"] })
let workerLog = ""
worker.stdout.on("data", (d) => (workerLog += d))
worker.stderr.on("data", (d) => (workerLog += d))
await waitFor(async () => workerLog.includes("listening"), 30_000)
const byWorker = psql(`insert into jobs (kind, created_by, input) values ('gradebook.csv', '${adminId}', '${input}') returning id; select pg_notify('gretlab_jobs', '')`).split("\n")[0]
const workerDone = await waitFor(async () => psql(`select status from jobs where id = '${byWorker}'`) === "done", 60_000)
worker.kill("SIGTERM")
check("apps/worker takes a job as soon as it's queued", Boolean(workerDone) && (await admin(`/jobs/${byWorker}/file`, { raw: true })).text === direct, workerLog.slice(-500))

cleanup()
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
