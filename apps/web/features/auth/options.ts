import { getDb, sql, users } from "@workspace/db"
import { emailDomainAllowed } from "@workspace/judge"
import type { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import GoogleProvider, { type GoogleProfile } from "next-auth/providers/google"

import { freeHandle } from "@/features/catalog/server"
import { getSettings } from "@/features/settings/server"
import { isAdminEmail } from "@/lib/admin-emails"


/** Sign in as anyone without a password, so never available in a production build. */
export const DEV_LOGIN_ENABLED =
  process.env.NODE_ENV !== "production" && process.env.AUTH_DEV_LOGIN === "true"

/** Applies registration settings and records the account. Returns whether to allow sign-in. */
async function admit(rawEmail: string, name: string | null | undefined) {
  const email = rawEmail.toLowerCase()
  const db = getDb()
  const [existing] = await db
    .select()
    .from(users)
    .where(sql.eq(users.email, email))
  const admin = isAdminEmail(email)

  if (existing) {
    if (existing.disabled) return false
    if (admin && existing.role !== "admin") {
      await db
        .update(users)
        .set({ role: "admin" })
        .where(sql.eq(users.id, existing.id))
    }
    return true
  }

  if (!admin) {
    const settings = await getSettings()
    if (!settings["registration.enabled"]) return false
    const domains = settings["registration.allowed_email_domains"]
    if (!emailDomainAllowed(email, domains)) return false
  }
  await db
    .insert(users)
    .values({
      email,
      name,
      handle: await freeHandle(email),
      role: admin ? "admin" : "student",
    })
    .onConflictDoNothing({ target: users.email })
  return true
}

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    }),
    ...(DEV_LOGIN_ENABLED
      ? [
          CredentialsProvider({
            id: "dev",
            name: "Development login",
            credentials: { email: { type: "email" } },
            authorize: (credentials) =>
              credentials?.email
                ? { id: credentials.email, email: credentials.email }
                : null,
          }),
        ]
      : []),
  ],
  // Sessions live in a signed cookie. Roles are not in it: see getCurrentUser.
  session: { strategy: "jwt" },
  pages: { signIn: "/sign-in", error: "/sign-in" },
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "google") {
        const google = profile as GoogleProfile | undefined
        if (!google?.email_verified) return false
      } else if (!(DEV_LOGIN_ENABLED && account?.provider === "dev")) {
        return false
      }
      return user.email ? admit(user.email, user.name) : false
    },
  },
}
