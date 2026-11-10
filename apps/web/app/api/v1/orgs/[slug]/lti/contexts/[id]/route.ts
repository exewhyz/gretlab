import { z } from "zod"

import { route } from "@/lib/api/route"
import { orgLinkContext } from "@/features/lti/org"

/** Links an LMS course to a class (null unlinks it). */
export const PUT = route(
  { access: "user", body: z.object({ groupId: z.uuid().nullable() }) },
  ({ user, params, body }) => orgLinkContext(params.slug ?? "", user, params.id ?? "", body.groupId)
)
