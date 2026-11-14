import { getDb, orgHolidays, sql, type User } from "@workspace/db"
import { readTimetableSettings } from "@workspace/judge"
import { z } from "zod"

import { canFor, needFor, orgContext, writeAudit } from "@/features/orgs/server"
import { ApiError, notFound } from "@/lib/api/route"

/*
 * Holidays: the days an organization is closed. Everyone in it sees them on their calendar;
 * homes don't ask for registers on them. Those who manage the organization's settings keep
 * the list.
 */

const { and, asc, eq, gte, inArray, lte } = sql

const DAY = /^\d{4}-\d{2}-\d{2}$/

export const holidaySchema = z
  .object({
    name: z.string().trim().min(1, "Name the holiday.").max(80),
    startsOn: z.string().regex(DAY, "Choose the first day."),
    endsOn: z.string().regex(DAY, "Choose the last day."),
  })
  .refine((h) => h.endsOn >= h.startsOn, {
    message: "The last day can't be before the first.",
    path: ["endsOn"],
  })

export interface Holiday {
  id: string
  name: string
  startsOn: string
  endsOn: string
}

const view = (h: typeof orgHolidays.$inferSelect): Holiday => ({
  id: h.id,
  name: h.name,
  startsOn: h.startsOn,
  endsOn: h.endsOn,
})

/** This organization's holidays, earliest first; anyone in it may read them. */
export async function listHolidays(slug: string, user: User) {
  const ctx = await orgContext(slug, user)
  const rows = await getDb()
    .select()
    .from(orgHolidays)
    .where(eq(orgHolidays.orgId, ctx.org.id))
    .orderBy(asc(orgHolidays.startsOn))
  return {
    holidays: rows.map(view),
    canEdit: canFor(ctx, "org.settings.manage", []),
  }
}

export async function addHoliday(
  slug: string,
  user: User,
  input: z.infer<typeof holidaySchema>
) {
  const ctx = await orgContext(slug, user)
  needFor(ctx, "org.settings.manage", [])
  const days =
    (Date.parse(`${input.endsOn}T00:00:00Z`) -
      Date.parse(`${input.startsOn}T00:00:00Z`)) /
      86_400_000 +
    1
  if (days > 92)
    throw new ApiError(
      400,
      "too_long",
      "A holiday can be at most three months."
    )
  const [row] = await getDb()
    .insert(orgHolidays)
    .values({ orgId: ctx.org.id, ...input })
    .returning()
  await writeAudit(
    ctx,
    "holiday.add",
    `Added the holiday ${input.name} (${input.startsOn}${input.endsOn !== input.startsOn ? ` to ${input.endsOn}` : ""})`
  )
  return view(row!)
}

export async function deleteHoliday(slug: string, user: User, id: string) {
  const ctx = await orgContext(slug, user)
  needFor(ctx, "org.settings.manage", [])
  if (!z.uuid().safeParse(id).success) throw notFound("Holiday not found")
  const [row] = await getDb()
    .delete(orgHolidays)
    .where(and(eq(orgHolidays.id, id), eq(orgHolidays.orgId, ctx.org.id)))
    .returning()
  if (!row) throw notFound("Holiday not found")
  await writeAudit(ctx, "holiday.delete", `Removed the holiday ${row.name}`)
}

/** The holiday covering a day in an organization, if any (for homes and registers). */
export async function holidayOn(orgId: string, day: string) {
  const [row] = await getDb()
    .select({ name: orgHolidays.name })
    .from(orgHolidays)
    .where(
      and(
        eq(orgHolidays.orgId, orgId),
        lte(orgHolidays.startsOn, day),
        gte(orgHolidays.endsOn, day)
      )
    )
    .limit(1)
  return row?.name ?? null
}

/** Holidays of these organizations touching a span of days (for calendars). */
export async function holidaysBetween(
  orgIds: string[],
  from: string,
  to: string
) {
  if (orgIds.length === 0) return []
  return getDb()
    .select({
      id: orgHolidays.id,
      orgId: orgHolidays.orgId,
      name: orgHolidays.name,
      startsOn: orgHolidays.startsOn,
      endsOn: orgHolidays.endsOn,
    })
    .from(orgHolidays)
    .where(
      and(
        inArray(orgHolidays.orgId, orgIds),
        lte(orgHolidays.startsOn, to),
        gte(orgHolidays.endsOn, from)
      )
    )
}

/**
 * Whether a day is off for an organization, and why: a holiday by name, or not one of its
 * school days (Timetable › days; Monday to Friday unless set). Homes ask for no registers,
 * lessons or check-ins on a day off.
 */
export async function dayOff(
  org: { id: string; moduleSettings: unknown },
  day: string
): Promise<{ holiday: string | null; label: string } | null> {
  const holiday = await holidayOn(org.id, day)
  if (holiday) return { holiday, label: `Holiday: ${holiday}` }
  const weekday = ((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7) + 1
  if (!readTimetableSettings(org.moduleSettings).days.includes(weekday))
    return { holiday: null, label: "Not a school day" }
  return null
}
