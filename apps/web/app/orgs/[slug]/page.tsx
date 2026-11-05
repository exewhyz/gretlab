import type { Metadata } from "next"

import { PageHeader } from "@/components/page-header"
import { OrgProfileView } from "@/features/orgs/components/public"

export const metadata: Metadata = { title: "Organization" }

export default async function OrgPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <main className="mx-auto max-w-5xl p-4">
        <OrgProfileView slug={slug} />
      </main>
    </div>
  )
}
