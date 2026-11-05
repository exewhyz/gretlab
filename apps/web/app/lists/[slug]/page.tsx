import type { Metadata } from "next"

import { ListView } from "@/features/catalog/components/lists"

export const metadata: Metadata = { title: "List" }

export default async function ListPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <ListView slug={slug} />
}
