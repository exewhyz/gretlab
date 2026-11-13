/*
 * Email templates: every email the site sends, its default wording, the placeholders it
 * may use, and rendering into a subject, a plain-text body and branded HTML. Platform staff
 * with "Manage email templates" change the wording (Dashboard › Emails); the stored
 * version replaces the default here. Browser-safe, so the editor's preview renders exactly
 * what will be sent.
 *
 * Wording is plain text with a little markup:
 *   {{name}}               a placeholder; the template lists which it may use
 *   **bold**               bold
 *   [words](url)           a link (http, https or mailto only)
 *   [button: words](url)   a button, on a line of its own
 *   - item                 a list, one item a line
 *   a blank line           a new paragraph
 * Placeholders are filled after the markup is read, so what people wrote (a notice's
 * text) is never read as markup, and is always escaped in HTML.
 */

export interface TemplateVar {
  key: string
  description: string
  /** Shown in previews and test emails. */
  example: string
  /** Must stay in the wording (a link or a code the email exists to deliver). */
  required?: boolean
}

export interface TemplateDefinition {
  label: string
  description: string
  category: "Account" | "Sign-in" | "Notifications"
  subject: string
  body: string
  vars: readonly TemplateVar[]
  /** A line under the footer saying why they got it (account emails don't say). */
  why?: string
}

/** Placeholders every template may use. */
export const COMMON_VARS: readonly TemplateVar[] = [
  { key: "site", description: "The site's name", example: "Gretlab" },
  { key: "siteUrl", description: "The site's address", example: "https://gretlab.example.com" },
]

export const EMAIL_TEMPLATES = {
  "account.confirm": {
    label: "Confirm email address",
    description: "Sent after someone signs up with email and password, to confirm the address is theirs.",
    category: "Account",
    subject: "Confirm your email for {{site}}",
    body:
      "Hi {{name}},\n\nThanks for signing up. Confirm this is your email address to finish making your account.\n\n" +
      "[button: Confirm my email]({{link}})\n\n" +
      "The link works once, for 24 hours. If you didn't sign up, ignore this email and no account will be made.",
    vars: [
      { key: "name", description: "Their name", example: "Priya" },
      { key: "link", description: "The confirmation link", example: "https://gretlab.example.com/verify-email?token=…", required: true },
    ],
  },
  "account.exists": {
    label: "Account already exists",
    description: "Sent when someone tries to sign up with an address that already has an account.",
    category: "Account",
    subject: "You already have a {{site}} account",
    body:
      "Hi,\n\nSomeone (probably you) tried to make an account with **{{email}}**, but there's already one.\n\n" +
      "[button: Sign in]({{signInLink}})\n\n" +
      "Sign in with Google or your password. Forgotten it? [Choose a new password]({{resetLink}}).\n\n" +
      "If this wasn't you, you can ignore this email.",
    vars: [
      { key: "email", description: "The address", example: "priya@example.com" },
      { key: "signInLink", description: "The sign-in page", example: "https://gretlab.example.com/sign-in", required: true },
      { key: "resetLink", description: "The forgotten-password page", example: "https://gretlab.example.com/forgot-password" },
    ],
  },
  "account.reset": {
    label: "Reset password",
    description: "Sent when someone asks to choose a new password.",
    category: "Account",
    subject: "Reset your {{site}} password",
    body:
      "Hi {{name}},\n\nChoose a new password for **{{email}}**:\n\n[button: Choose a new password]({{link}})\n\n" +
      "The link works once, for an hour. If you didn't ask for this, ignore this email: your password stays as it is.",
    vars: [
      { key: "name", description: "Their name", example: "Priya" },
      { key: "email", description: "The address", example: "priya@example.com" },
      { key: "link", description: "The reset link", example: "https://gretlab.example.com/reset-password?token=…", required: true },
    ],
  },
  "account.security": {
    label: "Security notice",
    description:
      "Sent whenever an account's sign-in changes: a password set, changed or reset, password sign-in paused, two-factor turned on or off.",
    category: "Account",
    subject: "Security: {{what}}",
    body:
      "Hi,\n\n**{{what}}** for your account ({{email}}) on {{when}}.\n\n" +
      "If this was you, there's nothing to do. If it wasn't, secure your account now and tell your administrator.\n\n" +
      "[button: Check your security settings]({{link}})",
    vars: [
      { key: "what", description: "What changed", example: "Your password was changed", required: true },
      { key: "email", description: "The account's address", example: "priya@example.com" },
      { key: "when", description: "When it happened", example: "Fri, 13 Nov 2026 10:24:00 GMT" },
      { key: "link", description: "Security settings", example: "https://gretlab.example.com/account/security" },
    ],
  },
  "auth.code": {
    label: "Sign-in code",
    description: "A six-digit code for two-factor sign-in, or to confirm a change to it.",
    category: "Sign-in",
    subject: "Your {{site}} code: {{code}}",
    body:
      "Your code to {{purpose}} is:\n\n**{{code}}**\n\nIt works once, for 10 minutes.\n\n" +
      "If you didn't ask for it, someone may know your password: change it, and ignore this email.",
    vars: [
      { key: "code", description: "The six-digit code", example: "482913", required: true },
      { key: "purpose", description: "What it's for", example: "sign in" },
    ],
  },
  notification: {
    label: "Notification",
    description:
      "Every notification also sent by email (notices, grades, reminders, events, training, certificates…), each with its own title and text.",
    category: "Notifications",
    subject: "{{title}}",
    body: "{{body}}\n\n[button: Open]({{link}})",
    vars: [
      { key: "title", description: "The notification's title", example: "New notice in CSE 2nd year", required: true },
      { key: "body", description: "Its text", example: "Lab moves to Room 204 on Friday." },
      { key: "link", description: "Where it leads", example: "https://gretlab.example.com/orgs/demo/classes/…" },
      { key: "org", description: "The organization it's from (may be empty)", example: "Demo College" },
    ],
    why: "You get this because of your notification settings on {{site}}. [Change them]({{settingsLink}}).",
  },
  "digest.weekly": {
    label: "Weekly summary",
    description: "Monday's summary of an organization's week, for the people who run it.",
    category: "Notifications",
    subject: "{{org}}: your weekly summary",
    body: "Here's **{{org}}** over the last 7 days.\n\n{{lines}}\n\n[button: See the reports]({{reportsLink}})",
    vars: [
      { key: "org", description: "The organization", example: "Demo College", required: true },
      { key: "lines", description: "The week, as a list", example: "- 42 submissions\n- 3 assignments due\n- Attendance 91%", required: true },
      { key: "reportsLink", description: "Its reports page", example: "https://gretlab.example.com/orgs/demo/manage/reports" },
    ],
    why: "You get this as someone who runs {{org}}. [Change it]({{settingsLink}}).",
  },
} as const satisfies Record<string, TemplateDefinition>

