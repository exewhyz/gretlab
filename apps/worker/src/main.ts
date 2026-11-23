/*
 * The background-jobs worker: keeps jobs moving the moment they're queued, for a server that
 * stays on (later, one in Mumbai beside the database). It does no work itself: it listens for
 * new jobs in the database (NOTIFY gretlab_jobs) and asks the website to run them
 * (POST /api/cron/jobs, with CRON_SECRET), again while any are left. Without it, jobs still move
 * from the request that queued them, the email cron and the uptime check.
 *
 *   SITE_URL=https://gretlab.grettech.com CRON_SECRET=… DATABASE_URL=… pnpm --filter worker start
 *
 * DATABASE_URL is only for listening: the session pooler (Supabase, port 5432) or a direct
 * address, as for the judge; transaction pooling can't keep a LISTEN open.
 */
import postgres from "postgres"

const SITE = (process.env.SITE_URL ?? "").replace(/\/+$/, "")
const SECRET = (process.env.CRON_SECRET ?? "").trim()
const DATABASE_URL = process.env.DATABASE_URL ?? ""
/** Asks anyway this often, in case a wake-up was missed. */
const IDLE_MS = Number(process.env.WORKER_IDLE_MS ?? 60_000)

if (!SITE || SECRET.length < 16 || !DATABASE_URL) {
  console.error("[worker] needs SITE_URL, CRON_SECRET (16+ characters) and DATABASE_URL")
  process.exit(1)
}

let busy = false
let again = false

/** Runs jobs on the site until none are waiting. */
async function drain() {
  if (busy) {
    again = true
    return
  }
  busy = true
  try {
    do {
      again = false
      const res = await fetch(`${SITE}/api/cron/jobs`, {
        method: "POST",
        headers: { authorization: `Bearer ${SECRET}` },
        signal: AbortSignal.timeout(90_000),
      })
      const body = (await res.json().catch(() => null)) as {
        steps?: number
        waiting?: number
      } | null
      if (!res.ok) {
        console.error(`[worker] the site answered ${res.status}`)
        break
      }
      if (body?.steps) console.log(`[worker] ran ${body.steps} steps; ${body.waiting} waiting`)
      if ((body?.waiting ?? 0) > 0 && (body?.steps ?? 0) > 0) again = true
    } while (again)
  } catch (error) {
    console.error("[worker] couldn't reach the site:", (error as Error).message)
  } finally {
    busy = false
  }
}

const listener = postgres(DATABASE_URL, { max: 1 })
await listener.listen("gretlab_jobs", () => void drain(), () => void drain())
console.log(`[worker] listening for jobs; running them on ${SITE}`)
const idle = setInterval(() => void drain(), IDLE_MS)

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    clearInterval(idle)
    await listener.end({ timeout: 2 })
    process.exit(0)
  })
}
