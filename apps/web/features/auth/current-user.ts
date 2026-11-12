import { getDb, sql, twoFactor, users, type User } from "@workspace/db"
import { getServerSession } from "next-auth"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { platformAccess } from "@/features/platform/access"

import { authOptions } from "./options"
import { TRUST_COOKIE, trusted } from "./two-factor"

export interface SessionState {
  /** Signed in, past the second step if they use one. */
  user: User | null
  /** Signed in with Google but still owes the second step (features/auth/two-factor.ts). */
  pending: User | null
  /** Whether the signed-in person uses two-factor sign-in. */
  twoFactor: boolean
}

const NOBODY: SessionState = { user: null, pending: null, twoFactor: false }

/**
 * Who the session belongs to, read from the database on every call, so a role change,
 * a blocked account or two-factor turned on takes effect at once rather than when the
 * cookie expires. Someone with two-factor on counts as signed in only if their session
 * passed the second step since it was turned on, or their browser is trusted for it.
 */
export async function readSession(): Promise<SessionState> {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return NOBODY
  const [row] = await getDb()
    .select({
      user: users,
      enabledAt: twoFactor.enabledAt,
      trustVersion: twoFactor.trustVersion,
    })
    .from(users)
    .leftJoin(twoFactor, sql.eq(twoFactor.userId, users.id))
    .where(sql.eq(users.email, email.toLowerCase()))
  if (!row || row.user.disabled) return NOBODY
  if (!row.enabledAt) return { user: row.user, pending: null, twoFactor: false }
  const mfaAt = (session as { mfaAt?: unknown }).mfaAt
  const passed =
    (typeof mfaAt === "number" && mfaAt >= row.enabledAt.getTime()) ||
    // A browser they chose to trust for 30 days.
    trusted((await cookies()).get(TRUST_COOKIE)?.value, row.user, {
      enabledAt: row.enabledAt,
      trustVersion: row.trustVersion ?? 0,
    })
  return passed
    ? { user: row.user, pending: null, twoFactor: true }
    : { user: null, pending: row.user, twoFactor: true }
}

/** The signed-in user, or null (including while the second step is owed). */
export async function getCurrentUser(): Promise<User | null> {
  return (await readSession()).user
}

/** For pages. Call at the top of the page, not in a layout: layouts don't re-run on navigation. */
export async function requireStaffPage(callbackPath: string): Promise<User> {
  const user = await getCurrentUser()
  // Anyone with a platform role; each page's data is checked against its own permission.
  if (!user || (await platformAccess(user)).permissions.length === 0) {
    redirect(`/sign-in?callbackUrl=${encodeURIComponent(callbackPath)}`)
  }
  return user
}