export type EmailTemplateKey = keyof typeof EMAIL_TEMPLATES
export const EMAIL_TEMPLATE_KEYS = Object.keys(EMAIL_TEMPLATES) as EmailTemplateKey[]
export const isEmailTemplateKey = (k: string): k is EmailTemplateKey => k in EMAIL_TEMPLATES

/** The shared footer's default; stored under the key "layout". */
export const DEFAULT_FOOTER = "Sent by {{site}} · {{siteUrl}}"

export const TEMPLATE_LIMITS = { subject: 200, body: 5000, footer: 500 } as const

const PLACEHOLDER = /\{\{\s*([a-zA-Z]+)\s*\}\}/g

/** Placeholders a template may use: its own and the common ones. */
export function varsOf(key: EmailTemplateKey | "layout"): readonly TemplateVar[] {
  if (key === "layout") return COMMON_VARS
  const own: TemplateDefinition = EMAIL_TEMPLATES[key]
  const settings: TemplateVar[] = own.why
    ? [{ key: "settingsLink", description: "Their notification settings", example: "https://gretlab.example.com/notifications" }]
    : []
  return [...own.vars, ...COMMON_VARS, ...settings]
}

/** Why wording can't be saved, or null: unknown placeholders, or a required one missing. */
export function templateProblem(key: EmailTemplateKey | "layout", subject: string, body: string): string | null {
  const allowed = new Set(varsOf(key).map((v) => v.key))
  const used = [...`${subject}\n${body}`.matchAll(PLACEHOLDER)].map((m) => m[1]!)
  const unknown = [...new Set(used.filter((u) => !allowed.has(u)))]
  if (unknown.length) return `Unknown placeholder${unknown.length > 1 ? "s" : ""}: ${unknown.map((u) => `{{${u}}}`).join(", ")}.`
  if (key !== "layout") {
    const missing = EMAIL_TEMPLATES[key].vars.filter((v) => "required" in v && v.required && !used.includes(v.key))
    if (missing.length) return `Keep ${missing.map((v) => `{{${v.key}}}`).join(", ")}: the email exists to deliver it.`
  }
  if (key !== "layout" && !subject.trim()) return "Give it a subject."
  if (!body.trim()) return "Write something."
  return null
}

/* ---------- rendering ---------- */

export interface Layout {
  site: string
  siteUrl: string
  footer: string
  /** The brand colour of buttons and the header. */
  accent?: string
}

