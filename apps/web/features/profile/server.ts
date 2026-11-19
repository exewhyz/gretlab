import {
  academicYears,
  classSubjects,
  classTeachers,
  enrolments,
  getDb,
  groupMembers,
  guardians,
  orgGroups,
  orgMembers,
  orgRoles,
  organizations,
  roleAssignments,
  sql,
  studentRecords,
  subjects,
  users,
  type MemberProfile,
  type User,
  type UserProfile,
} from "@workspace/db"
import { isNoLoginEmail } from "@workspace/judge"

import { pathName } from "@/features/campus/people"
import {
  audit,
  can,
  context,
  type OrgContext,
} from "@/features/orgs/core"
import { SEAL as RECORD_SEAL } from "@/features/records/records-core"
import { ApiError, notFound } from "@/lib/api/errors"
import { orgPages } from "@/lib/paths"
import { seal, unseal } from "@/lib/sealed"

import type {
  AccountProfileInput,
  MemberProfileInput,
} from "./schemas"

/*
 * Profiles: what a person says about themselves on their account (Account › Profile), and
 * who they are in one organization (/orgs/:slug/profile/:id): their roles and classes, the
 * details the organization keeps (a student's record, a staff member's designation), and
 * the people linked to them (a student's parents, a parent's children, a teacher's classes).
 * Each part is shown only to those who may see it; anyone else gets 404.
 */

const { and, asc, eq, inArray } = sql

/** Phones in profiles are sealed like a student record's, under their own purpose. */
const SEAL = "profile"

const clean = (value: string | undefined) => {
  const v = value?.trim()
  return v ? v : undefined
}

/* ---------- the account profile ---------- */

export async function accountProfile(user: User) {
  const db = getDb()
  const [[row], orgs] = await Promise.all([
    db
      .select({
        name: users.name,
        email: users.email,
        handle: users.handle,
        profile: users.profile,
      })
      .from(users)
      .where(eq(users.id, user.id)),
    db
      .select({
        slug: organizations.slug,
        name: organizations.name,
        status: orgMembers.status,
      })
      .from(orgMembers)
      .innerJoin(organizations, eq(orgMembers.orgId, organizations.id))
      .where(
        and(eq(orgMembers.userId, user.id), eq(organizations.active, true))
      )
      .orderBy(asc(organizations.name)),
  ])
  if (!row) throw notFound("Account not found")
  const profile = row.profile ?? {}
  const fields = {
    name: row.name ?? "",
    handle: row.handle ?? "",
    headline: profile.headline ?? "",
    bio: profile.bio ?? "",
    city: profile.city ?? "",
    website: profile.website ?? "",
    github: profile.github ?? "",
    linkedin: profile.linkedin ?? "",
    phone: unseal(SEAL, profile.phone) ?? "",
  }
  return {
    email: row.email,
    ...fields,
    /** What's still empty, to nudge them towards a complete profile. */
    completeness: completeness([
      ["name", "Your name", fields.name],
      ["headline", "A headline", fields.headline],
      ["bio", "A few words about you", fields.bio],
      ["city", "Where you are", fields.city],
      ["phone", "A phone number", fields.phone],
      [
        "links",
        "A link (website, GitHub or LinkedIn)",
        fields.website || fields.github || fields.linkedin,
      ],
    ]),
    organizations: orgs
      .filter((o) => o.status === "active")
      .map((o) => ({
        slug: o.slug,
        name: o.name,
        profile: orgPages(o.slug).profile("me"),
      })),
  }
}

function completeness(items: [string, string, string][]) {
  const missing = items.filter(([, , v]) => !v.trim())
  return {
    done: items.length - missing.length,
    total: items.length,
    missing: missing.map(([key, label]) => ({ key, label })),
  }
}

