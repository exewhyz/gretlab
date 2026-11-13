import type { User } from "@workspace/db"

import { listAssignments } from "@/features/assignments/server"
import { getDaily, getProfile, today } from "@/features/catalog/server"
import { listContests } from "@/features/contests/server"
import { myOrganizations } from "@/features/orgs/server"
import { myChildren } from "@/features/parents/server"
import { getSettings } from "@/features/settings/server"

/*
 * A signed-in person's home across everything they belong to: their schools and classes
 * (and children), work due, contests coming, practice progress with the streak and the
 * daily challenge, and what they did lately. Each part is left out when its feature is off,
 * and a part that fails never breaks the page.
 */

const DAY_MS = 86_400_000
const quiet = <T>(p: Promise<T>, fallback: T) => p.catch(() => fallback)

export async function memberDashboard(user: User) {
  const settings = await getSettings()
  const practice = settings["practice.enabled"]
  const [day, orgs, children, work, contests, profile, daily] =
    await Promise.all([
      today(),
      quiet(myOrganizations(user), []),
      quiet(myChildren(user), []),
      settings["assignments.enabled"]
        ? quiet(listAssignments(user), [])
        : Promise.resolve([]),
      settings["contests.enabled"]
        ? quiet(listContests(user), [])
        : Promise.resolve([]),
      practice ? quiet(getProfile(user.id), null) : Promise.resolve(null),
      practice && settings["daily.enabled"]
        ? quiet(getDaily(user), null)
        : Promise.resolve(null),
    ])
  const now = Date.now()
  const open = work
    .filter(
      (a) =>
        a.published &&
        a.phase === "open" &&
        !(a.total > 0 && a.earned >= a.total)
    )
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
  const coming = contests
    .filter(
      (c) =>
        c.phase === "live" ||
        (c.phase === "upcoming" &&
          new Date(c.startsAt).getTime() - now < 21 * DAY_MS)
    )
    .sort(
      (a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()
    )
  // The last 12 weeks of activity, oldest first, for a small heatmap.
  const days = Array.from({ length: 84 }, (_, i) =>
    new Date(Date.parse(`${day}T00:00:00Z`) - (83 - i) * DAY_MS)
      .toISOString()
      .slice(0, 10)
  )
  return {
    day,
    name: user.name ?? user.handle ?? user.email,
    handle: user.handle,
    features: {
      practice,
      assignments: settings["assignments.enabled"],
      contests: settings["contests.enabled"],
      profiles: settings["profiles.enabled"],
    },
    orgs: orgs
      .filter((o) => o.status === "active")
      .map((o) => ({
        slug: o.slug,
        name: o.name,
        type: o.type,
        roles: o.roles,
      })),
    pendingOrgs: orgs
      .filter((o) => o.status === "pending")
      .map((o) => ({ slug: o.slug, name: o.name })),
    children: children.map((c) => ({ id: c.id, name: c.name, org: c.org })),
    work: {
      open: open.length,
      dueThisWeek: open.filter(
        (a) => new Date(a.dueAt).getTime() - now < 7 * DAY_MS
      ).length,
      overdue: work.filter(
        (a) =>
          a.published &&
          a.phase === "late" &&
          !(a.total > 0 && a.earned >= a.total)
      ).length,
      next: open.slice(0, 5).map((a) => ({
        slug: a.slug,
        title: a.title,
        exam: a.exam,
        org: a.org?.name ?? null,
        dueAt: new Date(a.dueAt).toISOString(),
        solved: a.solved,
        problemCount: a.problemCount,
        earned: a.earned,
        total: a.total,
      })),
    },
    contests: coming.slice(0, 3).map((c) => ({
      slug: c.slug,
      title: c.title,
      phase: c.phase,
      startsAt: new Date(c.startsAt).toISOString(),
      org: c.org?.name ?? null,
    })),
    practice: profile
      ? {
          solved: profile.solved,
          solvedBy: profile.solvedBy,
          totalBy: profile.totalBy,
          streak: profile.streak,
          activity: days.map((d) => ({
            day: d,
            count: Number(profile.heatmap[d] ?? 0),
          })),
          recent: profile.recent.slice(0, 5).map((r) => ({
            slug: r.slug,
            title: r.title,
            at: new Date(r.at).toISOString(),
          })),
        }
      : null,
    daily: daily
      ? {
          problem: daily.problem,
          solvedToday: daily.solvedToday,
          streak: daily.streak,
        }
      : null,
  }
}
