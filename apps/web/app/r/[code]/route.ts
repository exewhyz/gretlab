import { NextResponse, type NextRequest } from "next/server"
import { codeProblem } from "@workspace/judge"

import {
  findCode,
  REFERRAL_COOKIE,
  REFERRAL_COOKIE_DAYS,
} from "@/features/referrals/server"

/**
 * A referral link: remembers its code for 30 days (an organization registered from this
 * browser is attributed to it), then goes to the landing page. An unknown or unusable code
 * just goes there.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params
  const found = await findCode(code).catch(() => null)
  const response = NextResponse.redirect(new URL("/", request.url))
  if (found && !codeProblem(found, new Date()))
    response.cookies.set(REFERRAL_COOKIE, found.code, {
      maxAge: REFERRAL_COOKIE_DAYS * 86_400,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
    })
  return response
}
