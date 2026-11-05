import type { Metadata } from "next"

import { ContestList } from "@/features/contests/components/contest-list"

export const metadata: Metadata = { title: "Contests" }

export default function ContestsPage() {
  return <ContestList />
}
