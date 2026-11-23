import * as S3 from "@aws-sdk/client-s3"
import * as Presigner from "@aws-sdk/s3-request-presigner"

/*
 * Where files live: Cloudflare R2 (S3-compatible) when it's configured, so the database keeps
 * only who and what. Two buckets:
 *   - public:  images in problem statements and the like: served from their own address when
 *              the bucket has one (R2_PUBLIC_URL, a custom domain, cached by Cloudflare), else
 *              through links signed for 7 days that the image's address redirects to (the
 *              redirect cached a day at Vercel's edge), so nothing about the domain changes;
 *   - private: exports and import reports, never public, reached through links signed for
 *              minutes after the same access check as the page.
 * Without R2 settings, `storageReady()` is false and callers keep files in Postgres as before
 * (local development, a fresh install). Tests run MinIO (STORAGE_ENDPOINT).
 *
 * The SDK is typed through the small interface below: its own types describe all of S3 and
 * slow every typecheck (as EC2's did, AGENTS.md › Large SDK types).
 */

type Bucket = "public" | "private"

interface S3Command {
  readonly _command: unique symbol
}
interface S3Sdk {
  S3Client: new (config: {
    region: string
    endpoint: string
    forcePathStyle?: boolean
    credentials: { accessKeyId: string; secretAccessKey: string }
  }) => { send(command: S3Command): Promise<unknown> }
  PutObjectCommand: new (input: {
    Bucket: string
    Key: string
    Body: Uint8Array
    ContentType: string
    CacheControl?: string
    ContentDisposition?: string
  }) => S3Command
  GetObjectCommand: new (input: {
    Bucket: string
    Key: string
    ResponseContentDisposition?: string
  }) => S3Command
  DeleteObjectCommand: new (input: { Bucket: string; Key: string }) => S3Command
}
interface PresignerSdk {
  getSignedUrl(
    client: InstanceType<S3Sdk["S3Client"]>,
    command: S3Command,
    options: { expiresIn: number }
  ): Promise<string>
}
const s3 = S3 as unknown as S3Sdk
const presigner = Presigner as unknown as PresignerSdk

function settings() {
  const env = process.env
  const endpoint =
    env.STORAGE_ENDPOINT?.trim() ||
    (env.R2_ACCOUNT_ID?.trim()
      ? `https://${env.R2_ACCOUNT_ID.trim()}.r2.cloudflarestorage.com`
      : "")
  return {
    endpoint,
    accessKeyId: env.R2_ACCESS_KEY_ID?.trim() ?? "",
    secretAccessKey: env.R2_SECRET_ACCESS_KEY?.trim() ?? "",
    buckets: {
      public: env.R2_PUBLIC_BUCKET?.trim() ?? "",
      private: env.R2_PRIVATE_BUCKET?.trim() ?? "",
    } satisfies Record<Bucket, string>,
    publicUrl: (env.R2_PUBLIC_URL ?? "").trim().replace(/\/+$/, ""),
    // MinIO addresses buckets by path; R2 accepts either.
    pathStyle: Boolean(env.STORAGE_ENDPOINT?.trim()),
  }
}

/** Whether files go to R2: every setting is there. */
export function storageReady() {
  const s = settings()
  return Boolean(
    s.endpoint &&
    s.accessKeyId &&
    s.secretAccessKey &&
    s.buckets.public &&
    s.buckets.private
  )
}

/**
 * Whether the public bucket has its own address (R2_PUBLIC_URL: a custom domain, which needs
 * the domain's DNS on Cloudflare). Without one, images are reached through signed links too.
 */
export function hasPublicAddress() {
  return Boolean(settings().publicUrl)
}

let client: InstanceType<S3Sdk["S3Client"]> | null = null
function connect() {
  const s = settings()
  client ??= new s3.S3Client({
    region: "auto",
    endpoint: s.endpoint,
    forcePathStyle: s.pathStyle,
    credentials: {
      accessKeyId: s.accessKeyId,
      secretAccessKey: s.secretAccessKey,
    },
  })
  return { client, s }
}

export async function putFile(
  bucket: Bucket,
  key: string,
  bytes: Uint8Array,
  contentType: string,
  options: { cacheControl?: string; disposition?: string } = {}
) {
  const { client, s } = connect()
  await client.send(
    new s3.PutObjectCommand({
      Bucket: s.buckets[bucket],
      Key: key,
      Body: bytes,
      ContentType: contentType,
      CacheControl: options.cacheControl,
      ContentDisposition: options.disposition,
    })
  )
}

export async function removeFile(bucket: Bucket, key: string) {
  const { client, s } = connect()
  await client.send(
    new s3.DeleteObjectCommand({ Bucket: s.buckets[bucket], Key: key })
  )
}

/**
 * A link to a file that works for `seconds`: downloading under `filename`, or shown in the page
 * (`inline`, for images).
 */
export async function signedUrl(
  bucket: Bucket,
  key: string,
  seconds: number,
  filename: string,
  inline = false
) {
  const { client, s } = connect()
  const name = filename.replace(/[^\w.-]/g, "_")
  return presigner.getSignedUrl(
    client,
    new s3.GetObjectCommand({
      Bucket: s.buckets[bucket],
      Key: key,
      ResponseContentDisposition: `${inline ? "inline" : "attachment"}; filename="${name}"`,
    }),
    { expiresIn: seconds }
  )
}

/** A public file's address on the files domain. */
export function publicUrl(key: string) {
  return `${settings().publicUrl}/${key}`
}

/** An image's key: its hash, so the same image is one object. */
export function imageKey(hash: string, contentType: string) {
  const ext =
    {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/gif": "gif",
      "image/webp": "webp",
    }[contentType] ?? "bin"
  return `images/${hash}.${ext}`
}
