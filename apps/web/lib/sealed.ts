import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto"

/*
 * Small secrets at rest (students' phone, date of birth and address): AES-256-GCM under a
 * key derived from NEXTAUTH_SECRET for one purpose, so a key for one use never opens
 * another. Changing NEXTAUTH_SECRET makes sealed values unreadable.
 */

function key(purpose: string) {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error("NEXTAUTH_SECRET is needed to seal data")
  return Buffer.from(hkdfSync("sha256", secret, "gretlab", purpose, 32))
}

export function seal(purpose: string, plain: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", key(purpose), iv)
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  return [
    "v1",
    iv.toString("base64"),
    cipher.getAuthTag().toString("base64"),
    body.toString("base64"),
  ].join(":")
}

/** The plain value, or null when there's none or it can't be opened. */
export function unseal(purpose: string, sealed: string | null | undefined) {
  if (!sealed) return null
  const [version, iv, tag, body] = sealed.split(":")
  if (version !== "v1" || !iv || !tag || !body) return null
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key(purpose),
      Buffer.from(iv, "base64")
    )
    decipher.setAuthTag(Buffer.from(tag, "base64"))
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64")),
      decipher.final(),
    ]).toString("utf8")
  } catch {
    return null
  }
}
