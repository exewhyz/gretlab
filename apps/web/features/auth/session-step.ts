"use client"

import { getCsrfToken } from "next-auth/react"

/**
 * Sends a code to the session's update (POST /api/auth/session), where the jwt callback
 * (features/auth/options.ts) checks it on the server. Answers with the reason it was
 * refused, or null when the session has passed.
 */
export async function sendSecondStep(
  data:
    | { secondStep: string }
    | { stepUp: string }
    | { confirmApp: string }
    | { confirmEmail: string }
    | { passkeyStep: unknown }
    | { passkeyStepUp: unknown }
    | { registerPasskey: unknown }
): Promise<StepProblem | null> {
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
  if (!error) return null
  return error in STEP_MESSAGES ? (error as StepProblem) : "failed"
}

export type StepProblem = keyof typeof STEP_MESSAGES

export const STEP_MESSAGES = {
  wrong_code: "That code isn't right. Check the app and try again.",
  locked: "Too many wrong codes. Try again in 15 minutes.",
  not_set_up: "Two-factor sign-in isn't set up. Start again.",
  expired: "That code has expired. Ask for a new one.",
  failed: "Something went wrong. Please try again.",
  bad_passkey: "That passkey didn't work. Try again, or use another way.",
  bad_challenge: "That took too long. Try again.",
  cloned_passkey: "That passkey looks copied. Remove it and add it again.",
  already_added: "That passkey is already added.",
  too_many: "You have the most passkeys allowed. Remove one first.",
  step_up_required: "Confirm it's you first (with a code or another passkey), then add it.",
  cancelled: "The passkey was cancelled.",
} as const
