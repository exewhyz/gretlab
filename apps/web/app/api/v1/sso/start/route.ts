import { NextResponse, type NextRequest } from "next/server"

import { setStateCookie, ssoErrorPage } from "@/features/sso/http"
import { startSignIn } from "@/features/sso/server"

/** Sign in with your college: ?email= finds its single sign-on; ?next= is where to go after. */
export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams
    const { redirect, state } = await startSignIn(
      params.get("email") ?? "",
      params.get("next"),
      request.nextUrl.origin
    )
    const response = NextResponse.redirect(redirect, 302)
    setStateCookie(response, state)
    return response
  } catch (error) {
    return ssoErrorPage(error)
  }
}
