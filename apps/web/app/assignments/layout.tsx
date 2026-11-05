import type { ReactNode } from "react"

import { PageHeader } from "@/components/page-header"

export default function AssignmentsLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <div className="min-h-dvh">
      <PageHeader />
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </div>
  )
}
