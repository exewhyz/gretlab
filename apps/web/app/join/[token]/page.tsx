import type { Metadata } from "next"

import { PageHeader } from "@/components/page-header"
import { JoinInvite } from "@/features/orgs/components/public"

export const metadata: Metadata = {
  title: "Invitation",
  robots: { index: false },
}

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <main className="p-4">
        <JoinInvite token={token} />
      </main>
    </div>
  )
}
