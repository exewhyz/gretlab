"use client"

import { getCsrfToken } from "next-auth/react"

/**
 * Sends a code to the session's update (POST /api/auth/session), where the jwt callback
 * (features/auth/options.ts) checks it on the server. Answers with the reason it was
 * refused, or null when the session has passed.
 */
export async function sendSecondStep(
  data:
    { secondStep: string } | { confirmApp: string } | { confirmEmail: string }
): Promise<
  "wrong_code" | "locked" | "not_set_up" | "expired" | "failed" | null
> {
  const csrfToken = await getCsrfToken()
  const res = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ csrfToken, data }),
  })
  if (!res.ok) return "failed"
  const session = (await res.json().catch(() => null)) as {
    mfaError?: string | null
  } | null
  const error = session?.mfaError
  return error === "wrong_code" || error === "locked" || error === "not_set_up"
    ? error
    : null
}

export const STEP_MESSAGES = {
  wrong_code: "That code isn't right. Check the app and try again.",
  locked: "Too many wrong codes. Try again in 15 minutes.",
  not_set_up: "Two-factor sign-in isn't set up. Start again.",
  expired: "That code has expired. Ask for a new one.",
  failed: "Something went wrong. Please try again.",
} as const
