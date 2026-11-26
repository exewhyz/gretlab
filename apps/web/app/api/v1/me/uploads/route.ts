import { myUploads } from "@/features/uploads/server"
import { readPage } from "@/lib/api/paging"
import { route } from "@/lib/api/route"

/** ?page=&q=: your own images, most recently used first, to pick one again. */
export const GET = route({ access: "user" }, ({ user, query }) =>
  myUploads(user, readPage(query), query.get("for") === "logo")
)
