import type { Metadata } from "next"

import { AuthCard } from "@/features/auth/components/auth-card"
import { ResetForm } from "@/features/auth/components/password-forms"
import { linkValid } from "@/features/auth/password"

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } }

export default async function Page({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token = "" } = await searchParams
  return (
    <AuthCard title="Choose a new password">
      <ResetForm token={token} valid={token.length > 10 && (await linkValid(token, "reset"))} />
    </AuthCard>
  )
}
