import { route } from "@/lib/api/route"
import { listContests } from "@/features/contests/server"
import { requireFeature } from "@/features/settings/server"

export const GET = route({ access: "public" }, async ({ user }) => {
  await requireFeature("contests.enabled")
  return listContests(user)
})
