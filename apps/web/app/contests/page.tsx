import type { Metadata } from "next"

import { ContestList } from "@/features/contests/components/contest-list"
import { pageMetadata } from "@/lib/seo/metadata"

// Title and description: lib/seo/config.ts.
export const generateMetadata = (): Promise<Metadata> => pageMetadata("contests")

export default function ContestsPage() {
  return <ContestList />
}
