import type { NextRequest } from "next/server"

/**
 * The visitor's address, as the reverse proxy saw it. Caddy appends the address it received
 * the request from to X-Forwarded-For, so the last entry is the one a visitor can't forge;
 * earlier entries came from the visitor. TRUSTED_PROXIES says how many proxies sit in front
 * (default 1, Caddy); with none, there is no trustworthy header and the answer is null.
 */
export function clientIp(request: NextRequest): string | null {
  const hops = Number(process.env.TRUSTED_PROXIES ?? 1)
  if (!Number.isInteger(hops) || hops < 1) return null
  const chain = (request.headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
  return chain[chain.length - hops] ?? null
}
