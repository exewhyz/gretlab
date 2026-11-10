/*
 * Where a visitor's network address can be believed from, for lab exams limited to a
 * network. Any request header can be written by a visitor who reaches the app directly, so
 * an address counts only when something the visitor can't control vouches for it. In order:
 *
 * - "header": CLIENT_IP_HEADER names a header the host sets on every request, replacing
 *   what the visitor sent (Cloudflare `cf-connecting-ip`, Netlify `x-nf-client-connection-ip`,
 *   Fly.io `fly-client-ip`). The fallback for any host; the operator vouches for it, and it's
 *   safe only when visitors can't reach the app around that host. For `x-forwarded-for`,
 *   which hosts append to rather than replace, the last entry is the one the host's own
 *   edge added; earlier entries came from the visitor.
 * - "vercel": on Vercel (it sets VERCEL=1), every request comes through Vercel's edge,
 *   which overwrites the forwarded-for headers with the address it saw and doesn't forward
 *   addresses sent by the visitor. `x-vercel-forwarded-for` is that address, and unlike
 *   `x-forwarded-for` no proxy in front of Vercel can replace it.
 * - "proxy": behind Caddy (deploy/Caddyfile), which sets X-Client-IP and X-Proxy-Secret,
 *   replacing whatever the visitor sent; believed only with a PROXY_SECRET of 16+ characters.
 * - "none": nothing vouches, so the address is unknown and network-limited exams refuse.
 */

export type AddressSource = "header" | "vercel" | "proxy" | "none"

export const MIN_PROXY_SECRET_LENGTH = 16

/** A usable header name from CLIENT_IP_HEADER, lowercased, or null. */
export function clientIpHeader(value: string | undefined): string | null {
  const name = value?.trim().toLowerCase() ?? ""
  return /^[a-z0-9-]+$/.test(name) ? name : null
}

export function addressSource(env: {
  CLIENT_IP_HEADER?: string
  VERCEL?: string
  PROXY_SECRET?: string
}): AddressSource {
  if (clientIpHeader(env.CLIENT_IP_HEADER)) return "header"
  if (env.VERCEL === "1") return "vercel"
  if ((env.PROXY_SECRET ?? "").length >= MIN_PROXY_SECRET_LENGTH) return "proxy"
  return "none"
}

/** One entry of a header value ("client, proxy, ..."), or null. */
function entry(value: string | null | undefined, which: "first" | "last") {
  const parts = (value ?? "").split(",").map((part) => part.trim())
  const ip = which === "first" ? parts[0] : parts[parts.length - 1]
  return ip ? ip : null
}

/**
 * The visitor's address under a source. `header` reads a request header; `secretMatches`
 * compares the X-Proxy-Secret a request carried with PROXY_SECRET (in constant time);
 * `customHeader` is CLIENT_IP_HEADER.
 */
export function visitorAddress(
  source: AddressSource,
  header: (name: string) => string | null | undefined,
  secretMatches: (given: string) => boolean,
  customHeader?: string
): string | null {
  if (source === "header") {
    const name = clientIpHeader(customHeader)
    if (!name) return null
    return entry(header(name), name === "x-forwarded-for" ? "last" : "first")
  }
  if (source === "vercel")
    return entry(header("x-vercel-forwarded-for"), "first")
  if (source === "proxy") {
    if (!secretMatches(header("x-proxy-secret") ?? "")) return null
    return entry(header("x-client-ip"), "first")
  }
  return null
}
