import { route } from "@/lib/api/route"
import { issueBook, issueSchema, listLoans } from "@/features/books/server"

/** Loans: ?show=out (default), overdue or all; ?q= searches book and borrower. */
export const GET = route({ access: "user" }, ({ user, params, query }) =>
  listLoans(
    params.slug ?? "",
    user,
    query.get("show") ?? "out",
    query.get("q") ?? ""
  )
)

/** Lends a book to a member. */
export const POST = route(
  { access: "user", body: issueSchema },
  ({ user, params, body }) => issueBook(params.slug ?? "", user, body)
)
