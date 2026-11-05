import { route } from "@/lib/api/route"
import { getProfile } from "@/features/catalog/server"

// Signed-in only: a college's students shouldn't be browsable by the whole internet.
export const GET = route({ access: "user" }, ({ params }) =>
  getProfile(params.handle ?? "")
)
