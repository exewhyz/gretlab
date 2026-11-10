import { timingSafeEqual } from "node:crypto"

import { addressSource, visitorAddress } from "@workspace/judge"
import type { NextRequest } from "next/server"

/*
 * The visitor's network address, for lab exams limited to a network. Which headers are
 * believed (Vercel's edge, Caddy with PROXY_SECRET, or none, so network-limited exams
 * refuse) is decided in packages/judge/src/client-ip.ts, which explains why each is safe.
 */

const source = () => addressSource(process.env)

/** Whether this server can tell where requests come from. */
export const canVerifyAddresses = () => source() !== "none"

function sameSecret(given: string) {
  const a = Buffer.from(given)
  const b = Buffer.from(process.env.PROXY_SECRET ?? "")
  return a.length === b.length && timingSafeEqual(a, b)
}

export function clientIp(request: NextRequest): string | null {
  return visitorAddress(source(), (name) => request.headers.get(name), sameSecret)
}
