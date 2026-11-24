import assert from "node:assert/strict"
import net from "node:net"
import { after, test } from "node:test"

import postgres from "postgres"

import { clientOptions } from "./index.ts"

/*
 * Behind a transaction pooler (DATABASE_PREPARE=false), the client must never start a query on a
 * connection while that connection still owes an earlier answer: Supabase's pooler loses such
 * queries (supabase/supavisor#1239), which took the site down on 24 November 2026. A proxy
 * between the client and Postgres reads the protocol and counts every query (Parse or Query)
 * sent while an earlier one hasn't reached ReadyForQuery.
 */

const url = new URL(process.env.DATABASE_URL ?? "")
const target = { host: url.hostname, port: Number(url.port || 5432) }

function reader(onMessage: (type: string) => void, startup: boolean) {
  let buf = Buffer.alloc(0)
  return (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk])
    for (;;) {
      if (startup) {
        if (buf.length < 4) return
        const len = buf.readUInt32BE(0)
        if (buf.length < len) return
        buf = buf.subarray(len)
        startup = false
        continue
      }
      if (buf.length < 5) return
      const len = buf.readUInt32BE(1)
      if (buf.length < 1 + len) return
      onMessage(String.fromCharCode(buf[0]!))
      buf = buf.subarray(1 + len)
    }
  }
}

async function measure(options: postgres.Options<{}>) {
  const counts = { sent: 0, pipelined: 0 }
  const proxy = net.createServer((client) => {
    const server = net.connect(target.port, target.host)
    let ready = false
    let owed = 0
    const fromClient = reader((t) => {
      if (!ready) return
      if (t === "P" || t === "Q") {
        counts.sent++
        if (owed > 0) counts.pipelined++
      }
      if (t === "S" || t === "Q") owed++
    }, true)
    const fromServer = reader((t) => {
      if (t !== "Z") return
      if (ready) owed = Math.max(0, owed - 1)
      ready = true
    }, false)
    client.on("data", (b: Buffer) => (fromClient(b), server.write(b)))
    server.on("data", (b: Buffer) => (fromServer(b), client.write(b)))
    for (const s of [client, server]) s.on("error", () => {})
    client.on("close", () => server.destroy())
    server.on("close", () => client.destroy())
  })
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r))
  const via = new URL(url)
  via.host = `127.0.0.1:${(proxy.address() as net.AddressInfo).port}`
  const sql = postgres(via.toString(), { ...options, max: 1, ssl: false })
  try {
    // Values (the two-step kind), plain, and a transaction, each several at once on one connection.
    await Promise.all(
      Array.from(
        { length: 8 },
        (_, i) => sql`select ${i}::int as n, pg_sleep(0.02)`
      )
    )
    await Promise.all(Array.from({ length: 8 }, () => sql`select 1 as plain`))
    await sql.begin((tx) =>
      Promise.all(
        Array.from({ length: 4 }, (_, i) => tx`select ${i}::int as n`)
      )
    )
  } finally {
    await sql.end()
    proxy.close()
  }
  return counts
}

const was = process.env.DATABASE_PREPARE
after(() => {
  process.env.DATABASE_PREPARE = was
})

test("behind a pooler, the client never starts a query while one is unanswered", async () => {
  process.env.DATABASE_PREPARE = "false"
  const { sent, pipelined } = await measure(clientOptions())
  assert.ok(sent >= 20, `only ${sent} queries were seen`)
  assert.equal(
    pipelined,
    0,
    `${pipelined} of ${sent} queries were sent while an earlier one was unanswered`
  )
})

test("the probe sees pipelining when it happens (postgres.js's default)", async () => {
  process.env.DATABASE_PREPARE = "true"
  const { pipelined } = await measure(clientOptions())
  assert.ok(
    pipelined > 0,
    "the probe saw no pipelining at all, so it can't be trusted"
  )
})
