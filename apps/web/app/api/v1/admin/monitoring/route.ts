import { after } from "next/server"

import { route } from "@/lib/api/route"
import { checkAlerts, recentAlerts } from "@/features/monitoring/alerts"
import { monitoring } from "@/features/monitoring/server"

/**
 * The platform's health: queue, judges, email, webhooks, what's wrong now, and the alerts.
 * Opening it also checks for alerts (after answering, at most once a minute per server).
 */
export const GET = route({ access: "platform.monitoring.view" }, async () => {
  after(() => checkAlerts())
  const [health, alerts] = await Promise.all([monitoring(), recentAlerts()])
  return { ...health, alerts }
})
