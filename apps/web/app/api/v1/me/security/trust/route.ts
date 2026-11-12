import { cookies } from "next/headers"

import { route } from "@/lib/api/route"
import { TRUST_COOKIE, trustCookie } from "@/features/auth/two-factor"

/** Lets this browser skip the second step for 30 days (right after passing it). */
export const POST = route({ access: "user" }, async ({ user }) => {
  const trust = await trustCookie(user)
  ;(await cookies()).set(TRUST_COOKIE, trust.value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: trust.expires,
  })
  return { trustedUntil: trust.expires }
})
