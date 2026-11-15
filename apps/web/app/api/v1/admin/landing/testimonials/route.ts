import { route } from "@/lib/api/route"
import { addTestimonial, landingProof } from "@/features/landing/enquiries"
import { testimonialSchema } from "@/features/landing/schemas"

/** Quotes shown on the landing page (real ones only, with permission). */
export const GET = route({ access: "platform.settings.manage" }, async () => ({ testimonials: (await landingProof()).testimonials }))

export const POST = route({ access: "platform.settings.manage", body: testimonialSchema }, ({ user, body }) => addTestimonial(body, user))
