import {
  enquiries,
  getDb,
  landingPartners,
  landingTestimonials,
  sql,
  type User,
} from "@workspace/db"
import { after } from "next/server"
import type { z } from "zod"

import { writeEntry } from "@/features/audit/server"
import { drainOutbox, queueEmails } from "@/features/notifications/outbox"
import { getSettings } from "@/features/settings/server"
import { ApiError, notFound } from "@/lib/api/route"
import { likeTerm, paged } from "@/lib/api/paging"
import { requestInfo } from "@/lib/api/request-context"

import { ENQUIRY_KINDS, type enquirySchema, type partnerSchema, type testimonialSchema } from "./schemas"

const { and, asc, count, desc, eq, gte, ilike, or } = sql

/*
 * The landing page's contact form, and the proof it shows (partner institutions and
 * testimonials, entered by platform staff; the sections stay hidden until there are some).
 * Enquiries are kept for follow-up on Dashboard › Landing page and emailed to the
 * organizations contact (Dashboard › Settings › Landing page).
 */

const HOUR = 60 * 60 * 1000
/** At most this many enquiries an hour from one address, and from one email. */
const PER_HOUR = 3

type Enquiry = z.output<typeof enquirySchema>

export async function submitEnquiry(input: Enquiry) {
  // The hidden field: a person never fills it. Answer as if it worked, so bots learn nothing.
  if (input.website) return { ok: true as const }
  const db = getDb()
  const { ip } = requestInfo()
  const since = new Date(Date.now() - HOUR)
  const [recent] = await db
    .select({ n: count() })
    .from(enquiries)
    .where(
      and(
        gte(enquiries.createdAt, since),
        ip ? or(eq(enquiries.ip, ip), eq(enquiries.email, input.email.toLowerCase())) : eq(enquiries.email, input.email.toLowerCase())
      )
    )
  if ((recent?.n ?? 0) >= PER_HOUR) {
    throw new ApiError(429, "too_many_enquiries", "We've had a few requests from you already. We'll be in touch, or try again in an hour.")
  }
  const settings = await getSettings()
  const to = settings["landing.contact_email"]
  const site = settings["site.title"]
  const kind = ENQUIRY_KINDS.find((k) => k.value === input.kind)?.label ?? input.kind
  await db.transaction(async (tx) => {
    await tx.insert(enquiries).values({
      name: input.name,
      email: input.email.toLowerCase(),
      organization: input.organization,
      kind: input.kind,
      learners: input.learners,
      message: input.message,
      ip,
    })
    if (to) {
      await queueEmails(tx, [
        {
          to,
          subject: `${site}: ${input.organization} would like to talk`,
          text: [
            `${input.name} <${input.email}> wrote from the landing page.`,
            "",
            `Organization: ${input.organization}`,
            `Kind: ${kind}`,
            `Learners: ${input.learners}`,
            "",
            input.message || "(No message.)",
            "",
            "Reply to them directly at the address above. It's also listed on Dashboard › Landing page.",
          ].join("\n"),
        },
      ])
    }
  })
  if (to) {
    try {
      after(() => drainOutbox().catch(() => {}))
    } catch {
      void drainOutbox().catch(() => {})
    }
  }
  return { ok: true as const }
}

/** The enquiries, newest first: `q` searches names, emails and organizations; `status` filters. */
export async function listEnquiries(opts: { page: number; perPage: number; q?: string; status?: "new" | "handled" }) {
  const db = getDb()
  const where = and(
    opts.status ? eq(enquiries.status, opts.status) : undefined,
    opts.q
      ? or(
          ilike(enquiries.name, likeTerm(opts.q)),
          ilike(enquiries.email, likeTerm(opts.q)),
          ilike(enquiries.organization, likeTerm(opts.q))
        )
      : undefined
  )
  const [page, waiting] = await Promise.all([
    paged({
      page: opts.page,
      perPage: opts.perPage,
      count: async () => (await db.select({ n: count() }).from(enquiries).where(where))[0]?.n ?? 0,
      rows: (limit, offset) =>
        db
          .select({
            id: enquiries.id,
            name: enquiries.name,
            email: enquiries.email,
            organization: enquiries.organization,
            kind: enquiries.kind,
            learners: enquiries.learners,
            message: enquiries.message,
            status: enquiries.status,
            createdAt: enquiries.createdAt,
            handledAt: enquiries.handledAt,
          })
          .from(enquiries)
          .where(where)
          .orderBy(desc(enquiries.createdAt))
          .limit(limit)
          .offset(offset),
    }),
    db.select({ n: count() }).from(enquiries).where(eq(enquiries.status, "new")),
  ])
  return { ...page, waiting: waiting[0]?.n ?? 0 }
}

