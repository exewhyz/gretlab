import { route } from "@/lib/api/route"
import { deleteRoom, roomSchema, updateRoom } from "@/features/hostel/server"

export const PUT = route(
  { access: "user", body: roomSchema },
  ({ user, params, body }) =>
    updateRoom(params.slug ?? "", user, params.roomId ?? "", body)
)

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  deleteRoom(params.slug ?? "", user, params.roomId ?? "")
)
