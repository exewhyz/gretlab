import { NextResponse } from "next/server"

import { toolJwks } from "@/features/lti/jwt"

/** Gretlab's public keys, for LMSs to check what it signs (grades, deep links). */
export async function GET() {
  return NextResponse.json(await toolJwks(), { headers: { "cache-control": "public, max-age=300" } })
}
