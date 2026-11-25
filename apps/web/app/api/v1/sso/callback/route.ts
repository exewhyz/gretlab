import { NextResponse, type NextRequest } from "next/server"

import {
  signInCookie,
  SSO_STATE_COOKIE,
  ssoErrorPage,
} from "@/features/sso/http"
import { finishSignIn, siteOrigin } from "@/features/sso/server"
import { ApiError } from "@/lib/api/route"

/**
 * Where the college's identity provider sends people back. Signed in, they go through the
 * second sign-in step (two-factor) like any sign-in, then on to where they were going.
 */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const error = params.get("error")
    if (error)
      throw new ApiError(
        400,
        "idp_error",
        `Your college's sign-in said: ${params.get("error_description") ?? error}.`
      )
    const { user, redirect } = await finishSignIn({
      code: params.get("code") ?? "",
      state: params.get("state") ?? "",
      cookieState: request.cookies.get(SSO_STATE_COOKIE)?.value ?? null,
      origin: request.nextUrl.origin,
    })
    const next = `/sign-in/continue?next=${encodeURIComponent(redirect)}`
    const response = NextResponse.redirect(
      new URL(next, siteOrigin(request.nextUrl.origin)),
      303
    )
    await signInCookie(response, user)
    return response
  } catch (error) {
    return ssoErrorPage(error)
  }
}
