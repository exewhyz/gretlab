import { NextResponse, type NextRequest } from "next/server"

import { errorPage, paramsOf, stateCookie } from "@/features/lti/http"
import { loginInit } from "@/features/lti/server"

/** LTI 1.3 login initiation (OIDC third-party login): the LMS sends the browser here first. */
async function handle(request: NextRequest) {
  try {
    const { redirect, state } = await loginInit(await paramsOf(request), request.nextUrl.origin)
    const response = NextResponse.redirect(redirect, 302)
    stateCookie(response, state)
    return response
  } catch (error) {
    return errorPage(error)
  }
}

export const GET = handle
export const POST = handle
