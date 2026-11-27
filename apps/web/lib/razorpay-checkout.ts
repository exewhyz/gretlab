"use client"

/* Razorpay's checkout in the browser, shared by GretLab's plans and institutions' fees. */

export interface RazorpayAnswer {
  razorpay_order_id: string
  razorpay_payment_id: string
  razorpay_signature: string
}
export type RazorpayCheckout = new (options: Record<string, unknown>) => {
  open(): void
  on(event: string, f: (e: { error?: { description?: string } }) => void): void
}

/** Razorpay's checkout script, loaded once, when someone pays. */
export function loadRazorpay(): Promise<RazorpayCheckout> {
  const w = window as unknown as { Razorpay?: RazorpayCheckout }
  if (w.Razorpay) return Promise.resolve(w.Razorpay)
  return new Promise((resolve, reject) => {
    const script = document.createElement("script")
    script.src = "https://checkout.razorpay.com/v1/checkout.js"
    script.onload = () =>
      w.Razorpay
        ? resolve(w.Razorpay)
        : reject(new Error("Razorpay didn't load."))
    script.onerror = () =>
      reject(
        new Error(
          "Razorpay's checkout couldn't load. Check the connection and try again."
        )
      )
    document.body.appendChild(script)
  })
}
