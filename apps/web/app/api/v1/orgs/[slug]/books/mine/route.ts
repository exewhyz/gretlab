import { route } from "@/lib/api/route"
import { myLibrary } from "@/features/books/server"

/** The signed-in member's loans here, and the rules. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  myLibrary(params.slug ?? "", user)
)
