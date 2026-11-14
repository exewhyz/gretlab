import { auditLog, getDb, sql, users, type User } from "@workspace/db"
import { auditCategory, categoryLabel, describeDevice } from "@workspace/judge"
import { z } from "zod"

import { ApiError } from "@/lib/api/errors"
import { requestInfo } from "@/lib/api/request-context"
import { queueWebhooks } from "@/features/integrations/deliver"

/*
 * The audit log: one row per change, in organizations (`org_id` set) and on the platform
 * (`org_id` null). Every entry records who (and who they were then, kept if the account is
 * deleted), what (an action such as "role.update", its area, a sentence, and details: for
 * edits, `changes` as field/from/to and `added`/`removed` lists), when, and where from (the
 * address and browser of the request, via lib/api/request-context.ts), and whether it was
 * platform support stepping into an organization. Read with filters, a page at a time, or
 * as CSV, by organizations (Manage › Activity) and the platform (Dashboard › Activity).
 */

const { and, desc, eq, gte, ilike, isNull, lt, lte, or } = sql

type Writer = Pick<ReturnType<typeof getDb>, "insert">

export interface AuditInput {
  orgId: string | null
  actor: Pick<User, "id" | "name" | "email">
  action: string
  summary: string
  detail?: Record<string, unknown>
  support?: boolean
}

/** Writes one entry, in the caller's transaction when given one. */
export async function writeEntry(tx: Writer, input: AuditInput) {
  const info = requestInfo()
  const { ip, userAgent, apiKey } = info
  const who = input.actor.name
    ? `${input.actor.name} <${input.actor.email}>`
    : input.actor.email
  const actorLabel = apiKey ? `${who}, API key "${apiKey.name}"` : who
  // What's told to the organization's webhooks, in the same transaction as the entry.
  if (input.orgId && (await queueWebhooks(tx, input.orgId, {
    event: input.action,
    at: new Date().toISOString(),
    summary: input.summary.slice(0, 1000),
    actor: { id: input.actor.id, label: actorLabel },
    detail: input.detail ?? null,
  })))
    info.webhooksQueued = true
  await tx.insert(auditLog).values({
    orgId: input.orgId,
    actorId: input.actor.id,
    actorLabel,
    action: input.action,
    category: auditCategory(input.action),
    summary: input.summary.slice(0, 1000),
    detail: input.detail ?? null,
    ip,
    userAgent,
    support: input.support ?? false,
  })
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)

/** Filters from the query string; anything malformed is a 400, not a crash. */
export function auditFilters(query: URLSearchParams) {
  const parsed = z
    .object({
      q: z.string().trim().max(200).optional(),
      category: z.string().max(40).optional(),
      actor: z.uuid().optional(),
      from: day.optional(),
      to: day.optional(),
      before: z.string().max(100).optional(),
      limit: z.coerce.number().int().min(1).max(200).optional(),
    })
    .safeParse(
      Object.fromEntries([...query.entries()].filter(([, v]) => v !== ""))
    )
  if (!parsed.success)
    throw new ApiError(400, "bad_filter", "Those filters don't make sense.")
  return parsed.data
}

export type AuditFilters = ReturnType<typeof auditFilters>

/** "2026-11-12T08:00:00.000Z|uuid": the last entry shown, to page on from. */
const cursorOf = (e: { createdAt: Date; id: string }) =>
  `${e.createdAt.toISOString()}|${e.id}`

function where(orgId: string | null, f: AuditFilters) {
  const parts = [orgId ? eq(auditLog.orgId, orgId) : isNull(auditLog.orgId)]
  if (f.category) parts.push(eq(auditLog.category, f.category))
  if (f.actor) parts.push(eq(auditLog.actorId, f.actor))
  if (f.from)
    parts.push(gte(auditLog.createdAt, new Date(`${f.from}T00:00:00Z`)))
  if (f.to)
    parts.push(lte(auditLog.createdAt, new Date(`${f.to}T23:59:59.999Z`)))
  if (f.q) {
    const like = `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`
    parts.push(
      or(
        ilike(auditLog.summary, like),
        ilike(auditLog.actorLabel, like),
        ilike(auditLog.action, like)
      )!
    )
  }
  if (f.before) {
    const [at, id] = f.before.split("|")
    const when = new Date(at ?? "")
    if (Number.isNaN(when.getTime()) || !z.uuid().safeParse(id).success) {
      throw new ApiError(400, "bad_filter", "That page marker isn't valid.")
    }
    parts.push(
      or(
        lt(auditLog.createdAt, when),
        and(eq(auditLog.createdAt, when), lt(auditLog.id, id!))
      )!
    )
  }
  return and(...parts)
}

