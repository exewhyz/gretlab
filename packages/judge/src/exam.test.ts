import assert from "node:assert/strict"
import { test } from "node:test"

import { duringSitting, examEndsAt, ipAllowed, isNetwork } from "./exam.ts"

test("network entries: IPv4, CIDR ranges and exact IPv6", () => {
  for (const ok of ["10.0.0.1", "10.1.0.0/16", "0.0.0.0/0", "2001:db8::1", "2001:db8::/32", "::1", "fe80::/10", "::ffff:10.0.0.1"]) assert.ok(isNetwork(ok), ok)
  for (const bad of ["10.0.0", "10.0.0.256", "10.0.0.0/33", "lab", "2001:db8::/129", "1:2:3:4:5:6:7:8:9", "2001::db8::1", "1.2.3.4/8/1", ""]) assert.ok(!isNetwork(bad), bad)
})

test("no networks allows anyone, even an unknown address", () => {
  assert.ok(ipAllowed(null, []))
  assert.ok(ipAllowed("8.8.8.8", []))
})

test("addresses inside a range are allowed, others aren't", () => {
  const lab = ["10.1.0.0/16", "203.0.113.7"]
  assert.ok(ipAllowed("10.1.255.3", lab))
  assert.ok(ipAllowed("::ffff:10.1.0.9", lab))
  assert.ok(ipAllowed("203.0.113.7", lab))
  assert.ok(!ipAllowed("10.2.0.1", lab))
  assert.ok(!ipAllowed("203.0.113.8", lab))
  assert.ok(!ipAllowed(null, lab))
  assert.ok(ipAllowed("2001:DB8::1", ["2001:db8::1"]))
})

test("IPv6 ranges, for dual-stack labs with changing addresses", () => {
  const lab = ["2001:db8:42::/48"]
  assert.ok(ipAllowed("2001:db8:42:7:a1b2:c3d4:e5f6:1", lab))
  assert.ok(!ipAllowed("2001:db8:43::1", lab))
  assert.ok(!ipAllowed("10.0.0.1", lab))
  assert.ok(ipAllowed("::ffff:192.168.1.20", ["192.168.1.0/24"]))
})

test("a sitting ends at its time limit or the due time, whichever is first", () => {
  const start = new Date("2026-11-06T10:00:00Z")
  const due = new Date("2026-11-06T11:00:00Z")
  assert.equal(examEndsAt(start, due, 45).toISOString(), "2026-11-06T10:45:00.000Z")
  assert.equal(examEndsAt(start, due, 90).toISOString(), due.toISOString())
  assert.equal(examEndsAt(start, due, null).toISOString(), due.toISOString())
})

test("only submissions during the sitting count", () => {
  const at = (m) => ({ createdAt: new Date(Date.UTC(2026, 10, 6, 10, m)) })
  const attempts = [at(0), at(5), at(30), at(50)]
  const sitting = { startedAt: at(1).createdAt, endsAt: at(40).createdAt, finishedAt: null }
  assert.deepEqual(duringSitting(attempts, sitting), [at(5), at(30)])
  assert.deepEqual(duringSitting(attempts, { ...sitting, finishedAt: at(10).createdAt }), [at(5)])
  assert.deepEqual(duringSitting(attempts, null), [])
  // Stamped a few seconds after the close: pressed in time.
  const late = { createdAt: new Date(Date.UTC(2026, 10, 6, 10, 40, 5)) }
  const later = { createdAt: new Date(Date.UTC(2026, 10, 6, 10, 40, 30)) }
  assert.deepEqual(duringSitting([late, later], sitting), [late])
})
