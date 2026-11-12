import { StaffAttendance } from "@/features/staff-attendance/components/staff-attendance"

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  return <StaffAttendance slug={slug} />
}
