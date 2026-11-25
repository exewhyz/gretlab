/*
 * College single sign-on with OpenID Connect: the checks on a sign-in token after its RS256
 * signature has been verified against the IdP's keys (the server does that first). Pure.
 * The email must be on a domain platform staff gave the college: otherwise a college's IdP
 * could vouch for anyone's address and take over their account.
 */

/** Seconds of clock difference allowed between the IdP and us. */
const SKEW = 60

/** Mail providers anyone can sign up with: never a college's SSO domain. */
const PUBLIC_MAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "yahoo.co.in",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "rediffmail.com",
  "zoho.com",
  "gmx.com",
  "mail.com",
  "yandex.com",
])

const DOMAIN =
  /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** The domain of an email address, lower-cased; null if it isn't one. */
export function emailDomain(email: string): string | null {
  const m = /^[^\s@]+@([^\s@]+)$/.exec(email.trim().toLowerCase())
  return m ? m[1]! : null
}

/** Why a domain can't be a college's SSO domain, in words, or null. */
export function ssoDomainProblem(domain: string): string | null {
  const d = domain.trim().toLowerCase()
  if (!DOMAIN.test(d)) return `"${domain}" isn't a domain like college.edu.`
  if (PUBLIC_MAIL.has(d))
    return `${d} is public mail anyone can sign up with, so it can't belong to one organization.`
  return null
}

export interface IdTokenExpectations {
  issuer: string
  clientId: string
  nonce: string
  /** The college's domains, set by platform staff. */
  domains: readonly string[]
  /** Seconds since the epoch. */
  now: number
}

export function checkIdToken(
  claims: Record<string, unknown>,
  expect: IdTokenExpectations
): { sub: string; email: string; name: string | null } | { error: string } {
  if (claims.iss !== expect.issuer)
    return {
      error:
        "The sign-in came from a different identity provider than the one set up.",
    }
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!audiences.includes(expect.clientId))
    return { error: "The sign-in wasn't meant for GretLab." }
  if (audiences.length > 1 && claims.azp !== expect.clientId)
    return { error: "The sign-in wasn't meant for GretLab." }
  if (typeof claims.exp !== "number" || claims.exp + SKEW < expect.now)
    return { error: "The sign-in has expired. Try again." }
  if (typeof claims.iat !== "number" || claims.iat - SKEW > expect.now)
    return { error: "The sign-in's time is wrong." }
  if (claims.nonce !== expect.nonce)
    return {
      error: "The sign-in doesn't match the one started here. Try again.",
    }
  if (typeof claims.sub !== "string" || claims.sub.length === 0)
    return { error: "The identity provider didn't say who you are." }
  if (claims.email_verified === false)
    return { error: "Your college hasn't verified your email address." }
  // Microsoft Entra often sends the address as preferred_username instead of email.
  const raw =
    typeof claims.email === "string"
      ? claims.email
      : typeof claims.preferred_username === "string"
        ? claims.preferred_username
        : ""
  const email = raw.trim().toLowerCase()
  const domain = emailDomain(email)
  if (!domain)
    return {
      error:
        "Your college didn't share your email address, which GretLab needs.",
    }
  if (!expect.domains.includes(domain))
    return { error: `${email} isn't on one of this college's domains.` }
  const name =
    typeof claims.name === "string" && claims.name.trim()
      ? claims.name.trim()
      : [claims.given_name, claims.family_name]
          .filter((x) => typeof x === "string")
          .join(" ") || null
  return { sub: claims.sub, email, name }
}
