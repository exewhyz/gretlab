import type { Metadata } from "next"

import { AdminEmails } from "@/features/emails/components/emails"

export const metadata: Metadata = { title: "Emails" }

export default function Page() {
  return <AdminEmails />
}
