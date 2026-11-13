import { randomInt } from "node:crypto"

import { certificates, getDb, organizations, sql, users, type User } from "@workspace/db"
import { KINDS } from "@workspace/judge"

import { classContext, studentsIn } from "@/features/classes/server"
import { courseFinishers } from "@/features/courses/classes"
import { notify } from "@/features/notifications/server"
import { needFor, writeAudit } from "@/features/orgs/server"
import { ApiError, notFound } from "@/lib/api/route"

import type { IssueInput } from "./schemas"

/*
 * Certificates: given in a class by whoever sets its work, for finishing one of its
 * courses or one a teacher writes for chosen students. Each has a short public code;
 * /certificates/<code> verifies it for anyone (an employer, another college) without
 * signing in, and says when one was revoked.
 */

const { and, desc, eq, isNull } = sql

/** No 0/O or 1/I/L, so a code read aloud or typed is unambiguous. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
const newCode = () =>
  Array.from({ length: 10 }, (_, i) => (i === 5 ? "-" : "") + ALPHABET[randomInt(ALPHABET.length)]).join("")

export async function issueCertificates(slug: string, user: User, groupId: string, input: IssueInput) {
  const cc = await classContext(slug, user, groupId)
  needFor(cc.ctx, "assignments.manage", [[groupId]])
  const className = cc.ctx.groups.find((g) => g.id === groupId)?.name ?? "the class"
  let people: { id: string }[]
  let title: string
  let detail: string
  let sourceId: string | null = null
  if (input.kind === "course") {
    const f = await courseFinishers(slug, user, groupId, input.courseId)
    // Once per student per course: finishing again doesn't make another.
    const had = new Set(
      (
        await getDb()
          .select({ userId: certificates.userId })
          .from(certificates)
          .where(and(eq(certificates.kind, "course"), eq(certificates.sourceId, input.courseId)))
      ).map((r) => r.userId)
    )
    people = f.finishers.filter((s) => !had.has(s.id))
    title = f.course.title
    detail = `Completed all ${f.modules} modules of the course in ${className}, ${cc.ctx.org.name}.`
    sourceId = input.courseId
  } else if (input.kind === "graduation") {
    const kind = KINDS[cc.ctx.org.type]
    const group = cc.ctx.groups.find((g) => g.id === groupId)!
    if (!kind.groupDates || !group.startsOn || !group.endsOn) {
      throw new ApiError(400, "no_run", "Only a group with run dates has graduates.")
    }
    const students = new Set((await studentsIn(cc)).map((s) => s.id))
    if (input.userIds.some((id) => !students.has(id))) {
      throw new ApiError(400, "not_in_class", "Only people in it can graduate from it.")
    }
    // Once per person per run.
    const had = new Set(
      (
        await getDb()
          .select({ userId: certificates.userId })
          .from(certificates)
          .where(and(eq(certificates.kind, "graduation"), eq(certificates.sourceId, groupId), isNull(certificates.revokedAt)))
      ).map((r) => r.userId)
    )
    people = input.userIds.filter((id) => !had.has(id)).map((id) => ({ id }))
    title = `${className}, ${cc.ctx.org.name}`
    detail = `Completed the ${kind.terms.group.toLowerCase()}, ${group.startsOn} to ${group.endsOn}.`
    sourceId = groupId
  } else {
    const students = new Set((await studentsIn(cc)).map((s) => s.id))
    if (input.userIds.some((id) => !students.has(id))) {
      throw new ApiError(400, "not_in_class", "Certificates go only to students in this class.")
    }
    people = input.userIds.map((id) => ({ id }))
    title = input.title
    detail = input.detail || `${className}, ${cc.ctx.org.name}.`
  }
  if (people.length === 0) return { issued: 0 }
  await getDb()
    .insert(certificates)
    .values(
      people.map((p) => ({
        code: newCode(),
        orgId: cc.ctx.org.id,
        groupId,
        userId: p.id,
        kind: input.kind,
        sourceId,
        title,
        detail,
        issuedBy: user.id,
      }))
    )
  await notify(
    people.map((p) => p.id),
    {
      kind: "certificate",
      title: `You've earned a certificate: ${title}`,
      body: "Find it under My certificates, with a link anyone can check.",
      href: "/certificates",
      orgId: cc.ctx.org.id,
    }
  )
  await writeAudit(cc.ctx, "certificate.issue", `Issued ${people.length} "${title}" certificates in ${className}`)
  return { issued: people.length }
}

/** A class's certificates, for its teachers. */
export async function classCertificates(slug: string, user: User, groupId: string) {
  const cc = await classContext(slug, user, groupId)
  needFor(cc.ctx, "assignments.manage", [[groupId]])
  const rows = await getDb()
    .select({ c: certificates, name: users.name, email: users.email })
    .from(certificates)
    .innerJoin(users, eq(certificates.userId, users.id))
    .where(eq(certificates.groupId, groupId))
    .orderBy(desc(certificates.issuedAt))
  const students = await studentsIn(cc)
  return {
    issued: rows.map((r) => ({
      id: r.c.id,
      code: r.c.code,
      title: r.c.title,
      student: r.name ?? r.email,
      issuedAt: r.c.issuedAt,
      revoked: r.c.revokedAt !== null,
    })),
    /** To choose from for a certificate a teacher writes. */
    students: students.map((s) => ({ id: s.id, name: s.name ?? s.handle ?? s.email })),
  }
}

export async function revokeCertificate(slug: string, user: User, groupId: string, id: string) {
  const cc = await classContext(slug, user, groupId)
  needFor(cc.ctx, "assignments.manage", [[groupId]])
  const [row] = await getDb()
    .update(certificates)
    .set({ revokedAt: new Date() })
    .where(and(eq(certificates.id, id), eq(certificates.groupId, groupId), sql.isNull(certificates.revokedAt)))
    .returning()
  if (!row) throw notFound("Certificate not found")
  await writeAudit(cc.ctx, "certificate.revoke", `Revoked certificate ${row.code} (${row.title})`)
}

export async function myCertificates(user: User) {
  const rows = await getDb()
    .select({ c: certificates, org: organizations.name })
    .from(certificates)
    .leftJoin(organizations, eq(certificates.orgId, organizations.id))
    .where(eq(certificates.userId, user.id))
    .orderBy(desc(certificates.issuedAt))
  return rows.map((r) => ({
    code: r.c.code,
    title: r.c.title,
    detail: r.c.detail,
    org: r.org,
    issuedAt: r.c.issuedAt,
    revoked: r.c.revokedAt !== null,
  }))
}

/** What anyone may see about a certificate: who, what, from whom, when, still valid. */
export async function verifyCertificate(code: string) {
  const clean = code.trim().toUpperCase()
  if (!/^[2-9A-Z]{5}-[2-9A-Z]{5}$/.test(clean)) return null
  const issuer = sql.sql<string | null>`(select coalesce(name, email) from users where id = ${certificates.issuedBy})`
  const [row] = await getDb()
    .select({ c: certificates, name: users.name, handle: users.handle, org: organizations.name, issuer })
    .from(certificates)
    .innerJoin(users, eq(certificates.userId, users.id))
    .leftJoin(organizations, eq(certificates.orgId, organizations.id))
    .where(eq(certificates.code, clean))
  if (!row) return null
  return {
    code: row.c.code,
    // Names, never emails: the page is public.
    name: row.name ?? row.handle ?? "A student",
    title: row.c.title,
    detail: row.c.detail,
    org: row.org,
    issuer: row.issuer?.includes("@") ? null : row.issuer,
    issuedAt: row.c.issuedAt,
    revokedAt: row.c.revokedAt,
  }
}

