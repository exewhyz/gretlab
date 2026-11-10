import { resendMailer } from "./resend"
import { smtpMailer } from "./smtp"
import type { Mailer } from "./types"

export type { Mail, Mailer, SendResult } from "./types"

/*
 * Which provider sends email, from the environment:
 *   RESEND_API_KEY  Resend's HTTPS API (the default; batches of 100)
 *   SMTP_URL        any SMTP server: smtp://user:password@host:587, smtps:// for 465
 * With neither, email is off: nothing is queued and notifications stay in the app.
 * MAIL_FROM names the sender, on a domain the provider has verified.
 */

let chosen: Mailer | null | undefined

export function mailer(): Mailer | null {
  if (chosen !== undefined) return chosen
  const resendKey = process.env.RESEND_API_KEY
  const smtpUrl = process.env.SMTP_URL
  chosen = resendKey
    ? resendMailer(
        resendKey,
        process.env.RESEND_API_URL ?? "https://api.resend.com"
      )
    : smtpUrl
      ? smtpMailer(smtpUrl)
      : null
  return chosen
}

export const mailEnabled = () =>
  Boolean(process.env.RESEND_API_KEY || process.env.SMTP_URL)

export const mailFrom = () =>
  process.env.MAIL_FROM ?? "GretLab <no-reply@localhost>"
