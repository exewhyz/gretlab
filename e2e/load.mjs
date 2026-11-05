/**
 * Simulates a class: students who read a problem, press Run or Submit, wait for the result
 * the way the browser does, think, and repeat. Measures what students would feel.
 *
 *   node e2e/load.mjs --students=300 --seconds=60 --think=20 --base=http://localhost:3100
 *
 * --burst sends everyone at once, like the first minute of a contest.
 */
import { execFileSync } from "node:child_process"
import { createRequire } from "node:module"

const ROOT = new URL("../", import.meta.url).pathname
const require = createRequire(ROOT + "apps/web/")
const { encode } = require("next-auth/jwt")

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split("=")[1] : fallback
}
const BASE = arg("base", "http://localhost:3100")
const STUDENTS = Number(arg("students", 300))
const SECONDS = Number(arg("seconds", 60))
const THINK = Number(arg("think", 20)) * 1000
const SECRET = arg("secret", "e2e-only-secret")
const DB = arg("db", "gretlab_test")
const CONTEST = arg("contest", "")
const BURST = process.argv.includes("--burst")

const psql = (q) =>
  execFileSync("docker", ["compose", "-f", ROOT + "docker-compose.yml", "exec", "-T", "postgres", "psql", "-U", "gretlab", "-d", DB, "-Atc", q]).toString().trim()

psql(`insert into users(email,name) select 'load'||g||'@example.com','Load '||g from generate_series(1,${STUDENTS}) g on conflict do nothing`)
psql(`insert into settings(key,value) values ('submissions.per_minute','600') on conflict (key) do update set value='600'`)
const SOLUTION = "principal = float(input())\nrate = float(input())\ntime = float(input())\nsi = principal * rate * time / 100\nprint(f\"Simple Interest: {si:.2f}\")\nprint(f\"Total Amount: {principal + si:.2f}\")\n"

const stats = { post: [], ok: [], poll: [], page: [], board: [], polls: 0, codes: {}, verdicts: {}, timeouts: 0, netErrors: 0 }
const count = (table, key) => { table[key] = (table[key] ?? 0) + 1 }

async function timed(bucket, url, init) {
  const started = performance.now()
  try {
    const res = await fetch(BASE + url, init)
    const body = await res.json().catch(() => null)
    bucket.push(performance.now() - started)
    count(stats.codes, res.status)
    return { status: res.status, body }
  } catch {
    stats.netErrors += 1
    return { status: 0, body: null }
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const deadline = Date.now() + SECONDS * 1000
let inFlight = 0

async function student(n) {
  const cookie = `next-auth.session-token=${await encode({ token: { email: `load${n}@example.com`, sub: String(n) }, secret: SECRET })}`
  const headers = { cookie, "content-type": "application/json" }
  if (!BURST) await sleep(Math.random() * THINK)
  while (Date.now() < deadline) {
    await timed(stats.page, "/api/v1/me", { headers })
    if (CONTEST && Math.random() < 0.5) await timed(stats.board, `/api/v1/contests/${CONTEST}/leaderboard`, { headers })
    const submit = Math.random() < 0.25
    const body = { kind: submit ? "submit" : "run", language: "python", entry: "main.py", files: [{ path: "main.py", content: SOLUTION }], stdin: submit ? undefined : "1\n2\n3", problemSlug: "p1" }
    const started = performance.now()
    const created = await timed(stats.post, "/api/v1/submissions", { method: "POST", headers, body: JSON.stringify(body) })
    if (created.status === 200) {
      inFlight += 1
      let done = false
      let wait = 300
      const giveUp = Date.now() + 180_000
      while (!done && Date.now() < giveUp) {
        await sleep(wait)
        const polled = await timed(stats.poll, `/api/v1/submissions/${created.body.id}/status`, { headers })
        stats.polls += 1
        if (polled.body?.status === "done") {
          const full = await timed(stats.poll, `/api/v1/submissions/${created.body.id}`, { headers })
          done = true
          count(stats.verdicts, full.body?.verdict ?? "?")
          stats.ok.push(performance.now() - started)
        }
        wait = (polled.body?.nextPollMs ?? 1000) * (0.8 + Math.random() * 0.4)
      }
      if (!done) stats.timeouts += 1
      inFlight -= 1
    }
    await sleep(THINK * (0.5 + Math.random()))
  }
}

const pct = (values, p) => {
  if (!values.length) return "-"
  const sorted = [...values].sort((a, b) => a - b)
  return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))])
}
const row = (name, v) => console.log(`${name.padEnd(30)} n=${String(v.length).padEnd(7)} p50=${String(pct(v, 50)).padEnd(7)} p95=${String(pct(v, 95)).padEnd(7)} p99=${pct(v, 99)} ms`)

const started = Date.now()
const peak = { queue: 0 }
const sampler = setInterval(() => {
  try { peak.queue = Math.max(peak.queue, Number(psql("select count(*) from submissions where status='queued'"))) } catch {}
}, 3000)
await Promise.all(Array.from({ length: STUDENTS }, (_, i) => student(i + 1)))
clearInterval(sampler)
const elapsed = (Date.now() - started) / 1000

console.log(`\n${STUDENTS} students, ${SECONDS}s, think ${THINK / 1000}s${BURST ? ", burst" : ""}, finished in ${Math.round(elapsed)}s`)
row("POST /submissions", stats.post)
row("poll for result", stats.poll)
row("GET /me", stats.page)
if (CONTEST) row("leaderboard", stats.board)
row("press Run → see result", stats.ok)
console.log(`results: ${stats.ok.length} (${(stats.ok.length / elapsed).toFixed(1)}/s)  polls: ${stats.polls} (${(stats.polls / elapsed).toFixed(0)}/s)  peak queue: ${peak.queue}`)
console.log(`http: ${JSON.stringify(stats.codes)}  verdicts: ${JSON.stringify(stats.verdicts)}  timeouts: ${stats.timeouts}  network errors: ${stats.netErrors}`)
process.exit(0)
