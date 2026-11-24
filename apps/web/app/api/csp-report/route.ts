import { NextResponse, type NextRequest } from "next/server"

import { clientIp } from "@/lib/api/client-ip"

/*
 * Where browsers report what the Content-Security-Policy blocked, or would block while it's
 * report-only (lib/csp.ts). Each report is one log line ("where":"csp") with the directive,
 * what was blocked and the page, addresses cut to their origin and path: query strings can
 * hold tokens (a password link). Both formats: report-uri's {"csp-report": …} and the
 * Reporting API's array. A plain handler: browsers send these without our CSRF header.
 */

type Report = Record<string, unknown>

const MAX_BYTES = 64 * 1024

/*
 * At most this many reports a minute are logged per address, per server, counted in memory:
 * a page can report on every load, and reports mustn't cost a database write each.
 */
const PER_MINUTE = 60
const seen = new Map<string, { minute: number; n: number }>()

function quiet(address: string | null) {
  const minute = Math.floor(Date.now() / 60_000)
  const key = address ?? "unknown"
  const entry = seen.get(key)
  if (!entry || entry.minute !== minute) {
    if (seen.size > 10_000) seen.clear()
    seen.set(key, { minute, n: 1 })
    return false
  }
  entry.n += 1
  return entry.n > PER_MINUTE
}

/** An address without its query and fragment; a keyword ("inline", "eval") as it is. */
function bare(value: unknown) {
  if (typeof value !== "string" || !value) return null
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`.slice(0, 300)
  } catch {
    return value.slice(0, 100)
  }
}

function entries(body: unknown): Report[] {
  if (Array.isArray(body))
    return body
      .filter(
        (r) =>
          r && typeof r === "object" && (r as Report).type === "csp-violation"
      )
      .map((r) => ((r as Report).body ?? {}) as Report)
  if (body && typeof body === "object" && "csp-report" in body)
    return [(body as { "csp-report": Report })["csp-report"] ?? {}]
  return []
}

export async function POST(request: NextRequest) {
  // One address can't flood the logs.
  if (quiet(clientIp(request))) return new NextResponse(null, { status: 204 })
  const text = await request.text()
  if (text.length > MAX_BYTES) return new NextResponse(null, { status: 413 })
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return new NextResponse(null, { status: 400 })
  }
  for (const r of entries(body).slice(0, 20)) {
    console.warn(
      JSON.stringify({
        level: "warn",
        where: "csp",
        at: new Date().toISOString(),
        directive: String(
          r["effective-directive"] ??
            r.effectiveDirective ??
            r["violated-directive"] ??
            ""
        ).slice(0, 60),
        blocked: bare(r["blocked-uri"] ?? r.blockedURL),
        page: bare(r["document-uri"] ?? r.documentURL),
        source: bare(r["source-file"] ?? r.sourceFile),
        line: Number(r["line-number"] ?? r.lineNumber) || null,
        disposition: String(r.disposition ?? "").slice(0, 20),
      })
    )
  }
  return new NextResponse(null, { status: 204 })
}
