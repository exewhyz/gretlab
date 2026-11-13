import { emailTemplates, getDb, sql, type User } from "@workspace/db"
import {
  DEFAULT_FOOTER,
  EMAIL_TEMPLATE_KEYS,
  EMAIL_TEMPLATES,
  exampleValues,
  isEmailTemplateKey,
  renderEmail,
  TEMPLATE_LIMITS,
  templateProblem,
  varsOf,
  type EmailTemplateKey,
  type TemplateDefinition,
} from "@workspace/judge"
import { z } from "zod"

import { queueEmails, sendUrgent } from "@/features/notifications/outbox"
import { platformCan } from "@/features/platform/access"
import { writePlatformAudit } from "@/features/platform/staff"
import { getSettings } from "@/features/settings/server"
import { ApiError, notFound } from "@/lib/api/errors"
import { cached, invalidate } from "@/lib/ttl-cache"

/*
 * Email templates (Dashboard › Emails): the wording of every email, stored when changed
 * from its default (packages/judge/src/emails.ts has the defaults, placeholders and the
 * renderer). composeEmail() is how every part of the site builds an email: the current
 * wording, the shared footer and the site's name, as a subject, plain text and HTML.
 * Read through a short cache, cleared when wording is saved.
 */

const { eq } = sql
const KEY = "email-templates"

type Stored = Record<string, { subject: string; body: string; updatedAt: Date }>

function stored(): Promise<Stored> {
  return cached(KEY, 30_000, async () => {
    const rows = await getDb().select().from(emailTemplates)
    return Object.fromEntries(rows.map((r) => [r.key, { subject: r.subject, body: r.body, updatedAt: r.updatedAt }]))
  })
}

async function layout() {
  const [settings, rows] = await Promise.all([getSettings(), stored()])
  return {
    site: settings["site.title"],
    siteUrl: process.env.NEXTAUTH_URL ?? "",
    footer: rows.layout?.body ?? DEFAULT_FOOTER,
  }
}

/** An email from its template: the current wording, with these values filled in. */
export async function composeEmail(key: EmailTemplateKey, values: Record<string, string>) {
  const [rows, frame] = await Promise.all([stored(), layout()])
  const def: TemplateDefinition = EMAIL_TEMPLATES[key]
  const wording = rows[key] ? { ...rows[key], why: def.why } : def
  return renderEmail(wording, { settingsLink: `${frame.siteUrl}/notifications`, ...values }, frame)
}

/* ---------- Dashboard › Emails ---------- */

async function need(user: User) {
  if (!(await platformCan(user, "platform.emails.manage")))
    throw new ApiError(403, "forbidden", "Managing email templates isn't part of your role.")
}

export async function listTemplates(user: User) {
  await need(user)
  const [rows, frame] = await Promise.all([stored(), layout()])
  return {
    layout: { site: frame.site, siteUrl: frame.siteUrl },
    footer: {
      body: rows.layout?.body ?? DEFAULT_FOOTER,
      default: DEFAULT_FOOTER,
      changed: Boolean(rows.layout),
      vars: varsOf("layout"),
    },
    templates: EMAIL_TEMPLATE_KEYS.map((key) => {
      const def: TemplateDefinition = EMAIL_TEMPLATES[key]
      return {
        key,
        label: def.label,
        description: def.description,
        category: def.category,
        subject: rows[key]?.subject ?? def.subject,
        body: rows[key]?.body ?? def.body,
        why: def.why ?? null,
        defaults: { subject: def.subject, body: def.body },
        vars: varsOf(key),
        examples: exampleValues(key),
        changed: Boolean(rows[key]),
        updatedAt: rows[key]?.updatedAt ?? null,
      }
    }),
  }
}

export const templateSchema = z.object({
  subject: z.string().max(TEMPLATE_LIMITS.subject).default(""),
  body: z.string().max(TEMPLATE_LIMITS.body),
})

function keyOf(key: string): EmailTemplateKey | "layout" {
  if (key !== "layout" && !isEmailTemplateKey(key)) throw notFound("No such email")
  return key as EmailTemplateKey | "layout"
}

const labelOf = (key: EmailTemplateKey | "layout") => (key === "layout" ? "Email footer" : EMAIL_TEMPLATES[key].label)

export async function saveTemplate(user: User, rawKey: string, input: z.infer<typeof templateSchema>) {
  await need(user)
  const key = keyOf(rawKey)
  if (key === "layout" && input.body.length > TEMPLATE_LIMITS.footer)
    throw new ApiError(400, "too_long", `Keep the footer under ${TEMPLATE_LIMITS.footer} characters.`)
  const problem = templateProblem(key, input.subject, input.body)
  if (problem) throw new ApiError(400, "bad_template", problem)
  await getDb()
    .insert(emailTemplates)
    .values({ key, subject: input.subject, body: input.body, updatedBy: user.id })
    .onConflictDoUpdate({
      target: emailTemplates.key,
      set: { subject: input.subject, body: input.body, updatedBy: user.id, updatedAt: new Date() },
    })
  invalidate(KEY)
  await writePlatformAudit(user, "platform.email_template", `Changed the "${labelOf(key)}" email`, { key })
  return listTemplates(user)
}

/** Back to the default wording. */
export async function resetTemplate(user: User, rawKey: string) {
  await need(user)
  const key = keyOf(rawKey)
  await getDb().delete(emailTemplates).where(eq(emailTemplates.key, key))
  invalidate(KEY)
  await writePlatformAudit(user, "platform.email_template", `Put the "${labelOf(key)}" email back to its default`, { key })
  return listTemplates(user)
}

/** Sends the current wording, with example values, to the person editing it. */
export async function sendTest(user: User, rawKey: string) {
  await need(user)
  const key = keyOf(rawKey)
  const email = await composeEmail(key === "layout" ? "notification" : key, exampleValues(key === "layout" ? "notification" : key))
  await queueEmails(getDb(), [{ to: user.email, subject: `[Test] ${email.subject}`, text: email.text, html: email.html }], {
    urgent: true,
  })
  const sent = await sendUrgent()
  return { to: user.email, queued: true, sent: sent.sent > 0 }
}
