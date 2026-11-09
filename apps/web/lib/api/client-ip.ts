import { timingSafeEqual } from "node:crypto"

import type { NextRequest } from "next/server"

/*
 * The visitor's network address, for lab exams limited to a network.
 *
 * Any request header can be written by a visitor who reaches the app directly, so an
 * address is believed only when the request also carries PROXY_SECRET: Caddy
 * (deploy/Caddyfile) sets X-Client-IP to the address it saw and X-Proxy-Secret to that
 * secret, replacing whatever the visitor sent. Without the secret configured, or without a
 * matching header, the address is unknown (null), and network-limited exams refuse rather
 * than trust it.
 */

const MIN_SECRET_LENGTH = 16

/** Whether this server can tell where requests come from. */
export const canVerifyAddresses = () =>
  (process.env.PROXY_SECRET ?? "").length >= MIN_SECRET_LENGTH

function sameSecret(given: string, expected: string) {
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function clientIp(request: NextRequest): string | null {
  const secret = process.env.PROXY_SECRET ?? ""
  if (secret.length < MIN_SECRET_LENGTH) return null
  const given = request.headers.get("x-proxy-secret") ?? ""
  if (!sameSecret(given, secret)) return null
  const ip = request.headers.get("x-client-ip")?.trim()
  return ip || null
}
