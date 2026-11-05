import type { Metadata } from "next"

import { ContestDetail } from "@/features/contests/components/contest-detail"

export const metadata: Metadata = { title: "Contest" }

export default async function ContestPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <ContestDetail slug={slug} />
}
