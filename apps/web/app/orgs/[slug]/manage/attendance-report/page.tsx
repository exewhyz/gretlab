import { AttendanceReport } from "@/features/attendance/components/attendance"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <AttendanceReport slug={slug} />
}
