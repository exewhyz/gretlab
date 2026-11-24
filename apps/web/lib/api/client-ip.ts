import { timingSafeEqual } from "node:crypto"

import {
  addressSource,
  visitorAddress,
  type AddressSource,
} from "@workspace/judge"
import type { NextRequest } from "next/server"

/*
 * The visitor's network address, for lab exams limited to a network. Which headers are
 * believed (CLIENT_IP_HEADER on any host, Vercel's edge, Caddy with PROXY_SECRET, or none,
 * so network-limited exams refuse) is decided in packages/judge/src/client-ip.ts, which
 * explains why each is safe.
 */

export const addressSourceNow = (): AddressSource => addressSource(process.env)

/** Whether this server can tell where requests come from. */
export const canVerifyAddresses = () => addressSourceNow() !== "none"

function sameSecret(given: string) {
  const a = Buffer.from(given)
  const b = Buffer.from(process.env.PROXY_SECRET ?? "")
  return a.length === b.length && timingSafeEqual(a, b)
}

export function clientIp(request: NextRequest): string | null {
  return addressFrom((name) => request.headers.get(name))
}

/** The same, from any way of reading a header (NextAuth hands authorize a plain object). */
export function addressFrom(
  header: (name: string) => string | null | undefined
) {
  return visitorAddress(
    addressSourceNow(),
    (name) => header(name) ?? null,
    sameSecret,
    process.env.CLIENT_IP_HEADER
  )
}
