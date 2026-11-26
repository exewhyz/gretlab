import { z } from "zod"

import { removeLogo, saveLogo, setLogoFrom } from "@/features/orgs/branding"
import { MAX_UPLOAD_BYTES } from "@/features/uploads/server"
import { ApiError, route } from "@/lib/api/route"

/** A new logo (multipart, field "file"): a PNG or JPEG of up to 2 MB. */
export const POST = route(
  { access: "user" },
  async ({ user, params, request }) => {
    const size = Number(request.headers.get("content-length") ?? 0)
    if (size > MAX_UPLOAD_BYTES + 64 * 1024)
      throw new ApiError(413, "too_large", "A logo can be up to 2 MB.")
    const form = await request.formData().catch(() => {
      throw new ApiError(400, "invalid_form", "Send the logo as form data.")
    })
    const file = form.get("file")
    if (!(file instanceof File))
      throw new ApiError(400, "no_file", "Choose an image for the logo.")
    return saveLogo(params.slug ?? "", user, file)
  }
)

export const DELETE = route({ access: "user" }, ({ user, params }) =>
  removeLogo(params.slug ?? "", user)
)

/** The logo from one of your images (PNG or JPEG). */
export const PUT = route(
  { access: "user", body: z.object({ uploadId: z.uuid() }) },
  ({ user, params, body }) =>
    setLogoFrom(params.slug ?? "", user, body.uploadId)
)
