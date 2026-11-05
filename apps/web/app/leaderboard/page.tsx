import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { PageHeader } from "@/components/page-header"
import { getCurrentUser } from "@/features/auth/current-user"
import { GlobalLeaderboard } from "@/features/catalog/components/profile"

export const metadata: Metadata = {
  title: "Leaderboard",
  robots: { index: false },
}

export default async function LeaderboardPage() {
  if (!(await getCurrentUser())) redirect("/sign-in?callbackUrl=/leaderboard")
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <main className="mx-auto max-w-5xl p-4">
        <GlobalLeaderboard />
      </main>
    </div>
  )
}
