import type { Metadata } from "next"

import { ReferralsAdmin } from "@/features/referrals/components/referrals-admin"

export const metadata: Metadata = { title: "Referrals" }

export default function Page() {
  return <ReferralsAdmin />
}
