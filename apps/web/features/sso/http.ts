import { encode } from "next-auth/jwt"
import { NextResponse } from "next/server"

import type { User } from "@workspace/db"

import { ApiError } from "@/lib/api/route"
import { reportError } from "@/lib/report-error"

/*
 * The browser-facing ends of a college sign-in: the IdP sends people here, so errors are a short
 * page, not JSON, and signing in sets the same session cookie Google sign-in makes.
 */

const secure = () => (process.env.NEXTAUTH_URL ?? "").startsWith("https://")
export const SSO_STATE_COOKIE = "sso_state"
const COOKIE_PATH = "/api/v1/sso"

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

export function ssoErrorPage(error: unknown) {
  const known = error instanceof ApiError
  const message = known
    ? error.message
    : `Something went wrong signing you in (reference ${reportError(error, { where: "sso" })}).`
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Couldn't sign you in</title></head><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><h1 style="font-size:1.25rem">Couldn't sign you in</h1><p data-testid="sso-error">${escape(message)}</p><p><a href="/sign-in">Back to sign in</a></p></body></html>`,
    {
      status: known ? error.status : 500,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    }
  )
}

/** The state, carried by this browser so a sign-in finishes only where it started. */
export function setStateCookie(response: NextResponse, state: string) {
  // The IdP sends the browser back with a top-level GET, which carries Lax cookies.
  response.cookies.set(SSO_STATE_COOKIE, state, {
    httpOnly: true,
    secure: secure(),
    sameSite: "lax",
    path: COOKIE_PATH,
    maxAge: 600,
  })
}

/** Signs the person in, as Google sign-in does, then the second step decides the rest. */
export async function signInCookie(response: NextResponse, user: User) {
  const maxAge = 30 * 24 * 60 * 60
  const token = await encode({
    token: {
      email: user.email,
      name: user.name,
      sub: user.id,
      signedInAt: Date.now(),
    },
    secret: process.env.NEXTAUTH_SECRET ?? "",
    maxAge,
  })
  response.cookies.set(
    secure() ? "__Secure-next-auth.session-token" : "next-auth.session-token",
    token,
    {
      httpOnly: true,
      secure: secure(),
      sameSite: "lax",
      path: "/",
      maxAge,
    }
  )
  response.cookies.delete({ name: SSO_STATE_COOKIE, path: COOKIE_PATH })
}