async function rows(orgId: string | null, f: AuditFilters, limit: number) {
  return getDb()
    .select({ entry: auditLog, name: users.name, email: users.email })
    .from(auditLog)
    .leftJoin(users, eq(auditLog.actorId, users.id))
    .where(where(orgId, f))
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit)
}

/** "Name <email>" as kept when written, back into its parts. */
function kept(label: string) {
  const m = /^(.*) <([^<>]+)>$/.exec(label)
  return m
    ? { name: m[1]!, email: m[2]! }
    : { name: label || "Someone", email: null }
}

const shape = ({
  entry,
  name,
  email,
}: Awaited<ReturnType<typeof rows>>[number]) => ({
  id: entry.id,
  action: entry.action,
  category: entry.category,
  categoryLabel: categoryLabel(entry.category),
  summary: entry.summary,
  detail: entry.detail,
  actor: email
    ? { id: entry.actorId, name: name ?? email, email, removed: false }
    : // The account is gone; who it was is kept as it was then.
      { id: null, ...kept(entry.actorLabel), removed: true },
  ip: entry.ip,
  device: describeDevice(entry.userAgent),
  support: entry.support,
  createdAt: entry.createdAt,
})

/** A page of entries, newest first, with the marker for the next page and what to filter by. */
export async function readAudit(orgId: string | null, f: AuditFilters) {
  const limit = f.limit ?? 50
  const db = getDb()
  const scope = orgId ? eq(auditLog.orgId, orgId) : isNull(auditLog.orgId)
  const [page, categories, people] = await Promise.all([
    rows(orgId, f, limit + 1),
    db
      .selectDistinct({ category: auditLog.category })
      .from(auditLog)
      .where(scope),
    db
      .selectDistinct({
        id: auditLog.actorId,
        name: users.name,
        email: users.email,
      })
      .from(auditLog)
      .innerJoin(users, eq(auditLog.actorId, users.id))
      .where(scope)
      .limit(300),
  ])
  const shown = page.slice(0, limit)
  return {
    entries: shown.map(shape),
    next: page.length > limit ? cursorOf(shown.at(-1)!.entry) : null,
    filters: {
      categories: categories
        .map((c) => ({ key: c.category, label: categoryLabel(c.category) }))
        .filter((c) => c.key)
        .sort((a, b) => a.label.localeCompare(b.label)),
      people: people
        .map((p) => ({ id: p.id!, name: p.name ?? p.email, email: p.email }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
  }
}

const csvField = (value: unknown) => {
  const text = value == null ? "" : String(value)
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Up to 10,000 entries matching the filters, as a CSV download. */
export async function auditCsv(
  orgId: string | null,
  f: AuditFilters,
  filename: string
) {
  const all = (await rows(orgId, { ...f, before: undefined }, 10_000)).map(
    shape
  )
  const lines = [
    [
      "When (UTC)",
      "Who",
      "Email",
      "Area",
      "Action",
      "What",
      "Changes",
      "Address",
      "Device",
      "Support",
    ],
    ...all.map((e) => [
      e.createdAt.toISOString(),
      e.actor.name,
      e.actor.email ?? "",
      e.categoryLabel,
      e.action,
      e.summary,
      changeText(e.detail),
      e.ip ?? "",
      e.device ?? "",
      e.support ? "yes" : "",
    ]),
  ]
  return new Response(
    lines.map((l) => l.map(csvField).join(",")).join("\r\n") + "\r\n",
    {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store",
      },
    }
  )
}

/** A one-line account of an entry's changes, for the CSV. */
function changeText(detail: Record<string, unknown> | null) {
  if (!detail) return ""
  const parts: string[] = []
  const changes = detail.changes as
    { field: string; from: string; to: string }[] | undefined
  if (Array.isArray(changes))
    parts.push(...changes.map((c) => `${c.field}: ${c.from} → ${c.to}`))
  const lists = detail.lists as
    { label: string; added: string[]; removed: string[] }[] | undefined
  if (Array.isArray(lists)) {
    for (const l of lists) {
      if (l.added.length) parts.push(`${l.label} added: ${l.added.join(", ")}`)
      if (l.removed.length)
        parts.push(`${l.label} removed: ${l.removed.join(", ")}`)
    }
  }
  // Older entries kept bare added/removed lists.
  for (const key of ["added", "removed"] as const) {
    const list = detail[key]
    if (Array.isArray(list) && list.length)
      parts.push(`${key}: ${list.join(", ")}`)
  }
  return parts.join("; ")
}