export async function updateAccountProfile(
  user: User,
  input: AccountProfileInput
) {
  const db = getDb()
  if (input.handle !== undefined) {
    const [taken] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.handle, input.handle))
    if (taken && taken.id !== user.id)
      throw new ApiError(
        409,
        "handle_taken",
        "Someone already has that address. Try another."
      )
  }
  const [row] = await db
    .select({ profile: users.profile })
    .from(users)
    .where(eq(users.id, user.id))
  const before: UserProfile = row?.profile ?? {}
  const next: UserProfile = { ...before }
  for (const key of [
    "headline",
    "bio",
    "city",
    "website",
    "github",
    "linkedin",
  ] as const) {
    if (input[key] !== undefined) next[key] = clean(input[key])
  }
  if (input.phone !== undefined) {
    const phone = clean(input.phone)
    next.phone = phone ? seal(SEAL, phone) : undefined
  }
  await db
    .update(users)
    .set({
      profile: JSON.parse(JSON.stringify(next)) as UserProfile,
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.handle !== undefined ? { handle: input.handle } : {}),
    })
    .where(eq(users.id, user.id))
  return accountProfile(user)
}

/* ---------- a member's profile in one organization ---------- */

interface Access {
  self: boolean
  /** Staff who see members, or platform staff looking in. */
  staff: boolean
  /** The viewer is this person's parent here. */
  parent: boolean
  /** May see the person's contact details and personal record. */
  personal: boolean
  /** May change the organization's details about them (designation, staff number). */
  edit: boolean
}

async function accessToMember(
  ctx: OrgContext,
  targetId: string,
  groupIds: string[]
): Promise<Access> {
  const self = ctx.user.id === targetId
  const covers = (permission: Parameters<typeof can>[1]) =>
    can(ctx, permission) || groupIds.some((g) => can(ctx, permission, g))
  const [parentLink] = self
    ? []
    : await getDb()
        .select({ id: guardians.id })
        .from(guardians)
        .where(
          and(
            eq(guardians.orgId, ctx.org.id),
            eq(guardians.parentId, ctx.user.id),
            eq(guardians.studentId, targetId)
          )
        )
  const parent = Boolean(parentLink)
  const staff = ctx.platformViewer || covers("org.members.view")
  return {
    self,
    staff,
    parent,
    personal:
      self || parent || staff || covers("students.view") || covers("parents.view"),
    edit: self || ctx.platformAdmin || covers("org.members.manage"),
  }
}

