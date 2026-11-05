import { redirect } from "next/navigation"

import { getSettings } from "@/features/settings/server"

export const dynamic = "force-dynamic"

export default async function HomePage() {
  const settings = await getSettings()
  redirect(settings["practice.enabled"] ? "/problems" : "/contests")
}
