import { route } from "@/lib/api/route"
import { memberDashboard } from "@/features/me/dashboard"

/** Your home: schools, work due, contests, practice and the daily challenge. */
export const GET = route({ access: "user" }, ({ user }) => memberDashboard(user))
