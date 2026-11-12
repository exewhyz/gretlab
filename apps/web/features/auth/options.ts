import { getDb, sql, users } from "@workspace/db"
import { emailDomainAllowed } from "@workspace/judge"
import type { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import GoogleProvider, { type GoogleProfile } from "next-auth/providers/google"

import { freeHandle } from "@/features/catalog/server"
import { getSettings } from "@/features/settings/server"
import { isAdminEmail } from "@/lib/admin-emails"

import { confirmApp, confirmEmail, verifySecondStep } from "./two-factor"

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
    /**
     * The second sign-in step happens here, on the server: the client calls the session's
     * update() with a code, and only a right code records `mfaAt` in the signed cookie.
     * A fresh sign-in starts without it (features/auth/two-factor.ts).
     */
    async jwt({ token, trigger, session }) {
      if (trigger === "signIn") {
        delete token.mfaAt
        delete token.mfaError
      }
      if (
        trigger === "update" &&
        token.email &&
        session &&
        typeof session === "object"
      ) {
        const data = session as {
          secondStep?: unknown
          confirmApp?: unknown
          confirmEmail?: unknown
        }
        const result =
          typeof data.confirmApp === "string"
            ? await confirmApp(token.email, data.confirmApp)
            : typeof data.confirmEmail === "string"
              ? await confirmEmail(token.email, data.confirmEmail)
              : typeof data.secondStep === "string"
                ? await verifySecondStep(token.email, data.secondStep)
                : null
        if (result?.ok) {
          token.mfaAt = result.at
          delete token.mfaError
        } else if (result) {
          token.mfaError = result.reason
        }
      }
      return token
    },
    session({ session, token }) {
      return {
        ...session,
        mfaAt: typeof token.mfaAt === "number" ? token.mfaAt : null,
        mfaError: typeof token.mfaError === "string" ? token.mfaError : null,
      }
    },
  },
}
