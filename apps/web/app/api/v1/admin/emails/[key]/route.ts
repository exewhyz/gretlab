import { route } from "@/lib/api/route"
import { resetTemplate, saveTemplate, templateSchema } from "@/features/emails/server"

/** Saves an email's wording (or, with key "layout", the shared footer). */
export const PUT = route({ access: "user", body: templateSchema }, ({ user, params, body }) =>
  saveTemplate(user, params.key ?? "", body)
)

/** Back to the default wording. */
export const DELETE = route({ access: "user" }, ({ user, params }) => resetTemplate(user, params.key ?? ""))
