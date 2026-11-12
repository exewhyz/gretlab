import { ManageLibrary } from "@/features/books/components/library"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <ManageLibrary slug={slug} />
}
