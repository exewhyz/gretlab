import { pickUpload, removeFromLibrary } from "@/features/uploads/server"
import { route } from "@/lib/api/route"

/** Picked again: it moves to the top of your images. */
export const POST = route({ access: "user" }, ({ user, params }) =>
  pickUpload(user, params.id ?? "")
)

/** Takes it out of your images; the image itself keeps working where it's used. */
export const DELETE = route({ access: "user" }, ({ user, params }) =>
  removeFromLibrary(user, params.id ?? "")
)
