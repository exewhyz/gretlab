import { encode } from "next-auth/jwt"
import { NextResponse, type NextRequest } from "next/server"

import type { User } from "@workspace/db"

import { ApiError } from "@/lib/api/route"

/*
 * The LMS-facing endpoints answer browsers sent by an LMS, so errors are short pages, not
 * JSON, and the sign-in is a session cookie like Google sign-in makes.
 */

const secure = () => (process.env.NEXTAUTH_URL ?? "").startsWith("https://")
export const STATE_COOKIE = "lti_state"

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export function errorPage(error: unknown) {
  const known = error instanceof ApiError
  if (!known) console.error("[lti]", error)
  const message = known ? error.message : "Something went wrong opening Gretlab from your course."
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Couldn't open Gretlab</title></head><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><h1 style="font-size:1.25rem">Couldn't open Gretlab</h1><p data-testid="lti-error">${escape(message)}</p><p style="color:#666">Go back to your course and try the link again. If it keeps happening, tell your teacher.</p></body></html>`,
    { status: known ? error.status : 500, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } }
  )
}

/** Parameters from the query and, for POSTs, the form body. */
export async function paramsOf(request: NextRequest) {
  const params = new URLSearchParams(request.nextUrl.searchParams)
  if (request.method === "POST") {
    const type = request.headers.get("content-type") ?? ""
    if (type.includes("application/x-www-form-urlencoded") || type.includes("multipart/form-data")) {
      const form = await request.formData()
      for (const [k, v] of form.entries()) if (typeof v === "string") params.set(k, v)
    }
  }
  return params
}

export function stateCookie(response: NextResponse, state: string) {
  // The launch comes back as a cross-site POST, so over https the cookie must be SameSite=None.
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: secure(),
    sameSite: secure() ? "none" : "lax",
    path: "/api/v1/lti",
    maxAge: 600,
  })
}

/** Signs the person in, as Google sign-in does: a session cookie with their email. */
export async function signIn(response: NextResponse, user: User) {
  const maxAge = 30 * 24 * 60 * 60
  const token = await encode({
    token: { email: user.email, name: user.name, sub: user.id },
    secret: process.env.NEXTAUTH_SECRET ?? "",
    maxAge,
  })
  response.cookies.set(secure() ? "__Secure-next-auth.session-token" : "next-auth.session-token", token, {
    httpOnly: true,
    secure: secure(),
    sameSite: "lax",
    path: "/",
    maxAge,
  })
  response.cookies.delete({ name: STATE_COOKIE, path: "/api/v1/lti" })
}
