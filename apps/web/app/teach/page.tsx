import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { getCurrentUser } from "@/features/auth/current-user"
import { TeacherHome } from "@/features/teaching/components/teaching"

export const metadata: Metadata = { title: "Teach", robots: { index: false } }

export default async function TeachPage() {
  if (!(await getCurrentUser())) redirect("/sign-in?callbackUrl=/teach")
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <main className="mx-auto max-w-5xl p-4">
        <TeacherHome />
      </main>
    </div>
  )
}
