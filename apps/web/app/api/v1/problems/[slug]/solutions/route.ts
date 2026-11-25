import { route } from "@/lib/api/route"
import { listPosts, postSchema, savePost } from "@/features/solutions/server"

/** The problem's solution posts once you may read them (?sort=votes|new); else how many. */
export const GET = route({ access: "user" }, ({ user, params, query }) =>
  listPosts(
    params.slug ?? "",
    user,
    query.get("sort") === "new" ? "new" : "votes"
  )
)

/** Writes or rewrites your post, with code from one of your accepted submissions. */
export const POST = route(
  { access: "user", body: postSchema },
  ({ user, params, body }) => savePost(params.slug ?? "", user, body)
)
