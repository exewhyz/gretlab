import type { Metadata } from "next"

import { requireStaffPage } from "@/features/auth/current-user"
import { PolicyEditor } from "@/features/notifications/components/policy-editor"

export const metadata: Metadata = {
  title: "Notifications",
  robots: { index: false },
}

export default async function Page() {
  await requireStaffPage("/admin/notifications")
  return (
    <PolicyEditor
      path="/admin/notifications"
      queryKey={["admin", "notifications"]}
      level="platform"
    />
  )
}
