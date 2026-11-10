import { permanentSmtp } from "@workspace/judge"
import type { Transporter } from "nodemailer"

import type { Mailer, SendResult } from "./types"

/*
 * Any SMTP server, for self-hosted setups with their own mail server. The connection is
 * pooled (two at a time), so a batch reuses connections instead of a TLS handshake per
 * email. Options given in SMTP_URL's query string win over these.
 */

const POOL = {
  pool: "true",
  maxConnections: "2",
  connectionTimeout: "10000",
  greetingTimeout: "10000",
  socketTimeout: "20000",
}

let transport: Promise<Transporter> | undefined

function transporter(url: string) {
  transport ??= import("nodemailer").then(({ default: nodemailer }) => {
    const pooled = new URL(url)
    for (const [key, value] of Object.entries(POOL)) {
      if (!pooled.searchParams.has(key)) pooled.searchParams.set(key, value)
    }
    return nodemailer.createTransport(pooled.toString())
  })
  return transport
}

export function smtpMailer(url: string): Mailer {
  return {
    name: "smtp",
    batchSize: 20,
    async send(from, mails) {
      const t = await transporter(url)
      return Promise.all(
        mails.map(async (mail): Promise<SendResult> => {
          try {
            await t.sendMail({
              from,
              to: mail.to,
              subject: mail.subject,
              text: mail.text,
            })
            return { ok: true }
          } catch (error) {
            const code = (error as { responseCode?: unknown }).responseCode
            return {
              ok: false,
              permanent: permanentSmtp(typeof code === "number" ? code : null),
              error: `SMTP: ${String((error as Error).message ?? error).slice(0, 300)}`,
            }
          }
        })
      )
    },
  }
}
