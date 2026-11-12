import { route } from "@/lib/api/route"
import { signUpOrganization } from "@/features/orgs/server"
import { signupSchema } from "@/features/orgs/schemas"

/** Registers a school (or college, cohort…) with you as its owner, if sign-ups allow. */
export const POST = route(
  { access: "user", body: signupSchema },
  ({ user, body }) => signUpOrganization(user, body)
)
