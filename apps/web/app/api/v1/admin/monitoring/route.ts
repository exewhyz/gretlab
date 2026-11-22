import { route } from "@/lib/api/route"
import { monitoring } from "@/features/monitoring/server"

/** The platform's health: queue, judges, email, webhooks, and what's wrong now. */
export const GET = route({ access: "platform.monitoring.view" }, () =>
  monitoring()
)
