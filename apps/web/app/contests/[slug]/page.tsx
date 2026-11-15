import type { Metadata } from "next"

import { ContestDetail } from "@/features/contests/components/contest-detail"
import { privateMetadata } from "@/lib/seo/metadata"

// Contests are time-bound, and an organization's answer "not found" to outsiders: kept out of
// search results (the contests list is indexed instead).
export const metadata: Metadata = privateMetadata("Contest")

export default async function ContestPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <ContestDetail slug={slug} />
}
