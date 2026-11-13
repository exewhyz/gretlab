/** One email, as the outbox hands it to a provider. */
export interface Mail {
  /** The outbox row's id: stable across retries, so providers can use it to avoid duplicates. */
  id: string
  to: string
  subject: string
  text: string
  /** Sent alongside the text when there is one. */
  html?: string
}

export type SendResult =
  { ok: true } | { ok: false; permanent: boolean; error: string }

/**
 * An email provider. To add one (Postmark, SES, SendGrid...), implement this in a file of
 * its own and pick it in ./index.ts. Never throws: every email gets a result, in order.
 */
export interface Mailer {
  name: string
  /** How many emails one send() should be given. */
  batchSize: number
  send(from: string, mails: Mail[]): Promise<SendResult[]>
}
