import type { Metadata } from "next"
import Link from "next/link"

import { AuthCard } from "@/features/auth/components/auth-card"
import { ForgotForm } from "@/features/auth/components/password-forms"

export const metadata: Metadata = { title: "Forgot your password", robots: { index: false } }

export default function Page() {
  return (
    <AuthCard title="Forgot your password?" intro="We'll email you a link to choose a new one.">
      <ForgotForm />
      <Link href="/sign-in" className="text-center text-primary hover:underline">
        Back to sign in
      </Link>
    </AuthCard>
  )
}
