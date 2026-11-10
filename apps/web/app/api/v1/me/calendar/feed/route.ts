import { route } from "@/lib/api/route"
import { removeFeed, rotateFeed } from "@/features/calendar/server"

/** Turns the calendar feed on, or moves it to a new secret address. */
export const POST = route({ access: "user" }, ({ user }) => rotateFeed(user))

export const DELETE = route({ access: "user" }, async ({ user }) => {
  await removeFeed(user)
})
