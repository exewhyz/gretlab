import { z } from "zod"

import { route } from "@/lib/api/route"
import { deepLinkChoices, deepLinkRespond } from "@/features/lti/server"

/** What a teacher can add to their LMS course. */
export const GET = route({ access: "user" }, ({ user, params }) => deepLinkChoices(user, params.id ?? ""))

/** The signed answer for the LMS; the page posts it there. */
export const POST = route(
  { access: "user", body: z.object({ assignmentId: z.uuid() }) },
  ({ user, params, body, request }) => deepLinkRespond(user, params.id ?? "", body.assignmentId, request.nextUrl.origin)
)
