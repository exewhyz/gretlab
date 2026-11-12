import { expandPlatformPermissions } from "@workspace/judge"
import { route } from "@/lib/api/route"
import { getLanguages, getSettings } from "@/features/settings/server"
import { teachesAnywhere } from "@/features/teaching/server"
import { platformAccess } from "@/features/platform/access"
import { isParent } from "@/features/parents/server"
import { readSession } from "@/features/auth/current-user"
import { mustUseTwoFactor } from "@/features/auth/two-factor"

/** Everything the client needs to decide what to offer this viewer. */
export const GET = route({ access: "public" }, async ({ user }) => {
  const session = await readSession()
  const [settings, languages, teaches, platform, parent, required] = await Promise.all([
    getSettings(),
    getLanguages(),
    user ? teachesAnywhere(user) : false,
    platformAccess(user),
    user ? isParent(user.id) : false,
    user && !session.twoFactor ? mustUseTwoFactor(user) : false,
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
  }
})
