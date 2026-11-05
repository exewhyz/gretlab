import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getCurrentUser } from "@/features/auth/current-user"
import { MyLists } from "@/features/catalog/components/lists"

export const metadata: Metadata = {
  title: "My lists",
  robots: { index: false },
}

export default async function ListsPage() {
  if (!(await getCurrentUser())) redirect("/sign-in?callbackUrl=/lists")
  return <MyLists />
}
