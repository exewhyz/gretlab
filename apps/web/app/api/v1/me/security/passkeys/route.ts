import { route } from "@/lib/api/route"
import { listPasskeys, registrationOptions } from "@/features/auth/passkeys"

/** Your passkeys. */
export const GET = route(
  { access: "user", beforeTwoFactor: true },
  ({ user }) => listPasskeys(user)
)

/**
 * Starts adding a passkey: the options for the browser and a challenge. It's finished through
 * the session update (features/auth/options.ts), so a first passkey's session passes at once.
 * With two-factor already on it's a protected action, asked before the device makes anything
 * (the browser's step-up dialog), so a passkey is never made only to be refused.
 */
export const POST = route(
  { access: "user", beforeTwoFactor: true, stepUp: true },
  ({ user }) => registrationOptions(user)
)
