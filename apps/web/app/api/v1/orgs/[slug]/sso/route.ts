import { route } from "@/lib/api/route"
import {
  saveSsoSettings,
  ssoSettings,
  ssoSettingsSchema,
} from "@/features/sso/server"

/** The college's single sign-on: its identity provider, and the domains GretLab confirmed. */
export const GET = route({ access: "user" }, ({ user, params, request }) =>
  ssoSettings(params.slug ?? "", user, new URL(request.url).origin)
)

/** Connects (or switches off) its identity provider. The secret is never sent back. */
export const PUT = route(
  { access: "user", body: ssoSettingsSchema, stepUp: true },
  async ({ user, params, body }) => {
    await saveSsoSettings(params.slug ?? "", user, body)
  }
)
