import { route } from "@/lib/api/route"
import { signUpOrganization } from "@/features/orgs/server"
import { signupSchema } from "@/features/orgs/schemas"
import { attribute, REFERRAL_COOKIE } from "@/features/referrals/server"

/**
 * Registers a school (or college, cohort…) with you as its owner, if sign-ups allow. Registered
 * from a browser that followed a referral link, it's attributed to that link (not your own).
 */
export const POST = route(
  { access: "user", body: signupSchema },
  async ({ user, body, request }) => {
    const made = await signUpOrganization(user, body)
    const code = request.cookies.get(REFERRAL_COOKIE)?.value
    if (code) await attribute(made.id, code, user.id).catch(() => false)
    return made
  }
)
