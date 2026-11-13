import { route } from "@/lib/api/route"
import { listTemplates } from "@/features/emails/server"

/** Every email's wording (current and default), placeholders and examples, and the footer. */
export const GET = route({ access: "user" }, ({ user }) => listTemplates(user))
