/*
 * Password rules for sign-in with email and password, after NIST SP 800-63B: long enough,
 * not a common or easily guessed password, not made from the account's own email; no
 * rules about mixing character kinds, and no forced changes. Browser-safe, so the forms
 * show the same reasons the server gives. Hashing lives on the server
 * (apps/web/features/auth/password.ts).
 */

export const PASSWORD = { min: 10, max: 128 } as const

/** The commonest passwords and patterns long enough to pass the length rule. */
const COMMON = new Set([
  "1234567890", "12345678910", "0123456789", "0987654321", "1111111111", "0000000000",
  "qwertyuiop", "asdfghjkl;", "1q2w3e4r5t", "1qaz2wsx3edc", "qwerty1234", "qwerty12345",
  "password12", "password123", "password1234", "passw0rd123", "iloveyou12", "letmein123",
  "welcome123", "welcome1234", "admin12345", "administrator", "changeme123", "football123",
  "baseball123", "superman123", "trustno1234", "abcdefghij", "abc1234567", "monkey12345",
  "sunshine123", "princess123", "dragon12345", "starwars123", "computer123", "internet123",
  "qwertyuiop123", "zaq12wsxcde", "aaaaaaaaaa", "1234qwerasdf", "india12345", "india@123",
  "gretlab1234", "gretlab12345", "student123", "student1234", "teacher123", "teacher1234",
])

/** Why a password won't do, or null when it's fine. */
export function passwordProblem(password: string, email = ""): string | null {
  if (password.length < PASSWORD.min) return `Use at least ${PASSWORD.min} characters.`
  if (password.length > PASSWORD.max) return `Use at most ${PASSWORD.max} characters.`
  const lower = password.toLowerCase()
  if (COMMON.has(lower)) return "That's one of the most common passwords. Choose another."
  if (new Set(lower).size <= 2) return "Use more than one or two different characters."
  if (/^(?:0123456789|1234567890|abcdefghijklmnopqrstuvwxyz)+$/.test(lower) || isRun(lower))
    return "A run of letters or numbers is easy to guess. Choose another."
  const name = email.toLowerCase().split("@")[0] ?? ""
  if (name.length >= 4 && lower.includes(name)) return "Don't use your email address in your password."
  return null
}

/** abcdef…, 987654… : each character one after the last. */
function isRun(s: string) {
  if (s.length < 6) return false
  const step = s.charCodeAt(1) - s.charCodeAt(0)
  if (Math.abs(step) !== 1) return false
  for (let i = 2; i < s.length; i++) if (s.charCodeAt(i) - s.charCodeAt(i - 1) !== step) return false
  return true
}

/** After this many wrong passwords in a row, password sign-in waits. */
export const PASSWORD_LOCK = { failures: 5, minutes: 15 } as const

/** How long sign-in links last. */
export const AUTH_LINK_MINUTES = { verify: 24 * 60, reset: 60 } as const
