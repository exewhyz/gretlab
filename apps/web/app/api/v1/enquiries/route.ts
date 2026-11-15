import { route } from "@/lib/api/route"
import { submitEnquiry } from "@/features/landing/enquiries"
import { enquirySchema } from "@/features/landing/schemas"

/** The landing page's contact form: anyone may send one (a few an hour per address). */
export const POST = route({ access: "public", body: enquirySchema }, ({ body }) => submitEnquiry(body))
