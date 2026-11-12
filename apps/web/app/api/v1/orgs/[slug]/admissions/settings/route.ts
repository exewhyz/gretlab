import { route } from "@/lib/api/route"
import {
  admissionSettings,
  saveAdmissionSettings,
  settingsSchema,
} from "@/features/admissions/server"

export const GET = route({ access: "user" }, ({ user, params }) =>
  admissionSettings(params.slug ?? "", user)
)

/** Opens or closes admissions, for a year and classes. */
export const PUT = route(
  { access: "user", body: settingsSchema },
  ({ user, params, body }) => saveAdmissionSettings(params.slug ?? "", user, body)
)
