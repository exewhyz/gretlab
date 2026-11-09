import { route } from "@/lib/api/route"
import { postChangeSchema, replySchema } from "@/features/discussions/schemas"
import { changePost, deletePost, getThread, postReply } from "@/features/discussions/server"

/** A thread with its replies. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  getThread(params.slug ?? "", user, params.groupId ?? "", params.postId ?? "")
)

/** A reply to the thread. */
export const POST = route({ access: "user", body: replySchema }, ({ user, params, body }) =>
  postReply(params.slug ?? "", user, params.groupId ?? "", params.postId ?? "", body)
)

/** An author's edit, or a teacher's moderation. */
export const PATCH = route({ access: "user", body: postChangeSchema }, ({ user, params, body }) =>
  changePost(params.slug ?? "", user, params.groupId ?? "", params.postId ?? "", body)
)

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  deletePost(params.slug ?? "", user, params.groupId ?? "", params.postId ?? "")
)
