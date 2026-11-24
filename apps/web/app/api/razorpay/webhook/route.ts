import { NextResponse, type NextRequest } from "next/server"

import { applyPayment } from "@/features/billing/pay"
import { webhookSignatureOk } from "@/features/billing/razorpay"
import { reportError } from "@/lib/report-error"

export const dynamic = "force-dynamic"

/*
 * Razorpay's webhook (Dashboard › Webhooks: this address, the events payment.captured and
 * order.paid, and RAZORPAY_WEBHOOK_SECRET): applies a payment even when the person closed the
 * tab before the checkout answered. A plain handler, not route(): Razorpay's cross-site POST and
 * its signature over the raw body need it. Applying twice does nothing the second time.
 */
export async function POST(request: NextRequest) {
  const raw = await request.text()
  if (
    !webhookSignatureOk(raw, request.headers.get("x-razorpay-signature") ?? "")
  )
    return NextResponse.json({ error: "bad_signature" }, { status: 400 })
  try {
    const event = JSON.parse(raw) as {
      event?: string
      payload?: {
        payment?: {
          entity?: { id?: string; order_id?: string; status?: string }
        }
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
      await applyPayment(orderId, payment.id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    // Razorpay retries what doesn't answer 2xx.
    return NextResponse.json(
      {
        error: "failed",
        ref: reportError(error, { where: "razorpay webhook" }),
      },
      { status: 500 }
    )
  }
}
