import { route } from "@/lib/api/route"
import { memberDashboard } from "@/features/me/dashboard"

/**
 * Your home: schools, work due, contests, practice and the daily challenge. `?scope=` is
 * the header's organization switcher (personal, organization slugs); none is everything.
 */
export const GET = route({ access: "user" }, ({ user, query }) =>
  memberDashboard(user, query.get("scope"))
)
