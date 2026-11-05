/**
 * Breaks the running system on purpose and checks that students are unaffected.
 * Needs the stack from e2e/stack.sh with two runners: e2e/stack.sh up 2
 */
import { execFileSync, spawn } from "node:child_process"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const require = createRequire(ROOT + "apps/web/")
const { encode } = require("next-auth/jwt")
const BASE = "http://localhost:8080"
const SECRET = "e2e-only-secret"
let failures = 0
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail !== "" ? "  -- " + String(detail).slice(0, 220) : ""}`)
  if (!ok) failures++
}
const psql = (q) => execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", "gretlab_test", "-Atc", q]).toString().trim()
const docker = (...args) => execFileSync("docker", args, { stdio: ["ignore", "pipe", "pipe"] }).toString().trim()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const user = (email, role = "student") => psql(`insert into users(email,name,role) values ('${email}','${email.split("@")[0]}','${role}') on conflict (email) do update set role='${role}'`)
const api = async (email) => {
  const cookie = `next-auth.session-token=${await encode({ token: { email }, secret: SECRET })}`
  return async (path, { method, body } = {}) => {
    const res = await fetch(BASE + "/api/v1" + path, { method: method ?? (body ? "POST" : "GET"), headers: { cookie, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })
    return { status: res.status, headers: res.headers, json: await res.json().catch(() => null) }
  }
}
const run = (code) => ({ kind: "run", language: "python", entry: "main.py", stdin: "", files: [{ path: "main.py", content: code }] })
const metric = async (name) => {
  const text = await (await fetch(BASE + "/api/metrics", { headers: { authorization: "Bearer e2e-metrics" } })).text()
  return Number(text.match(new RegExp(`^${name} (.+)$`, "m"))?.[1])
}
user("admin@example.com", "admin")
const admin = await api("admin@example.com")
const setSettings = async (changes) => { await admin("/admin/settings", { method: "PATCH", body: changes }); await sleep(5500) }
const startRunner = (rig) => docker("exec", rig, "docker", "start", "runner")

// ---- ops endpoints
check("health endpoint", (await fetch(BASE + "/api/health")).status === 200)
check("metrics refuses without a token", (await fetch(BASE + "/api/metrics")).status === 401)
check("metrics reports runners", (await metric("gretlab_runners_online")) >= 1, await metric("gretlab_runners_online"))

// ---- limits can't be raced
user("race@example.com")
await setSettings({ "submissions.max_pending": 3, "submissions.per_minute": 600 })
const racer = await api("race@example.com")
const raced = await Promise.all(Array.from({ length: 30 }, () => racer("/submissions", { body: run("import time; time.sleep(2)") })))
const accepted = raced.filter((r) => r.status === 200).length
check("30 parallel requests can't beat a limit of 3", accepted === 3, `accepted ${accepted}`)
await sleep(5000)

// ---- kill -9 a runner mid-job: every job still finishes
await setSettings({ "submissions.max_pending": 50 })
try { docker("exec", "gretlab-rig-2", "docker", "rm", "-f", "runner") } catch {}
docker("exec", "gretlab-rig-2", "docker", "create", "--name", "runner", "--hostname", "runner-2", "--network", "host", "-v", "/var/run/docker.sock:/var/run/docker.sock", "-e", "DATABASE_URL=postgres://gretlab:gretlab_dev_only@postgres:5432/gretlab_test", "-e", "SANDBOX_RUNTIME=runsc", "-e", "RUNNER_CONCURRENCY=8", "-e", "DATABASE_POOL=4", "gretlab/runner:local")
startRunner("gretlab-rig-2")
await sleep(4000)
user("crash@example.com")
const crash = await api("crash@example.com")
const crashIds = []
for (let i = 0; i < 16; i++) crashIds.push((await crash("/submissions", { body: run(`import time\ntime.sleep(3)\nprint(${i})`) })).json.id)
await sleep(1500)
const onRig1 = psql(`select count(*) from submissions where status='running' and locked_by like 'runner-1%'`)
docker("exec", "gretlab-rig-1", "docker", "kill", "-s", "KILL", "runner")
console.log(`      killed runner-1 holding ${onRig1} jobs`)
const crashStart = Date.now()
let results
while (Date.now() - crashStart < 150_000) {
  results = await Promise.all(crashIds.map((id) => crash(`/submissions/${id}`)))
  if (results.every((r) => r.json?.status === "done")) break
  await sleep(2000)
}
const elapsed = Math.round((Date.now() - crashStart) / 1000)
check("killed runner had jobs in hand", Number(onRig1) > 0, onRig1)
check("every job still finishes correctly", results.every((r, i) => r.json?.verdict === "OK" && r.json.results[0].stdout.trim() === String(i)), `${results.filter((r) => r.json?.verdict === "OK").length}/16 in ${elapsed}s`)
check("recovered within lease + sweep", elapsed < 120, `${elapsed}s`)
check("no job ran to completion twice as a duplicate", Number(psql(`select count(*) from (select id from submissions where user_id=(select id from users where email='crash@example.com') and status='done') t`)) === 16)
check("dead runner drops off the dashboard", await (async () => { await sleep(60_000 - Math.min(elapsed * 1000, 60_000) + 2000); return (await metric("gretlab_runners_online")) === 1 })())
docker("exec", "gretlab-rig-1", "docker", "start", "runner")
await sleep(4000)

// ---- deploying a new runner: SIGTERM finishes jobs, doesn't drop them
user("deploy@example.com")
const dep = await api("deploy@example.com")
const depIds = []
for (let i = 0; i < 8; i++) depIds.push((await dep("/submissions", { body: run("import time\ntime.sleep(4)\nprint('ok')") })).json.id)
await sleep(1000)
const stopping = spawn("docker", ["exec", "gretlab-rig-1", "docker", "stop", "-t", "60", "runner"])
await new Promise((r) => stopping.on("close", r))
const afterStop = await Promise.all(depIds.map((id) => dep(`/submissions/${id}`)))
const held = psql(`select count(*) from submissions where user_id=(select id from users where email='deploy@example.com') and attempts>1`)
check("graceful stop: nothing retried", held === "0", `${held} retried`)
await sleep(9000)
const depDone = await Promise.all(depIds.map((id) => dep(`/submissions/${id}`)))
check("graceful stop: all jobs finish", depDone.every((r) => r.json?.verdict === "OK"), `${depDone.filter((r) => r.json?.verdict === "OK").length}/8; ${afterStop.filter((r) => r.json?.status === "done").length} done when stop returned`)
docker("exec", "gretlab-rig-1", "docker", "start", "runner")
await sleep(4000)

// ---- losing a web replica under traffic
user("web@example.com")
const web = await api("web@example.com")
let total = 0, bad = 0, running = true
const traffic = Array.from({ length: 20 }, async () => {
  while (running) {
    const r = await fetch(BASE + "/api/v1/me").catch(() => ({ status: 0 }))
    total += 1
    if (r.status !== 200) bad += 1
    await sleep(100)
  }
})
await sleep(3000)
docker("kill", "gretlab-web-1")
await sleep(6000)
docker("start", "gretlab-web-1")
await sleep(5000)
running = false
await Promise.all(traffic)
check("web replica killed under traffic: under 1% of requests fail", bad / total < 0.01, `${bad} of ${total} failed`)
check("still working after", (await web("/me")).status === 200)

// ---- overload: refuse early and honestly; graded work outlives casual runs
docker("exec", "gretlab-rig-1", "docker", "stop", "-t", "30", "runner")
docker("exec", "gretlab-rig-2", "docker", "stop", "-t", "30", "runner")
await setSettings({ "queue.max_depth": 20, "submissions.max_pending": 50 })
const students = await Promise.all(Array.from({ length: 30 }, async (_, i) => { user(`flood${i}@example.com`); return api(`flood${i}@example.com`) }))
const flood = []
for (const s of students) flood.push(await s("/submissions", { body: run("print(1)") }))
await sleep(1200)
const late = await students[0]("/submissions", { body: run("print(1)") })
check("queue past its limit: Run refused with 503", late.status === 503 && late.json.error.code === "busy", late.status)
check("refusal says when to retry", late.headers.get("retry-after") === "15", late.headers.get("retry-after"))
const graded = await students[1]("/submissions", { body: { ...run("print(1)"), kind: "submit", problemSlug: "p1" } })
check("graded Submit is still accepted", graded.status === 200, graded.status)
startRunner("gretlab-rig-1"); startRunner("gretlab-rig-2")
await setSettings({ "queue.max_depth": 1000 })
let drained = false
for (let i = 0; i < 60 && !drained; i++) { drained = (await metric("gretlab_queue_waiting")) === 0; if (!drained) await sleep(1000) }
check("queue drains once runners return", drained)
check("service recovers: Run accepted again", (await students[2]("/submissions", { body: run("print(1)") })).status === 200)

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED")
process.exit(failures ? 1 : 0)
