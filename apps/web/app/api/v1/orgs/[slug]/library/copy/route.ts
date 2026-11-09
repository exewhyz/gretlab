import { route } from "@/lib/api/route"
import { orgCopyToLibrary } from "@/features/library/org"
import { copySchema } from "@/features/library/schemas"

/** The college's own copies of items it can use, to adapt. */
export const POST = route({ access: "user", body: copySchema }, ({ user, params, body }) =>
  orgCopyToLibrary(params.slug ?? "", user, body.items)
)
