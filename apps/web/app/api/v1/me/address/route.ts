import { addressSourceNow, clientIp } from "@/lib/api/client-ip"
import { route } from "@/lib/api/route"

/**
 * The address this server sees for the caller, and what vouches for it, so a teacher
 * setting an exam's lab networks can check them (and an operator can check a new host).
 */
export const GET = route({ access: "user" }, async ({ request }) => ({
  address: clientIp(request),
  source: addressSourceNow(),
}))
