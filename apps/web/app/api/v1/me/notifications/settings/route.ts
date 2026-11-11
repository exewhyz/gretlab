import { route } from "@/lib/api/route"
import { myPreferences } from "@/features/notifications/policy-admin"

/** Your notification settings: which events email you, and which aren't yours to choose. */
export const GET = route({ access: "user" }, ({ user }) => myPreferences(user))
