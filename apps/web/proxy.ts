import { NextResponse, type NextRequest } from "next/server"

import { formerSlugMap } from "@/features/problems/slugs"

/*
 * Old problem addresses (/problems/p2) answer with a permanent redirect to the problem's
 * address now (/problems/integer-operations), before anything renders, so browsers and
 * search engines get a real 308. (A redirect from inside the page would arrive after the
 * layout started streaming, as a client-side redirect.) The page redirects too, for a slug
 * renamed within the last few minutes. Rules: features/problems/slugs.ts.
 */
export async function proxy(request: NextRequest) {
  const slug = request.nextUrl.pathname.split("/")[2]
  if (!slug) return NextResponse.next()
  let to: string | undefined
  try {
    to = (await formerSlugMap()).get(decodeURIComponent(slug))
  } catch {
    // No database (a build, an outage): the page handles it.
    return NextResponse.next()
  }
  if (!to) return NextResponse.next()
  const url = request.nextUrl.clone()
  url.pathname = `/problems/${to}`
  return NextResponse.redirect(url, 308)
}

// Only a problem's own page: one segment after /problems.
export const config = { matcher: "/problems/:slug" }
