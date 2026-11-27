import type { Metadata } from "next"
import type { ReactNode } from "react"

import { AdminShell } from "@/features/admin/components/shell"

// Every dashboard page is private: search engines are told not to index it (a page's own
// metadata sets its title and keeps this).
export const metadata: Metadata = { robots: { index: false, follow: true } }

// Navigation only. Access is checked in each page and each API route.
export default function AdminLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return <AdminShell>{children}</AdminShell>
}
