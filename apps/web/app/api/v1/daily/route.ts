import { NextResponse } from "next/server"

import { route } from "@/lib/api/route"
import { getDaily } from "@/features/catalog/server"

/**
 * Today's challenge, or a real null on a day without one: route() answers a null with
 * { ok: true }, which pages would take for a challenge.
 */
export const GET = route({ access: "public" }, async ({ user }) => {
  const daily = await getDaily(user)
  return daily ?? NextResponse.json(null, { headers: { "cache-control": "no-store" } })
})
