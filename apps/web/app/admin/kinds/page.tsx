import type { Metadata } from "next"

import { AdminKinds } from "@/features/admin/components/kinds"

export const metadata: Metadata = { title: "Organization kinds" }

export default function Page() {
  return <AdminKinds />
}
