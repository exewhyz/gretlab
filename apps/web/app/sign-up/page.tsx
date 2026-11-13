import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AuthCard } from "@/features/auth/components/auth-card"
import { SignUpForm } from "@/features/auth/components/password-forms"
import { readSession } from "@/features/auth/current-user"

export const metadata: Metadata = { title: "Create an account", robots: { index: false } }

const safePath = (path: string | undefined) => (path?.startsWith("/") && !path.startsWith("//") ? path : "/")

export default async function Page({ searchParams }: { searchParams: Promise<{ callbackUrl?: string }> }) {
  const { callbackUrl } = await searchParams
  const session = await readSession()
  if (session.user) redirect(safePath(callbackUrl))
  return (
    <AuthCard title="Create an account" intro="Practise, submit solutions and join your school or club.">
      <SignUpForm next={safePath(callbackUrl)} />
    </AuthCard>
  )
}
