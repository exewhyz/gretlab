import { route } from "@/lib/api/route"
import { bookSchema, deleteBook, updateBook } from "@/features/books/server"

export const PUT = route(
  { access: "user", body: bookSchema },
  ({ user, params, body }) =>
    updateBook(params.slug ?? "", user, params.id ?? "", body)
)

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  deleteBook(params.slug ?? "", user, params.id ?? "")
)
