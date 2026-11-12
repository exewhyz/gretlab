import { route } from "@/lib/api/route"
import { librarySetup } from "@/features/books/server"

/** What library staff may do, the loan rules and the numbers. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  librarySetup(params.slug ?? "", user)
)
