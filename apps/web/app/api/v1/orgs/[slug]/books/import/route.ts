import { route } from "@/lib/api/route"
import { booksImportSchema, importBooks } from "@/features/books/server"

export const POST = route(
  { access: "user", body: booksImportSchema },
  ({ user, params, body }) => importBooks(params.slug ?? "", user, body)
)
