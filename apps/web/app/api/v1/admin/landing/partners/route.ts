import { route } from "@/lib/api/route"
import { addPartner, landingProof } from "@/features/landing/enquiries"
import { partnerSchema } from "@/features/landing/schemas"

/** Institutions named on the landing page (real ones only). */
export const GET = route({ access: "platform.settings.manage" }, async () => ({ partners: (await landingProof()).partners }))

export const POST = route({ access: "platform.settings.manage", body: partnerSchema }, ({ user, body }) => addPartner(body, user))
