import type { ReactNode } from "react"

import { AdminShell } from "@/features/admin/components/shell"

// Navigation only. Access is checked in each page and each API route.
export default function AdminLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return <AdminShell>{children}</AdminShell>
}
