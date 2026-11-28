import { createHmac, timingSafeEqual } from "node:crypto"

/*
 * Twilio's request signature (server-only: it uses node:crypto, so it's its own entry point,
 * @workspace/judge/twilio). For a form POST: the full URL Twilio called, then each parameter's
 * name and value sorted by name (case-sensitive), HMAC-SHA1 with the account's auth token,
 * Base64. Tested against the example in Twilio's security docs.
 */

export function twilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>
) {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((key) => key + params[key])
      .join("")
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64")
}

/** Whether X-Twilio-Signature matches, compared in constant time. */
export function checkTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string
) {
  if (!signature) return false
  const expected = Buffer.from(twilioSignature(authToken, url, params))
  const given = Buffer.from(signature)
  return expected.length === given.length && timingSafeEqual(expected, given)
}
