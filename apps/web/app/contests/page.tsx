import type { Metadata } from "next"

import { ContestList } from "@/features/contests/components/contest-list"

export const metadata: Metadata = {
  title: "Coding contests",
  description:
    "Timed programming contests with ICPC or IOI scoring and a live scoreboard. Register, solve in Python, JavaScript, C, C++ or Java, and see how you rank.",
  alternates: { canonical: "/contests" },
}

export default function ContestsPage() {
  return <ContestList />
}
