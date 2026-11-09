import { route } from "@/lib/api/route"
import { listAllSubmissions } from "@/features/admin/server"

export const GET = route({ access: "platform.submissions.view" }, ({ query }) => {
  const kind = query.get("kind")
  const before = query.get("before")
  return listAllSubmissions(
    {
      kind: kind === "run" || kind === "all" ? kind : "submit",
      verdict: query.get("verdict"),
      search: query.get("search"),
      contest: query.get("contest"),
    },
    before ? new Date(before) : null
  )
})
