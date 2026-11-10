/*
 * Where a visitor's network address can be believed from, for lab exams limited to a
 * network. Any request header can be written by a visitor who reaches the app directly, so
 * an address counts only when something the visitor can't control vouches for it:
 *
 * - "vercel": on Vercel (it sets VERCEL=1), every request comes through Vercel's edge,
 *   which overwrites the forwarded-for headers with the address it saw and doesn't forward
 *   addresses sent by the visitor. `x-vercel-forwarded-for` is that address, and unlike
 *   `x-forwarded-for` no proxy in front of Vercel can replace it.
 * - "proxy": behind Caddy (deploy/Caddyfile), which sets X-Client-IP and X-Proxy-Secret,
 *   replacing whatever the visitor sent; believed only with a PROXY_SECRET of 16+ characters.
 * - "none": nothing vouches, so the address is unknown and network-limited exams refuse.
 */

export type AddressSource = "vercel" | "proxy" | "none"

export const MIN_PROXY_SECRET_LENGTH = 16

export function addressSource(env: {
  VERCEL?: string
  PROXY_SECRET?: string
}): AddressSource {
  if (env.VERCEL === "1") return "vercel"
  if ((env.PROXY_SECRET ?? "").length >= MIN_PROXY_SECRET_LENGTH) return "proxy"
  return "none"
}

/** The first address in a header value ("client, proxy, ..."), or null. */
function firstAddress(value: string | null | undefined) {
  const ip = value?.split(",")[0]?.trim()
  return ip ? ip : null
}

/**
 * The visitor's address under a source. `header` reads a request header; `secretMatches`
 * compares the X-Proxy-Secret a request carried with PROXY_SECRET (in constant time).
 */
export function visitorAddress(
  source: AddressSource,
  header: (name: string) => string | null | undefined,
  secretMatches: (given: string) => boolean
): string | null {
  if (source === "vercel") return firstAddress(header("x-vercel-forwarded-for"))
  if (source === "proxy") {
    if (!secretMatches(header("x-proxy-secret") ?? "")) return null
    return firstAddress(header("x-client-ip"))
  }
  return null
}
