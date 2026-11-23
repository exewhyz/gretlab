import { createHash } from "node:crypto"

import { getDb, sql, uploads, type User } from "@workspace/db"

import { isStaff, ApiError, notFound } from "@/lib/api/route"
import {
  hasPublicAddress,
  imageKey,
  publicUrl,
  putFile,
  signedUrl,
  storageReady,
} from "@/lib/storage"
import { teachesAnywhere } from "@/features/teaching/server"

const { and, eq, gte, count } = sql

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024
const IMMUTABLE = "public, max-age=31536000, immutable"
/** The longest R2 (like S3) signs a link for. */
const SIGNED_IMAGE_SECONDS = 7 * 24 * 3_600
const DAILY_LIMIT = 300

/**
 * The image's real type, from its first bytes; the browser's claim isn't trusted. Only
 * raster images: SVG can carry scripts, so it's refused.
 */
function sniff(bytes: Buffer): string | null {
  const starts = (...sig: number[]) => sig.every((b, i) => bytes[i] === b)
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png"
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg"
  if (starts(0x47, 0x49, 0x46, 0x38)) return "image/gif"
  if (
    starts(0x52, 0x49, 0x46, 0x46) &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  )
    return "image/webp"
  return null
}

/** An image for markdown, from someone who writes content: staff, or anyone who teaches. */
export async function saveUpload(user: User, file: File) {
  if (!isStaff(user) && !(await teachesAnywhere(user))) {
    throw new ApiError(
      403,
      "forbidden",
      "Only people who write content can upload images."
    )
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new ApiError(413, "too_large", "Images can be up to 2 MB.")
  }
  const bytes = Buffer.from(await file.arrayBuffer())
  const contentType = sniff(bytes)
  if (!contentType) {
    throw new ApiError(
      415,
      "unsupported_image",
      "Upload a PNG, JPEG, GIF or WebP image."
    )
  }
  const db = getDb()
  const [today] = await db
    .select({ total: count() })
    .from(uploads)
    .where(
      and(
        eq(uploads.uploadedBy, user.id),
        gte(uploads.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
      )
    )
  if ((today?.total ?? 0) >= DAILY_LIMIT) {
    throw new ApiError(
      429,
      "too_many_uploads",
      "That's enough images for today."
    )
  }
  const hash = createHash("sha256").update(bytes).digest("hex")
  // The same image again is the same upload.
  const [same] = await db
    .select({ id: uploads.id })
    .from(uploads)
    .where(eq(uploads.hash, hash))
  if (same) return { id: same.id, url: `/api/v1/uploads/${same.id}` }
  // To R2 when it's set up (lib/storage), so the database keeps only who and what.
  const key = storageReady() ? imageKey(hash, contentType) : null
  if (key) {
    await putFile("public", key, bytes, contentType, {
      cacheControl: IMMUTABLE,
    })
  }
  const [created] = await db
    .insert(uploads)
    .values({
      hash,
      contentType,
      size: bytes.length,
      data: key ? null : bytes,
      storedIn: key ? "r2" : "db",
      key,
      uploadedBy: user.id,
    })
    .onConflictDoNothing({ target: uploads.hash })
    .returning({ id: uploads.id })
  const id =
    created?.id ??
    (
      await db
        .select({ id: uploads.id })
        .from(uploads)
        .where(eq(uploads.hash, hash))
    )[0]!.id
  return { id, url: `/api/v1/uploads/${id}` }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** An uploaded image as a response: never sniffed as anything else, cached for good. */
export async function uploadResponse(id: string) {
  if (!UUID.test(id)) throw notFound("Image not found")
  const [row] = await getDb()
    .select({
      contentType: uploads.contentType,
      data: uploads.data,
      storedIn: uploads.storedIn,
      key: uploads.key,
    })
    .from(uploads)
    .where(eq(uploads.id, id))
  if (!row) throw notFound("Image not found")
  // In R2. The link in a statement never changes; this answers where the image is now.
  if (row.storedIn === "r2" && row.key) {
    // The bucket has its own address (a custom domain): there, for good.
    if (hasPublicAddress())
      return new Response(null, {
        status: 301,
        headers: { Location: publicUrl(row.key), "Cache-Control": IMMUTABLE },
      })
    // No custom domain: a link signed for 7 days; the redirect is cached for a day (by the
    // browser and Vercel's edge), so the link handed out is always days from expiring.
    const link = await signedUrl(
      "public",
      row.key,
      SIGNED_IMAGE_SECONDS,
      row.key.split("/").pop() ?? "image",
      true
    )
    return new Response(null, {
      status: 302,
      headers: {
        Location: link,
        "Cache-Control": "public, max-age=86400, s-maxage=86400",
      },
    })
  }
  const data = row.data ?? Buffer.alloc(0)
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": row.contentType,
      "Content-Length": String(data.length),
      // Its id never points at different bytes.
      "Cache-Control": IMMUTABLE,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Content-Disposition": "inline",
    },
  })
}
