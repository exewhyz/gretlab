import { markReading } from "@/features/courses/readings"
import { readingDoneSchema } from "@/features/courses/schemas"
import { route } from "@/lib/api/route"

/** Marks the reading read, or not. */
export const PUT = route(
  { access: "user", body: readingDoneSchema },
  ({ user, params, body }) =>
    markReading(
      params.slug ?? "",
      user,
      params.groupId ?? "",
      params.courseId ?? "",
      params.readingId ?? "",
      body.done
    )
)
