import { route } from "@/lib/api/route"
import {
  classOutcomes,
  classOutcomesCsv,
  saveClassOutcomes,
} from "@/features/classes/server"
import { courseOutcomesSchema } from "@/features/outcomes/schemas"

/** The class's course outcomes and their attainment; ?format=csv downloads the report. */
export const GET = route({ access: "user" }, async ({ user, params, query }) => {
  const slug = params.slug ?? ""
  const groupId = params.groupId ?? ""
  if (query.get("format") !== "csv") return classOutcomes(slug, user, groupId)
  const { filename, body } = await classOutcomesCsv(slug, user, groupId)
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  })
})

export const PUT = route(
  { access: "user", body: courseOutcomesSchema },
  ({ user, params, body }) =>
    saveClassOutcomes(params.slug ?? "", user, params.groupId ?? "", body)
)
