import { route } from "@/lib/api/route"
import { getLanguages, getSettings } from "@/features/settings/server"
import { teachesAnywhere } from "@/features/teaching/server"
import { platformAccess } from "@/features/platform/access"

/** Everything the client needs to decide what to offer this viewer. */
export const GET = route({ access: "public" }, async ({ user }) => {
  const [settings, languages, teaches, platform] = await Promise.all([
    getSettings(),
    getLanguages(),
    user ? teachesAnywhere(user) : false,
    platformAccess(user),
  ])
  return {
    siteTitle: settings["site.title"],
    user: user && {
      id: user.id,
      handle: user.handle ?? user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      /** Teaches in some organization, so the Teach page has something to show. */
      teaches,
      /** What they may do on the platform dashboard; empty for everyone else. */
      platform: {
        permissions: platform.permissions,
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
