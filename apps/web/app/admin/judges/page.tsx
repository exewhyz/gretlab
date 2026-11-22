import type { Metadata } from "next"

import { JudgesPage } from "@/features/judges/components/judges-page"

export const metadata: Metadata = { title: "Judges" }

export default function Page() {
  return <JudgesPage />
}
