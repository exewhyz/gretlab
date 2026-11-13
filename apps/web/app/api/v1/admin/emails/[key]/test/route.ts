import { route } from "@/lib/api/route"
import { sendTest } from "@/features/emails/server"

/** Sends the current wording, with example values, to the person editing it. */
export const POST = route({ access: "user" }, ({ user, params }) => sendTest(user, params.key ?? ""))