/** Who this person is here, as far as the viewer may see. "me" is the viewer. */
export async function memberProfile(slug: string, viewer: User, id: string) {
  const ctx = await context(slug, viewer)
  const targetId = id === "me" ? viewer.id : id
  const db = getDb()
  const [[person], [membership], seats, parentOf, childOf] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        handle: users.handle,
        profile: users.profile,
      })
      .from(users)
      .where(eq(users.id, targetId)),
    db
      .select()
      .from(orgMembers)
      .where(
        and(eq(orgMembers.orgId, ctx.org.id), eq(orgMembers.userId, targetId))
      ),
    db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .innerJoin(orgGroups, eq(groupMembers.groupId, orgGroups.id))
      .where(
        and(eq(orgGroups.orgId, ctx.org.id), eq(groupMembers.userId, targetId))
      ),
    // Their parents here.
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        relation: guardians.relation,
      })
      .from(guardians)
      .innerJoin(users, eq(guardians.parentId, users.id))
      .where(
        and(eq(guardians.orgId, ctx.org.id), eq(guardians.studentId, targetId))
      ),
    // Their children here, if they're a parent.
    db
      .select({
        id: users.id,
        name: users.name,
        relation: guardians.relation,
      })
      .from(guardians)
      .innerJoin(users, eq(guardians.studentId, users.id))
      .where(
        and(eq(guardians.orgId, ctx.org.id), eq(guardians.parentId, targetId))
      ),
  ])
  // Only members and linked parents have a profile here.
  if (!person || (!membership && childOf.length === 0)) {
    throw notFound("Person not found")
  }
  const groupIds = seats.map((s) => s.groupId)
  // A parent's profile follows their children's groups for who may see it.
  const childGroups = childOf.length
    ? (
        await db
          .select({ groupId: groupMembers.groupId })
          .from(groupMembers)
          .innerJoin(orgGroups, eq(groupMembers.groupId, orgGroups.id))
          .where(
            and(
              eq(orgGroups.orgId, ctx.org.id),
              inArray(
                groupMembers.userId,
                childOf.map((c) => c.id)
              )
            )
          )
      ).map((r) => r.groupId)
    : []
  const access = await accessToMember(ctx, targetId, [
    ...groupIds,
    ...childGroups,
  ])
  // A parent sees their own child; a child sees their parents' names on their own page.
  if (!access.self && !access.staff && !access.parent && !access.personal) {
    throw notFound("Person not found")
  }

  const [roles, teaching, leads, record] = await Promise.all([
    db
      .select({
        name: orgRoles.name,
        systemKey: orgRoles.systemKey,
        groupId: roleAssignments.groupId,
      })
      .from(roleAssignments)
      .innerJoin(orgRoles, eq(roleAssignments.roleId, orgRoles.id))
      .where(
        and(
          eq(roleAssignments.orgId, ctx.org.id),
          eq(roleAssignments.userId, targetId)
        )
      ),
    db
      .select({
        subject: subjects.name,
        code: subjects.code,
        groupId: classSubjects.groupId,
      })
      .from(classSubjects)
      .innerJoin(subjects, eq(classSubjects.subjectId, subjects.id))
      .where(
        and(
          eq(classSubjects.orgId, ctx.org.id),
          eq(classSubjects.teacherId, targetId)
        )
      ),
    db
      .select({ groupId: classTeachers.groupId, year: academicYears.name })
      .from(classTeachers)
      .innerJoin(academicYears, eq(classTeachers.yearId, academicYears.id))
      .where(
        and(
          eq(classTeachers.orgId, ctx.org.id),
          eq(classTeachers.teacherId, targetId),
          eq(academicYears.isCurrent, true)
        )
      ),
    studentRecord(ctx, targetId),
  ])
  const ledGroups = ctx.groups.filter((g) => g.leadId === targetId)
  const profile = person.profile ?? {}
  const details: MemberProfile = membership?.profile ?? {}
  const isStudent =
    record !== null ||
    (membership !== undefined && roles.length === 0 && groupIds.length > 0)
  const isStaff = roles.some((r) => r.systemKey !== "member")
  const memberFields = {
    designation: details.designation ?? "",
    department: details.department ?? "",
    employeeId: details.employeeId ?? "",
    joinedOn: details.joinedOn ?? "",
    phone: access.personal ? (unseal(SEAL, details.phone) ?? "") : "",
  }
  const accountPhone = access.personal ? (unseal(SEAL, profile.phone) ?? "") : ""

  return {
    id: person.id,
    me: access.self,
    name: person.name ?? person.email,
    handle: person.handle,
    email:
      access.personal && !isNoLoginEmail(person.email) ? person.email : null,
    about: {
      headline: profile.headline ?? "",
      bio: profile.bio ?? "",
      city: profile.city ?? "",
      website: profile.website ?? "",
      github: profile.github ?? "",
      linkedin: profile.linkedin ?? "",
      phone: accountPhone,
    },
    kinds: {
      student: isStudent,
      staff: isStaff,
      parent: childOf.length > 0,
    },
    membership: membership
      ? {
          status: membership.status,
          joinedVia: membership.joinedVia,
          since: membership.createdAt,
        }
      : null,
    roles: roles.map((r) => ({
      name: r.name,
      where: r.groupId ? pathName(ctx, r.groupId) : "Whole organization",
    })),
    groups: groupIds.map((g) => ({ id: g, path: pathName(ctx, g) })),
    /** The organization's details about them (staff), editable by them and its staff. */
    details: memberFields,
    teaching: {
      subjects: teaching.map((t) => ({
        subject: t.code ? `${t.subject} (${t.code})` : t.subject,
        group: pathName(ctx, t.groupId),
      })),
      classTeacherOf: leads.map((l) => ({
        group: pathName(ctx, l.groupId),
        year: l.year,
      })),
      leads: ledGroups.map((g) => pathName(ctx, g.id)),
    },
    record: record && access.personal ? record : null,
    parents: access.personal
      ? parentOf.map((p) => ({
          id: p.id,
          name: p.name ?? p.email,
          email: access.staff || access.self ? p.email : null,
          relation: p.relation,
        }))
      : [],
    children: childOf.map((c) => ({
      id: c.id,
      name: c.name ?? "Student",
      relation: c.relation,
    })),
    can: { edit: access.edit, editStaffNumber: access.edit && !access.self },
    completeness: completeness([
      ["name", "Your name", person.name ?? ""],
      ...(isStaff
        ? ([
            ["designation", "Your designation", memberFields.designation],
            ["department", "Your department", memberFields.department],
          ] as [string, string, string][])
        : []),
      [
        "phone",
        "A phone number",
        memberFields.phone || accountPhone || record?.phone || "",
      ],
      ["headline", "A headline (on your account)", profile.headline ?? ""],
    ]),
  }
}

