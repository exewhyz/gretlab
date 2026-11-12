import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { getCurrentUser } from "@/features/auth/current-user"
import { SchoolSignup } from "@/features/orgs/components/signup"

export const metadata: Metadata = { title: "Register your school" }

/** Registering a school, college or cohort, when the platform allows it. */
export default async function Page() {
  if (!(await getCurrentUser())) redirect("/sign-in?callbackUrl=/schools/new")
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <main className="mx-auto max-w-3xl p-4">
        <SchoolSignup />
      </main>
    </div>
  )
}
