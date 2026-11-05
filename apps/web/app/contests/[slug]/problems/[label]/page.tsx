import type { Metadata } from "next"

import { ContestWorkbench } from "@/features/contests/components/contest-workbench"

export const metadata: Metadata = {
  title: "Contest problem",
  robots: { index: false },
}

export default async function ContestProblemPage({
  params,
}: {
  params: Promise<{ slug: string; label: string }>
}) {
  const { slug, label } = await params
  return <ContestWorkbench slug={slug} label={label} />
}
