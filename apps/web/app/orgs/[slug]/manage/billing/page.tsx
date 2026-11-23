import type { Metadata } from "next"

import { PlanAndBilling } from "@/features/billing/components/plan-page"

export const metadata: Metadata = {
  title: "Plan and billing",
  robots: { index: false },
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <PlanAndBilling slug={slug} />
}
