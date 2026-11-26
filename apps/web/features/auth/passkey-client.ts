"use client"

import {
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser"
import { signIn } from "next-auth/react"

import { api } from "@/lib/api/client"

import { sendSecondStep, STEP_MESSAGES, type StepProblem } from "./session-step"

/*
 * The browser's side of passkeys (features/auth/passkeys.ts): ask the server for options, let
 * the device make or use the passkey, and send the answer back. Every check is on the server.
 */

// Typed with the library's own JSON shapes (ApiResult's conversion doesn't fit its binary
// extension fields): authenticationOptions and registrationOptions in passkeys.ts.
type AuthOptions = {
  options: PublicKeyCredentialRequestOptionsJSON
  challengeId: string
}
type RegisterOptions = {
  options: PublicKeyCredentialCreationOptionsJSON
  challengeId: string
  backupCodes: string[] | null
}

/** The device's own prompt, cancelled or refused: not an error worth more than a line. */
const cancelled = (error: unknown) =>
  error instanceof Error &&
  (error.name === "NotAllowedError" || error.name === "AbortError")

/**
 * The second step (`step`) or confirming a protected action (`stepUp`) with a passkey. Answers
 * what to tell the person when it didn't work (the server's own words when it said why), or null.
 */
export async function passkeySecondStep(
  kind: "step" | "stepUp"
): Promise<string | null> {
  let options: AuthOptions
  try {
    options = await api<AuthOptions>(
      kind === "step"
        ? "/auth/two-factor/passkey"
        : "/me/security/passkeys/options",
      { method: "POST" }
    )
  } catch (error) {
    return error instanceof Error && error.message
      ? error.message
      : STEP_MESSAGES.failed
  }
  let response
  try {
    response = await startAuthentication({ optionsJSON: options.options })
  } catch (error) {
    if (cancelled(error)) return STEP_MESSAGES.cancelled
    // The browser's own reason (no passkey for this site here, a security error), not a guess.
    return error instanceof Error && error.message
      ? `Your device couldn't use a passkey: ${error.message}`
      : STEP_MESSAGES.bad_passkey
  }
  const answer = { challengeId: options.challengeId, response }
  const problem = await sendSecondStep(
    kind === "step" ? { passkeyStep: answer } : { passkeyStepUp: answer }
  )
  return problem ? STEP_MESSAGES[problem] : null
}

/** Signing in with a passkey alone. Answers the reason it didn't, or null when signed in. */
export async function signInWithPasskey(): Promise<string | null> {
  let options: AuthOptions
  try {
    options = await api<AuthOptions>("/auth/passkey", { method: "POST" })
  } catch (error) {
    return (error as Error).message
  }
  let response
  try {
    response = await startAuthentication({ optionsJSON: options.options })
  } catch (error) {
    return cancelled(error) ? "cancelled" : "bad_passkey"
  }
  const result = await signIn("passkey", {
    challengeId: options.challengeId,
    response: JSON.stringify(response),
    redirect: false,
  })
  return result?.ok && !result.error ? null : (result?.error ?? "bad_passkey")
}

/** Adds a passkey on this device. Backup codes come back when it's the first method. */
export async function addPasskey(
  name: string
): Promise<{ problem: StepProblem | null; backupCodes: string[] | null }> {
  let options: RegisterOptions
  try {
    options = await api<RegisterOptions>("/me/security/passkeys", {
      method: "POST",
    })
  } catch {
    return { problem: "failed", backupCodes: null }
  }
  let response
  try {
    response = await startRegistration({ optionsJSON: options.options })
  } catch (error) {
    return {
      problem: cancelled(error) ? "cancelled" : "bad_passkey",
      backupCodes: null,
    }
  }
  const problem = await sendSecondStep({
    registerPasskey: { challengeId: options.challengeId, name, response },
  })
  return { problem, backupCodes: problem ? null : options.backupCodes }
}
