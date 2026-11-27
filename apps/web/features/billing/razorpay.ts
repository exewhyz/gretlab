import { createHmac, timingSafeEqual } from "node:crypto"

/*
 * Razorpay (payments in India: UPI, cards, net banking). Only what GretLab uses: creating an
 * order, and checking the two signatures Razorpay sends back (the checkout's, and a webhook's).
 * RAZORPAY_API_URL points tests at a fake Razorpay (e2e/billing.mjs).
 *
 *   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET   from Razorpay's Dashboard › Account › API keys
 *   RAZORPAY_WEBHOOK_SECRET                the secret given when adding the webhook
 */

const env = () => ({
  keyId: (process.env.RAZORPAY_KEY_ID ?? "").trim(),
  keySecret: (process.env.RAZORPAY_KEY_SECRET ?? "").trim(),
  webhookSecret: (process.env.RAZORPAY_WEBHOOK_SECRET ?? "").trim(),
  api: (process.env.RAZORPAY_API_URL ?? "https://api.razorpay.com").replace(
    /\/+$/,
    ""
  ),
})

/** Whether payments can be taken here (the keys are set). */
export const razorpayReady = () => Boolean(env().keyId && env().keySecret)

/** The public key, for the browser's checkout. */
export const razorpayKeyId = () => env().keyId

/**
 * An order for `paise`, tied to our payment row by its receipt. With `keys`, in an
 * institution's own Razorpay account (its fees); without, in GretLab's (its plans).
 */
export async function createOrder(
  input: {
    paise: number
    receipt: string
    notes: Record<string, string>
  },
  keys?: { keyId: string; keySecret: string }
): Promise<{ id: string }> {
  const { api } = env()
  const { keyId, keySecret } = keys ?? env()
  const res = await fetch(`${api}/v1/orders`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
    },
    body: JSON.stringify({
      amount: input.paise,
      currency: "INR",
      receipt: input.receipt.slice(0, 40),
      notes: input.notes,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const body = (await res.json().catch(() => null)) as {
    id?: string
    error?: { description?: string }
  } | null
  if (!res.ok || !body?.id)
    throw new Error(
      `Razorpay refused the order (${res.status}): ${body?.error?.description ?? "no reason given"}`
    )
  return { id: body.id }
}

function hmacMatches(secret: string, payload: string, signature: string) {
  if (!secret || !signature) return false
  const expected = createHmac("sha256", secret).update(payload).digest("hex")
  const a = Buffer.from(expected)
  const b = Buffer.from(signature.trim())
  return a.length === b.length && timingSafeEqual(a, b)
}

/** The checkout's signature: HMAC-SHA256 of "order_id|payment_id" with the key secret. */
export const paymentSignatureOk = (
  orderId: string,
  paymentId: string,
  signature: string,
  keySecret = env().keySecret
) => hmacMatches(keySecret, `${orderId}|${paymentId}`, signature)

/** A webhook's signature (X-Razorpay-Signature): HMAC-SHA256 of the raw body with the webhook secret. */
export const webhookSignatureOk = (
  rawBody: string,
  signature: string,
  webhookSecret = env().webhookSecret
) => hmacMatches(webhookSecret, rawBody, signature)
