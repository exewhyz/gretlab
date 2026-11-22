import type { Metadata } from "next"

import { CostsPage } from "@/features/costs/components/costs-page"

export const metadata: Metadata = { title: "Costs" }

export default function Page() {
  return <CostsPage />
}
