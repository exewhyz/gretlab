import type { Metadata } from "next"

import { AuthCard } from "@/features/auth/components/auth-card"
import { ConfirmEmail } from "@/features/auth/components/password-forms"
import { linkValid } from "@/features/auth/password"

export const metadata: Metadata = { title: "Confirm your email", robots: { index: false } }

/** From the sign-up email. Confirming takes a button press, so mail scanners can't use the link up. */
export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams
  return (
    <AuthCard title="Confirm your email">
      <ConfirmEmail token={token} valid={token.length > 10 && (await linkValid(token, "verify"))} />
    </AuthCard>
  )
}