export interface Rendered {
  subject: string
  text: string
  html: string
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;")

const safeUrl = (url: string) => (/^(https?:|mailto:)/i.test(url.trim()) ? url.trim() : "")

/** Fills placeholders for plain text: values as they are. */
function fillText(s: string, vars: Record<string, string>) {
  return s.replace(PLACEHOLDER, (_, k: string) => vars[k] ?? "")
}

/** Wording in plain text: links become "words: url". */
function toText(body: string, vars: Record<string, string>) {
  // Links are checked like in HTML: one that isn't http(s) or mailto keeps only its words.
  const href = (u: string) => safeUrl(fillText(u, vars))
  const filled = body
    .replace(/\[button:\s*([^\]]+)\]\(([^)]+)\)/g, (_, w: string, u: string) =>
      href(u) ? `${w.trim()}: ${href(u)}` : w.trim()
    )
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, w: string, u: string) => (href(u) ? `${w} (${href(u)})` : w))
    .replace(/\*\*([^*]+)\*\*/g, "$1")
  return fillText(filled, vars)
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Wording in HTML. Markup is read from the template only; values are escaped after. */
function toHtml(body: string, vars: Record<string, string>, accent: string) {
  const value = (k: string) => esc(vars[k] ?? "").replace(/\n/g, "<br>")
  const url = (raw: string) => esc(safeUrl(fillText(raw, vars)))
  const inline = (s: string) =>
    esc(s)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, w: string, u: string) => {
        const href = url(u.replace(/&amp;/g, "&"))
        return href ? `<a href="${href}" style="color:${accent};text-decoration:underline">${w}</a>` : w
      })
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(PLACEHOLDER, (_, k: string) => value(k))
      .replace(/\n/g, "<br>")
  const blocks = body.trim().split(/\n\s*\n/)
  return blocks
    .map((block) => {
      const button = block.trim().match(/^\[button:\s*([^\]]+)\]\(([^)]+)\)$/)
      if (button) {
        const href = url(button[2]!)
        if (!href) return ""
        return (
          `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px"><tr><td style="border-radius:8px;background:${accent}">` +
          `<a href="${href}" style="display:inline-block;padding:12px 22px;color:#ffffff;font-weight:600;text-decoration:none;border-radius:8px">${esc(button[1]!.trim())}</a>` +
          `</td></tr></table>`
        )
      }
      const lines = block.split("\n")
      if (lines.every((l) => /^\s*- /.test(l)))
        return `<ul style="margin:0 0 16px;padding-left:20px">${lines.map((l) => `<li style="margin:4px 0">${inline(l.replace(/^\s*- /, ""))}</li>`).join("")}</ul>`
      // A placeholder alone on its block whose value is a list (the weekly summary's lines).
      const only = block.trim().match(/^\{\{\s*([a-zA-Z]+)\s*\}\}$/)
      if (only && (vars[only[1]!] ?? "").split("\n").every((l) => /^- /.test(l)) && vars[only[1]!])
        return `<ul style="margin:0 0 16px;padding-left:20px">${vars[only[1]!]!.split("\n").map((l) => `<li style="margin:4px 0">${esc(l.slice(2))}</li>`).join("")}</ul>`
      return `<p style="margin:0 0 16px">${inline(block)}</p>`
    })
    .join("")
}

/** A template's wording, with these values, in this layout: subject, text and HTML. */
export function renderEmail(
  wording: { subject: string; body: string; why?: string },
  values: Record<string, string>,
  layout: Layout
): Rendered {
  const vars: Record<string, string> = { site: layout.site, siteUrl: layout.siteUrl, ...values }
  const accent = /^#[0-9a-f]{6}$/i.test(layout.accent ?? "") ? layout.accent! : "#f54e00"
  const subject = fillText(wording.subject, vars).replace(/\s+/g, " ").trim().slice(0, 300)
  const footerText = toText(layout.footer, vars)
  const whyText = wording.why ? toText(wording.why, vars) : ""
  const text = [toText(wording.body, vars), "—", whyText, footerText].filter(Boolean).join("\n\n")
  const footerHtml = toHtml(layout.footer, vars, accent)
  const whyHtml = wording.why ? toHtml(wording.why, vars, accent) : ""
  const html =
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<meta name="color-scheme" content="light"><title>${esc(subject)}</title></head>` +
    `<body style="margin:0;padding:0;background:#f7f7f4">` +
    // The preview line inboxes show under the subject.
    `<div style="display:none;max-height:0;overflow:hidden">${esc(toText(wording.body, vars).slice(0, 140))}</div>` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f7f4"><tr><td align="center" style="padding:32px 16px">` +
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">` +
    `<tr><td style="padding:0 4px 16px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:18px;font-weight:700;color:${accent}">&gt;&gt;&gt; ${esc(layout.site)}</td></tr>` +
    `<tr><td style="background:#ffffff;border:1px solid #e6e5e0;border-radius:14px;padding:28px 28px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#26251e">` +
    toHtml(wording.body, vars, accent) +
    `</td></tr>` +
    `<tr><td style="padding:16px 8px 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#7a7974">` +
    whyHtml +
    footerHtml +
    `</td></tr></table></td></tr></table></body></html>`
  return { subject, text, html }
}

/** Example values for a template's placeholders, for previews and test emails. */
export function exampleValues(key: EmailTemplateKey | "layout") {
  // The site's own name and address are real, never examples.
  const common = new Set(COMMON_VARS.map((v) => v.key))
  return Object.fromEntries(varsOf(key).filter((v) => !common.has(v.key)).map((v) => [v.key, v.example]))
}
