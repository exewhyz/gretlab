import { route } from "@/lib/api/route"
import {
  moderate,
  moderateSchema,
  moderationList,
} from "@/features/solutions/server"

/** Solution posts for moderators: ?filter=reported (most reported first), hidden or recent. */
export const GET = route(
  { access: "platform.solutions.moderate" },
  ({ query }) => {
    const f = query.get("filter")
    return moderationList(f === "hidden" || f === "recent" ? f : "reported")
  }
)

/** Hides or shows a post or comment; logged. */
export const POST = route(
  { access: "platform.solutions.moderate", body: moderateSchema },
  ({ user, body }) => moderate(user, body)
)
