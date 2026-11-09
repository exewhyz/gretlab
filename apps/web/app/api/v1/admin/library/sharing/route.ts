import { getDb, organizations, sql } from "@workspace/db"
import { z } from "zod"

import { route } from "@/lib/api/route"
import { sharingSchema } from "@/features/library/schemas"
import { getSharing, setSharing } from "@/features/library/server"
import { writePlatformAudit } from "@/features/platform/staff"

/** ?kind=problem&id=…: who it's shared with; without them, the colleges to choose from. */
export const GET = route({ access: "platform.library.share" }, async ({ query }) => {
  const kind = z.enum(["problem", "question"]).safeParse(query.get("kind"))
  const id = query.get("id")
  const colleges = await getDb()
    .select({ id: organizations.id, name: organizations.name })
    .from(organizations)
    .orderBy(sql.asc(organizations.name))
  return {
    colleges,
    current: kind.success && id ? await getSharing(kind.data, id) : null,
  }
})

/** Sets how far the platform's items reach: everyone, chosen colleges and teachers, or staff only. */
export const PUT = route(
  { access: "platform.library.share", body: sharingSchema },
  async ({ user, body }) => {
    await setSharing(user, body.items, body)
    await writePlatformAudit(user, "library.share", `Shared ${body.items.length} items: ${body.sharing}`, {
      colleges: body.orgIds.length,
      people: body.emails.length,
    })
  }
)
