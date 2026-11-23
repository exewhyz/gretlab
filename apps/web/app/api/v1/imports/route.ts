import { route } from "@/lib/api/route"
import { startImport, startImportSchema } from "@/features/jobs/imports"

/**
 * Starts an import too big for one request: { kind, slug, total }. Send its rows to
 * /imports/:id/rows in parts, then POST /imports/:id/run to check them, and again to add them.
 */
export const POST = route(
  { access: "user", body: startImportSchema },
  ({ user, body }) => startImport(user, body)
)
