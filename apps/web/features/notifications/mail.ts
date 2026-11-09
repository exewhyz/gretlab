import nodemailer, { type Transporter } from "nodemailer"

/*
 * Email, when SMTP_URL is set (smtp://user:password@host:587, or smtps:// for 465).
 * MAIL_FROM names the sender. Without SMTP_URL nothing is sent and notifications stay in
 * the app.
 */

let transport: Transporter | null | undefined

function transporter() {
  if (transport !== undefined) return transport
  const url = process.env.SMTP_URL
  transport = url ? nodemailer.createTransport(url) : null
  return transport
}

export async function sendMail(message: { to: string; subject: string; text: string }) {
  const t = transporter()
  if (!t) return false
  await t.sendMail({
    from: process.env.MAIL_FROM ?? "GretLab <no-reply@localhost>",
    ...message,
  })
  return true
}
