import { orgHolidays, organizations, sql } from "../index.ts"

import { TODAY, db, day, insertAll } from "./shared.ts"

/*
 * Holidays for the organizations that keep a calendar (school, college, coaching): a break
 * that just ended, one coming up, and the national days in the year ahead.
 */

/** The next date (on or after today) that falls on this month and day. */
function next(month: number, date: number) {
  const y = TODAY.getUTCFullYear()
  const pad = (n: number) => String(n).padStart(2, "0")
  const thisYear = `${y}-${pad(month)}-${pad(date)}`
  return thisYear >= day(0) ? thisYear : `${y + 1}-${pad(month)}-${pad(date)}`
}

export async function buildHolidays() {
  const orgs = await db
    .select({ id: organizations.id, slug: organizations.slug })
    .from(organizations)
    .where(sql.inArray(organizations.slug, ["greenwood", "northfield", "apex"]))
  const national = [
    { name: "Republic Day", startsOn: next(1, 26), endsOn: next(1, 26) },
    { name: "Independence Day", startsOn: next(8, 15), endsOn: next(8, 15) },
    { name: "Gandhi Jayanti", startsOn: next(10, 2), endsOn: next(10, 2) },
    { name: "Christmas", startsOn: next(12, 25), endsOn: next(12, 25) },
  ]
  const rows = orgs.flatMap((o) => [
    ...national.map((h) => ({ orgId: o.id, ...h })),
    { orgId: o.id, name: "Diwali break", startsOn: day(-12), endsOn: day(-8) },
    {
      orgId: o.id,
      name: o.slug === "northfield" ? "Semester break" : "Winter break",
      startsOn: day(38),
      endsOn: day(46),
    },
  ])
  await insertAll(orgHolidays, rows)
  console.log(`  holidays: ${rows.length} across ${orgs.length} organizations`)
}
