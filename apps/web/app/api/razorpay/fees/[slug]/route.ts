import { NextResponse, type NextRequest } from "next/server"

import { applyOnlinePayment, feeWebhookSecret } from "@/features/fees/online"
import { webhookSignatureOk } from "@/features/billing/razorpay"
import { reportError } from "@/lib/report-error"

export const dynamic = "force-dynamic"

/*
 * An institution's own Razorpay webhook for its fees (its Dashboard › Webhooks: this address,
 * payment.captured and order.paid, and the webhook secret it saved in Fees › Setup). Applies a
 * payment even if the person closed the tab before the checkout answered. A plain handler:
 * Razorpay's cross-site POST and its signature over the raw body need it.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  const raw = await request.text()
  const hook = await feeWebhookSecret(slug)
  if (
    !hook ||
    !webhookSignatureOk(
      raw,
      request.headers.get("x-razorpay-signature") ?? "",
      hook.secret
    )
  )
    return NextResponse.json({ error: "bad_signature" }, { status: 400 })
  try {
    const event = JSON.parse(raw) as {
      event?: string
      payload?: {
        payment?: { entity?: { id?: string; order_id?: string } }
        order?: { entity?: { id?: string } }
      }
    }
    const payment = event.payload?.payment?.entity
    const orderId = payment?.order_id ?? event.payload?.order?.entity?.id
    if (
      (event.event === "payment.captured" || event.event === "order.paid") &&
      orderId &&
      payment?.id
    )
      await applyOnlinePayment(hook.orgId, orderId, payment.id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { error: "failed", ref: reportError(error, { where: "fees webhook" }) },
      { status: 500 }
    )
  }
}
