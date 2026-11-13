import { redirect } from "next/navigation"

import { getCurrentUser } from "@/features/auth/current-user"
import { getSettings } from "@/features/settings/server"

export const dynamic = "force-dynamic"

/** Signed in: your home. Otherwise: practice, or contests when practice is off. */
export default async function HomePage() {
  if (await getCurrentUser()) redirect("/home")
  const settings = await getSettings()
  redirect(settings["practice.enabled"] ? "/problems" : "/contests")
}