async function studentRecord(ctx: OrgContext, userId: string) {
  const db = getDb()
  const [record] = await db
    .select()
    .from(studentRecords)
    .where(
      and(eq(studentRecords.orgId, ctx.org.id), eq(studentRecords.userId, userId))
    )
  if (!record) return null
  const [current] = await db
    .select({
      year: academicYears.name,
      groupId: enrolments.groupId,
      rollNo: enrolments.rollNo,
      status: enrolments.status,
    })
    .from(enrolments)
    .innerJoin(academicYears, eq(enrolments.yearId, academicYears.id))
    .where(
      and(
        eq(enrolments.orgId, ctx.org.id),
        eq(enrolments.userId, userId),
        eq(academicYears.isCurrent, true)
      )
    )
  return {
    admissionNo: record.admissionNo,
    gender: record.gender,
    birthDate: unseal(RECORD_SEAL, record.birthDate) ?? "",
    phone: unseal(RECORD_SEAL, record.phone) ?? "",
    address: unseal(RECORD_SEAL, record.address) ?? "",
    admittedOn: record.admittedOn,
    current: current
      ? {
          year: current.year,
          group: current.groupId ? pathName(ctx, current.groupId) : null,
          rollNo: current.rollNo,
          status: current.status,
        }
      : null,
  }
}

/**
 * Changes the organization's details about a member: by themselves (designation, department,
 * phone, start date) or by staff who manage members (and the staff number).
 */
export async function updateMemberProfile(
  slug: string,
  viewer: User,
  id: string,
  input: MemberProfileInput
) {
  const ctx = await context(slug, viewer)
  const targetId = id === "me" ? viewer.id : id
  const db = getDb()
  const [membership] = await db
    .select()
    .from(orgMembers)
    .where(
      and(eq(orgMembers.orgId, ctx.org.id), eq(orgMembers.userId, targetId))
    )
  if (!membership) throw notFound("Person not found")
  const groupIds = (
    await db
      .select({ groupId: groupMembers.groupId })
      .from(groupMembers)
      .innerJoin(orgGroups, eq(groupMembers.groupId, orgGroups.id))
      .where(
        and(eq(orgGroups.orgId, ctx.org.id), eq(groupMembers.userId, targetId))
      )
  ).map((r) => r.groupId)
  const access = await accessToMember(ctx, targetId, groupIds)
  if (!access.edit) {
    if (access.staff || access.personal)
      throw new ApiError(
        403,
        "forbidden",
        "Changing someone's details needs \"Manage members\"."
      )
    throw notFound("Person not found")
  }
  if (input.employeeId !== undefined && access.self && !ctx.platformAdmin) {
    const before = membership.profile?.employeeId ?? ""
    if ((input.employeeId.trim() || "") !== before)
      throw new ApiError(
        403,
        "staff_number",
        "Your staff number is set by the organization's office."
      )
  }
  const before: MemberProfile = membership.profile ?? {}
  const next: MemberProfile = { ...before }
  for (const key of [
    "designation",
    "department",
    "employeeId",
    "joinedOn",
  ] as const) {
    if (input[key] !== undefined) next[key] = clean(input[key])
  }
  if (input.phone !== undefined) {
    const phone = clean(input.phone)
    next.phone = phone ? seal(SEAL, phone) : undefined
  }
  const stored = JSON.parse(JSON.stringify(next)) as MemberProfile
  await db.transaction(async (tx) => {
    await tx
      .update(orgMembers)
      .set({ profile: stored })
      .where(
        and(eq(orgMembers.orgId, ctx.org.id), eq(orgMembers.userId, targetId))
      )
    if (!access.self) {
      const changed = (["designation", "department", "employeeId", "joinedOn"] as const)
        .filter((k) => before[k] !== stored[k])
        .map((k) => ({ designation: "designation", department: "department", employeeId: "staff number", joinedOn: "start date" })[k])
      if (input.phone !== undefined && before.phone !== stored.phone) changed.push("phone")
      if (changed.length)
        await audit(
          tx,
          ctx,
          "member.profile",
          `Changed a member's ${changed.join(", ")}`,
          { userId: targetId }
        )
    }
  })
  return memberProfile(slug, viewer, id)
}
