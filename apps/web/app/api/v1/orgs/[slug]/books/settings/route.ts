import { route } from "@/lib/api/route"
import {
  librarySettingsSchema,
  saveLibrarySettings,
} from "@/features/books/server"

export const PUT = route(
  { access: "user", body: librarySettingsSchema },
  ({ user, params, body }) => saveLibrarySettings(params.slug ?? "", user, body)
)
