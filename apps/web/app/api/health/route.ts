import { getDb, sql } from "@workspace/db"
import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

/** For the load balancer: a replica that can't reach the database shouldn't get traffic. */
export async function GET() {
  try {
    await getDb().execute(sql.sql`SELECT 1`)
    return NextResponse.json({ status: "ok" })
  } catch {
    return NextResponse.json({ status: "unavailable" }, { status: 503 })
  }
}
