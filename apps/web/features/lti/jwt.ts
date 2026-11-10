import { createPublicKey, createSign, createVerify, generateKeyPairSync, randomUUID, type JsonWebKey } from "node:crypto"

import { getDb, ltiKeys, sql } from "@workspace/db"

/*
 * The JWTs LTI needs, with Node's crypto: RS256 only. Verifying takes the LMS's published
 * keys (JWKS); signing uses Gretlab's own key, made on first use and published at
 * /api/v1/lti/jwks. LTI_PRIVATE_KEY (PEM) with LTI_KEY_ID replaces the stored key.
 */

const b64 = (data: Buffer | string) => Buffer.from(data).toString("base64url")
const json64 = (value: unknown) => b64(JSON.stringify(value))

export function decodeJwt(token: string) {
  const parts = token.split(".")
  if (parts.length !== 3) return null
  try {
    return {
      header: JSON.parse(Buffer.from(parts[0]!, "base64url").toString()) as { alg?: string; kid?: string },
      payload: JSON.parse(Buffer.from(parts[1]!, "base64url").toString()) as Record<string, unknown>,
      signed: `${parts[0]}.${parts[1]}`,
      signature: Buffer.from(parts[2]!, "base64url"),
    }
  } catch {
    return null
  }
}

/** The payload, when the signature is RS256 from one of these keys; null otherwise. */
export function verifyJwt(token: string, keys: JsonWebKey[]) {
  const parts = decodeJwt(token)
  if (!parts || parts.header.alg !== "RS256") return null
  const candidates = parts.header.kid ? keys.filter((k) => k.kid === parts.header.kid) : keys
  for (const jwk of candidates) {
    if (jwk.kty !== "RSA") continue
    try {
      const key = createPublicKey({ key: jwk, format: "jwk" })
      const ok = createVerify("RSA-SHA256").update(parts.signed).verify(key, parts.signature)
      if (ok) return parts.payload
    } catch {
      continue
    }
  }
  return null
}

export function signJwt(payload: Record<string, unknown>, privateKey: string, kid: string) {
  const head = json64({ alg: "RS256", typ: "JWT", kid })
  const body = json64(payload)
  const signature = createSign("RSA-SHA256").update(`${head}.${body}`).sign(privateKey)
  return `${head}.${body}.${b64(signature)}`
}

/** Gretlab's signing key: from the environment, or made once and kept in the database. */
export async function toolKey(): Promise<{ kid: string; privateKey: string; publicJwk: JsonWebKey }> {
  if (process.env.LTI_PRIVATE_KEY) {
    const privateKey = process.env.LTI_PRIVATE_KEY.replace(/\\n/g, "\n")
    const kid = process.env.LTI_KEY_ID ?? "gretlab-env"
    const publicJwk = createPublicKey(privateKey).export({ format: "jwk" })
    return { kid, privateKey, publicJwk: { ...publicJwk, kid, alg: "RS256", use: "sig" } }
  }
  const db = getDb()
  const [existing] = await db.select().from(ltiKeys).orderBy(sql.asc(ltiKeys.createdAt)).limit(1)
  if (existing) return { kid: existing.kid, privateKey: existing.privateKey, publicJwk: existing.publicJwk }
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 })
  const kid = randomUUID()
  const publicJwk = { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" } as Record<string, string>
  const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString()
  // Two first requests at once: one key wins, both use it.
  await db.insert(ltiKeys).values({ kid, privateKey: pem, publicJwk }).onConflictDoNothing()
  const [kept] = await db.select().from(ltiKeys).orderBy(sql.asc(ltiKeys.createdAt)).limit(1)
  return { kid: kept!.kid, privateKey: kept!.privateKey, publicJwk: kept!.publicJwk }
}

export async function toolJwks() {
  return { keys: [(await toolKey()).publicJwk] }
}
