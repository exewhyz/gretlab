import { getDb, sql, users, type User } from "@workspace/db"
import { getServerSession } from "next-auth"
import { redirect } from "next/navigation"

import { authOptions } from "./options"

/**
 * The signed-in user, read from the database on every call, so a role change or
 * disabled account takes effect immediately rather than when the cookie expires.
 */
export async function getCurrentUser(): Promise<User | null> {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return null
  const [user] = await getDb()
    .select()
    .from(users)
    .where(sql.eq(users.email, email.toLowerCase()))
  return user && !user.disabled ? user : null
}

/** For pages. Call at the top of the page, not in a layout: layouts don't re-run on navigation. */
export async function requireStaffPage(callbackPath: string): Promise<User> {
  const user = await getCurrentUser()
  if (user?.role !== "teacher" && user?.role !== "admin") {
    redirect(`/sign-in?callbackUrl=${encodeURIComponent(callbackPath)}`)
  }
  return user
}
