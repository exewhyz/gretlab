import type { Metadata } from "next"

import { PlansAdmin } from "@/features/billing/components/plans-admin"

export const metadata: Metadata = { title: "Plans" }

export default function Page() {
  return <PlansAdmin />
}
