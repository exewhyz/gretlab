import { route } from "@/lib/api/route"
import { uploadResponse } from "@/features/uploads/server"

/** An uploaded image. Public, like the problem pages that show it. */
export const GET = route({ access: "public" }, ({ params }) =>
  uploadResponse(params.id ?? "")
)
