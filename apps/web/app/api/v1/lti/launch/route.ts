import { NextResponse, type NextRequest } from "next/server"

import { errorPage, paramsOf, signIn, STATE_COOKIE } from "@/features/lti/http"
import { launch, siteOrigin } from "@/features/lti/server"
import { ApiError } from "@/lib/api/route"

/** LTI 1.3 launch: the LMS posts a signed id_token; the person is signed in and sent on. */
export async function POST(request: NextRequest) {
  try {
    const params = await paramsOf(request)
    const idToken = params.get("id_token")
    const state = params.get("state")
    if (!idToken || !state) throw new ApiError(400, "bad_launch", "The launch is missing its token.")
    const { user, redirect } = await launch(idToken, state, request.cookies.get(STATE_COOKIE)?.value ?? null)
    const response = NextResponse.redirect(new URL(redirect, siteOrigin(request.nextUrl.origin)), 303)
    await signIn(response, user)
    return response
  } catch (error) {
    return errorPage(error)
  }
}
