import { route } from "@/lib/api/route"
import { deletePartner } from "@/features/landing/enquiries"

export const DELETE = route({ access: "platform.settings.manage" }, ({ user, params }) => deletePartner(params.id ?? "", user))
