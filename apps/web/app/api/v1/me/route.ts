import type { User } from "@workspace/db"
import { expandPlatformPermissions } from "@workspace/judge"
import { route } from "@/lib/api/route"
import { getLanguages, getSettings } from "@/features/settings/server"
import { teachesAnywhere } from "@/features/teaching/server"
import { platformAccess } from "@/features/platform/access"
import { isParent } from "@/features/parents/server"
import { readSession } from "@/features/auth/current-user"
import { mustUseTwoFactor } from "@/features/auth/two-factor"
import { myOrganizations } from "@/features/orgs/server"
import { myActiveExam } from "@/features/exams/server"
import { myNotifications } from "@/features/notifications/server"

/**
 * What every page's frame asks for next (`?frame=1`, sent on a page's first load): your
 * organizations, the exam you're sitting, and the bell. Sent with /me so a first load is one
 * trip instead of two in a row; the same functions answer /me/orgs, /me/exam and
 * /me/notifications, which the frame uses from then on.
 */
async function frameFor(user: User) {
  const [orgs, exam, notifications] = await Promise.all([
    myOrganizations(user),
    myActiveExam(user),
    myNotifications(user),
  ])
  return { orgs, exam, notifications }
}

/** Everything the client needs to decide what to offer this viewer. */
export const GET = route({ access: "public" }, async ({ user, query }) => {
  const session = await readSession()
  const mustEnroll =
    user && !session.twoFactor ? mustUseTwoFactor(user) : Promise.resolve(false)
  // Not for someone who must turn two-factor on first: every other route refuses them too.
  const frame = async () =>
    user && query.get("frame") === "1" && !(await mustEnroll)
      ? frameFor(user)
      : null
  const [settings, languages, teaches, platform, parent, required, framed] =
    await Promise.all([
      getSettings(),
      getLanguages(),
      user ? teachesAnywhere(user) : false,
      platformAccess(user),
      user ? isParent(user.id) : false,
      mustEnroll,
      frame(),
    ])
  return {
    siteTitle: settings["site.title"],
    /** Signed in with Google, still owing the second step: finish at /sign-in/continue. */
    twoFactorPending: Boolean(session.pending),
    user: user && {
      id: user.id,
      handle: user.handle ?? user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      /** Teaches in some organization, so the Teach page has something to show. */
      teaches,
      /** Linked to a child as their parent (Parent accounts), so "My children" is offered. */
      parent,
      /** Two-factor sign-in: whether it's on, and whether they must turn it on now. */
      security: { twoFactor: session.twoFactor, mustEnroll: required },
      /** What they may do on the platform dashboard; empty for everyone else. */
      platform: {
        permissions: expandPlatformPermissions(platform.permissions),
        role: platform.role?.name ?? null,
        owner: platform.owner,
      },
    },
    features: {
      serverExecution: settings["server_execution.enabled"],
      browserExecution: settings["browser_execution.enabled"],
      showSolutions: settings["practice.show_solutions"],
      contests: settings["contests.enabled"],
      assignments: settings["assignments.enabled"],
      daily: settings["daily.enabled"],
      lists: settings["lists.enabled"],
      profiles: settings["profiles.enabled"],
      practice: settings["practice.enabled"],
    },
    languages: languages.filter((language) => language.enabled),
    /** With `?frame=1`, for a signed-in person: see frameFor. Otherwise null. */
    frame: framed,
  }
})
