import { ApiError, route } from "@/lib/api/route"
import { MAX_UPLOAD_BYTES, saveUpload } from "@/features/uploads/server"

/** Upload an image for markdown (multipart, field "file"). Answers with its URL. */
export const POST = route({ access: "user" }, async ({ user, request }) => {
  const size = Number(request.headers.get("content-length") ?? 0)
  if (size > MAX_UPLOAD_BYTES + 64 * 1024) {
    throw new ApiError(413, "too_large", "Images can be up to 2 MB.")
  }
  const form = await request.formData().catch(() => {
    throw new ApiError(400, "invalid_form", "Send the image as form data.")
  })
  const file = form.get("file")
  if (!(file instanceof File)) {
    throw new ApiError(400, "no_file", "Choose an image to upload.")
  }
  return saveUpload(user, file)
})
