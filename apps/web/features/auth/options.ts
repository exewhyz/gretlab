import { authTokens, getDb, sql, users } from "@workspace/db"
import { emailDomainAllowed } from "@workspace/judge"
import type { NextAuthOptions } from "next-auth"
import CredentialsProvider from "next-auth/providers/credentials"
import GoogleProvider, { type GoogleProfile } from "next-auth/providers/google"

import { freeHandle } from "@/features/catalog/server"
import { getSettings } from "@/features/settings/server"
import { isAdminEmail } from "@/lib/admin-emails"

import { checkPassword } from "./password"
import { confirmApp, confirmEmail, verifySecondStep } from "./two-factor"

/** Sign in as anyone without a password, so never available in a production build. */
export const DEV_LOGIN_ENABLED =
  process.env.NODE_ENV !== "production" && process.env.AUTH_DEV_LOGIN === "true"

/**
 * Applies registration settings and records the account. Returns whether to allow sign-in.
 * `verified`: the provider vouches for the address (Google), so it counts as confirmed.
 */
async function admit(rawEmail: string, name: string | null | undefined, verified = false) {
  const email = rawEmail.toLowerCase()
  const db = getDb()
  const [existing] = await db
    .select()
    .from(users)
    .where(sql.eq(users.email, email))
  const admin = isAdminEmail(email)

  if (existing) {
    if (existing.disabled) return false
    const set = {
      ...(admin && existing.role !== "admin" ? { role: "admin" as const } : {}),
      ...(verified && !existing.emailVerifiedAt
        ? {
            emailVerifiedAt: new Date(),
            // A password set before anyone proved the address could be someone else's
            // (pre-hijacking): the owner, proven by Google now, starts without it.
            ...(existing.passwordHash ? { passwordHash: null } : {}),
          }
        : {}),
    }
    if (Object.keys(set).length)
      await db.update(users).set(set).where(sql.eq(users.id, existing.id))
    if ("passwordHash" in set)
      await db
        .update(authTokens)
        .set({ usedAt: new Date() })
        .where(sql.and(sql.eq(authTokens.userId, existing.id), sql.isNull(authTokens.usedAt)))
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
      emailVerifiedAt: verified ? new Date() : null,
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
    // Email and password (features/auth/password.ts). A refusal's reason reaches the form
    // as its error: wrong, unverified or locked, never which part was wrong.
    CredentialsProvider({
      id: "password",
      name: "Email and password",
      credentials: { email: { type: "email" }, password: { type: "password" } },
      async authorize(credentials) {
        const result = await checkPassword(credentials?.email ?? "", credentials?.password ?? "")
        if (!result.ok) throw new Error(result.reason)
        return { id: result.user.id, email: result.user.email, name: result.user.name }
      },
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
        return user.email ? admit(user.email, user.name, true) : false
      }
      // The password was checked in authorize, against a confirmed account.
      if (account?.provider === "password") return user.email ? admit(user.email, user.name) : false
      if (!(DEV_LOGIN_ENABLED && account?.provider === "dev")) return false
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
        // A password reset or "sign out everywhere" ends sessions from before it.
        token.signedInAt = Date.now()
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
        signedInAt: typeof token.signedInAt === "number" ? token.signedInAt : null,
      }
    },
  },
}
