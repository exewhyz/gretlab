import { route } from "@/lib/api/route"
import { register, unregister } from "@/features/contests/server"
import { requireFeature } from "@/features/settings/server"

export const POST = route({ access: "user" }, async ({ user, params }) => {
  await requireFeature("contests.enabled")
  await register(params.slug ?? "", user)
})

export const DELETE = route({ access: "user" }, async ({ user, params }) => {
  await requireFeature("contests.enabled")
  await unregister(params.slug ?? "", user)
})
