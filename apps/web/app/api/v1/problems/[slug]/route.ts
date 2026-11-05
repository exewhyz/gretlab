import { notFound, route } from "@/lib/api/route"
import { getPublicProblem } from "@/features/problems/server"
import { requireFeature } from "@/features/settings/server"

export const GET = route({ access: "public" }, async ({ params }) => {
  await requireFeature("practice.enabled")
  const problem = await getPublicProblem(params.slug ?? "")
  if (!problem) throw notFound("Problem not found")
  return problem
})
