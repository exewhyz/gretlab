import { readingView } from "@/features/courses/readings"
import { route } from "@/lib/api/route"

/** A course's reading, with its module's items and the steps before and after. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  readingView(
    params.slug ?? "",
    user,
    params.groupId ?? "",
    params.courseId ?? "",
    params.readingId ?? ""
  )
)
