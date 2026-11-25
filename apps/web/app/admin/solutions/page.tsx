import type { Metadata } from "next"

import { SolutionModeration } from "@/features/solutions/components/moderation"

export const metadata: Metadata = { title: "Solution posts" }

export default function Page() {
  return <SolutionModeration />
}
