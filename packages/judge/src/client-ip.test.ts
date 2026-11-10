import assert from "node:assert/strict"
import { test } from "node:test"

import { addressSource, visitorAddress } from "./client-ip.ts"

const SECRET = "a-proxy-secret-of-enough-length"
const headers = (h: Record<string, string>) => (name: string) => h[name] ?? null
const matches = (given: string) => given === SECRET

test("the source: a named header first, on any host", () => {
  assert.equal(
    addressSource({ CLIENT_IP_HEADER: "cf-connecting-ip" }),
    "header"
  )
  assert.equal(
    addressSource({
      CLIENT_IP_HEADER: "CF-Connecting-IP",
      VERCEL: "1",
      PROXY_SECRET: SECRET,
    }),
    "header"
  )
  // A malformed name is ignored, not trusted.
  assert.equal(
    addressSource({ CLIENT_IP_HEADER: "x ip;", VERCEL: "1" }),
    "vercel"
  )
  assert.equal(addressSource({ CLIENT_IP_HEADER: "  " }), "none")
})

test("a named header: its first entry; x-forwarded-for: the last, added by the host", () => {
  const cf = headers({
    "cf-connecting-ip": "10.9.1.2",
    "x-client-ip": "8.8.8.8",
  })
  assert.equal(
    visitorAddress("header", cf, matches, "CF-Connecting-IP"),
    "10.9.1.2"
  )
  assert.equal(
    visitorAddress("header", headers({}), matches, "cf-connecting-ip"),
    null
  )
  // The visitor sent "8.8.8.8"; the host appended the address it saw.
  const xff = headers({ "x-forwarded-for": "8.8.8.8, 10.9.1.2" })
  assert.equal(
    visitorAddress("header", xff, matches, "x-forwarded-for"),
    "10.9.1.2"
  )
  assert.equal(visitorAddress("header", cf, matches, "bad name!"), null)
  assert.equal(visitorAddress("header", cf, matches, undefined), null)
})

test("the source: Vercel, then a long enough proxy secret, else none", () => {
  assert.equal(addressSource({ VERCEL: "1" }), "vercel")
  assert.equal(addressSource({ VERCEL: "1", PROXY_SECRET: SECRET }), "vercel")
  assert.equal(addressSource({ PROXY_SECRET: SECRET }), "proxy")
  assert.equal(addressSource({ PROXY_SECRET: "short" }), "none")
  assert.equal(addressSource({ VERCEL: "0" }), "none")
  assert.equal(addressSource({}), "none")
})

test("on Vercel: only x-vercel-forwarded-for counts", () => {
  const get = headers({
    "x-vercel-forwarded-for": "10.9.1.2",
    "x-forwarded-for": "8.8.8.8",
    "x-client-ip": "8.8.8.8",
    "x-proxy-secret": SECRET,
  })
  assert.equal(visitorAddress("vercel", get, matches), "10.9.1.2")
  assert.equal(
    visitorAddress("vercel", headers({ "x-client-ip": "10.9.1.2" }), matches),
    null
  )
  assert.equal(visitorAddress("vercel", headers({}), matches), null)
})

test("a list or padding keeps the first address", () => {
  const get = headers({ "x-vercel-forwarded-for": " 2001:db8::7 , 10.0.0.1" })
  assert.equal(visitorAddress("vercel", get, matches), "2001:db8::7")
  assert.equal(
    visitorAddress(
      "vercel",
      headers({ "x-vercel-forwarded-for": " , " }),
      matches
    ),
    null
  )
})

test("behind Caddy: the address needs the secret", () => {
  const good = headers({ "x-proxy-secret": SECRET, "x-client-ip": "10.9.1.2" })
  assert.equal(visitorAddress("proxy", good, matches), "10.9.1.2")
  const forged = headers({
    "x-proxy-secret": "guess",
    "x-client-ip": "10.9.1.2",
  })
  assert.equal(visitorAddress("proxy", forged, matches), null)
  const vercelHeader = headers({ "x-vercel-forwarded-for": "10.9.1.2" })
  assert.equal(visitorAddress("proxy", vercelHeader, matches), null)
})

test("with nothing vouching, no address", () => {
  const get = headers({
    "x-vercel-forwarded-for": "10.9.1.2",
    "x-client-ip": "10.9.1.2",
    "x-proxy-secret": SECRET,
  })
  assert.equal(visitorAddress("none", get, matches), null)
})