export async function setEnquiryStatus(id: string, status: "new" | "handled", user: User) {
  return getDb().transaction(async (tx) => {
    const [row] = await tx
      .update(enquiries)
      .set(status === "handled" ? { status, handledAt: new Date(), handledBy: user.id } : { status, handledAt: null, handledBy: null })
      .where(eq(enquiries.id, id))
      .returning({ id: enquiries.id, status: enquiries.status, organization: enquiries.organization })
    if (!row) throw notFound("Enquiry not found")
    await writeEntry(tx, {
      orgId: null,
      actor: user,
      action: "landing.enquiry",
      summary: `Marked ${row.organization}'s enquiry ${status === "handled" ? "handled" : "new again"}`,
      detail: { enquiry: row.id, status },
    })
    return { id: row.id, status: row.status }
  })
}

/* ---------- proof: partners and testimonials ---------- */

/** What the landing page shows: real partners and quotes, in their order; empty hides them. */
export async function landingProof() {
  try {
    const db = getDb()
    const [partners, testimonials] = await Promise.all([
      db.select().from(landingPartners).orderBy(asc(landingPartners.position), asc(landingPartners.createdAt)),
      db.select().from(landingTestimonials).orderBy(asc(landingTestimonials.position), asc(landingTestimonials.createdAt)),
    ])
    return { partners, testimonials }
  } catch {
    // No database (a build): the sections stay hidden.
    return { partners: [], testimonials: [] }
  }
}

export async function addPartner(input: z.output<typeof partnerSchema>, user: User) {
  const position = await nextPosition("partners")
  return getDb().transaction(async (tx) => {
    const [row] = await tx.insert(landingPartners).values({ ...input, position }).returning()
    await writeEntry(tx, { orgId: null, actor: user, action: "landing.partner_add", summary: `Named ${input.name} on the landing page` })
    return row!
  })
}

export async function deletePartner(id: string, user: User) {
  await getDb().transaction(async (tx) => {
    const [row] = await tx.delete(landingPartners).where(eq(landingPartners.id, id)).returning({ name: landingPartners.name })
    if (!row) throw notFound("Partner not found")
    await writeEntry(tx, { orgId: null, actor: user, action: "landing.partner_remove", summary: `Took ${row.name} off the landing page` })
  })
}

export async function addTestimonial(input: z.output<typeof testimonialSchema>, user: User) {
  const position = await nextPosition("testimonials")
  return getDb().transaction(async (tx) => {
    const [row] = await tx.insert(landingTestimonials).values({ ...input, position }).returning()
    await writeEntry(tx, {
      orgId: null,
      actor: user,
      action: "landing.testimonial_add",
      summary: `Added a quote from ${input.name}, ${input.institution}, to the landing page`,
    })
    return row!
  })
}

export async function deleteTestimonial(id: string, user: User) {
  await getDb().transaction(async (tx) => {
    const [row] = await tx
      .delete(landingTestimonials)
      .where(eq(landingTestimonials.id, id))
      .returning({ name: landingTestimonials.name, institution: landingTestimonials.institution })
    if (!row) throw notFound("Testimonial not found")
    await writeEntry(tx, {
      orgId: null,
      actor: user,
      action: "landing.testimonial_remove",
      summary: `Took ${row.name}'s quote (${row.institution}) off the landing page`,
    })
  })
}

async function nextPosition(which: "partners" | "testimonials") {
  const table = which === "partners" ? landingPartners : landingTestimonials
  const [row] = await getDb().select({ n: count() }).from(table)
  return row?.n ?? 0
}
