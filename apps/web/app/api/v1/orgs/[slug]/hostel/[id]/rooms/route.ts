import { route } from "@/lib/api/route"
import {
  addRooms,
  hostelRoomsList,
  roomsSchema,
} from "@/features/hostel/server"

/** The hostel's rooms and beds, and who's in each. */
export const GET = route({ access: "user" }, ({ user, params }) =>
  hostelRoomsList(params.slug ?? "", user, params.id ?? "")
)

/** Adds a run of rooms. */
export const POST = route(
  { access: "user", body: roomsSchema },
  ({ user, params, body }) =>
    addRooms(params.slug ?? "", user, params.id ?? "", body)
)
