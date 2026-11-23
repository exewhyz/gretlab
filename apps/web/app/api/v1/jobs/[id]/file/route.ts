import { route } from "@/lib/api/route"
import { jobFile } from "@/features/jobs/server"

/** A finished job's file (an export), for its starter only, for a day. */
export const GET = route({ access: "user" }, async ({ user, params }) => {
  const file = await jobFile(user, params.id ?? "")
  return new Response(new Uint8Array(file.data), {
    headers: {
      "content-type": file.contentType,
      "content-disposition": `attachment; filename="${file.name.replace(/[^\w.-]/g, "_")}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  })
})
