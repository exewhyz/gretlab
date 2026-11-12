import { route } from "@/lib/api/route"
import { addBook, bookSchema, listBooks } from "@/features/books/server"

/** The library's books matching ?q=, with copies free. Members and library staff. */
export const GET = route({ access: "user" }, ({ user, params, query }) =>
  listBooks(params.slug ?? "", user, query.get("q") ?? "")
)

export const POST = route(
  { access: "user", body: bookSchema },
  ({ user, params, body }) => addBook(params.slug ?? "", user, body)
)
