import { route } from "@/lib/api/route"
import { deleteTestimonial } from "@/features/landing/enquiries"

export const DELETE = route({ access: "platform.settings.manage" }, ({ user, params }) => deleteTestimonial(params.id ?? "", user))
