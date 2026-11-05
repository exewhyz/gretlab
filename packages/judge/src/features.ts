import { z } from "zod"

/**
 * Everything an admin can switch or tune from the dashboard. To add a setting, add it
 * here with a default and a label; the dashboard and API pick it up automatically.
 * Enforce it on the server with requireFeature() or getSettings(), not only in the UI.
 */
export const SETTINGS = {
  "site.timezone": {
    label: "Timezone",
    description:
      "Decides when a day starts, for daily challenges and streaks. An IANA name, such as Asia/Kolkata.",
    group: "Site",
    schema: z.string().refine((zone) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: zone })
        return true
      } catch {
        return false
      }
    }, "Unknown timezone"),
    default: "UTC" as string,
  },
  "site.title": {
    label: "Site title",
    description: "Shown in the top bar.",
    group: "Site",
    schema: z.string().trim().min(1).max(80),
    default: "Python Practice Lab" as string,
  },
  "server_execution.enabled": {
    label: "Server execution",
    description:
      "Signed-in students run and submit code on the server sandbox. Turning it off stops server runs at once and pauses Submit; students can still run Python in their browser if that's on below.",
    group: "Execution",
    schema: z.boolean(),
    default: true,
  },
  "browser_execution.enabled": {
    label: "Run in the browser",
    description:
      "Python runs in the visitor's own browser for anyone who isn't signed in, and for everyone while server execution is off. It costs nothing and touches no server. Never used in contests.",
    group: "Execution",
    schema: z.boolean(),
    default: true,
  },
  "submissions.per_minute": {
    label: "Submissions per student per minute",
    description: "Protects the server from one student flooding the queue.",
    group: "Execution",
    schema: z.number().int().min(1).max(600),
    default: 12,
  },
  "submissions.max_pending": {
    label: "Unfinished submissions per student",
    description:
      "How many of one student's runs may wait in the queue at once.",
    group: "Execution",
    schema: z.number().int().min(1).max(50),
    default: 3,
  },
  "queue.max_depth": {
    label: "Queue limit",
    description:
      "When this many jobs are waiting, new Runs are politely refused until it drains. Submits are still accepted, up to twice this many.",
    group: "Execution",
    schema: z.number().int().min(10).max(1_000_000),
    default: 1000,
  },
  "submissions.run_retention_days": {
    label: "Keep plain runs for (days)",
    description:
      "Runs only show a student their output, so old ones are deleted. Graded submissions are always kept.",
    group: "Execution",
    schema: z.number().int().min(1).max(3650),
    default: 30,
  },
  "registration.enabled": {
    label: "Open registration",
    description:
      "New people can create an account by signing in. Turn off once your class has joined.",
    group: "Accounts",
    schema: z.boolean(),
    default: true,
  },
  "registration.allowed_email_domains": {
    label: "Allowed email domains",
    description:
      "Only these domains may register, such as college.edu. Leave empty to allow any.",
    group: "Accounts",
    schema: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).max(50),
    default: [] as string[],
  },
  "practice.enabled": {
    label: "Practice problems",
    description: "The public problem list. Turn off to run contests only.",
    group: "Features",
    schema: z.boolean(),
    default: true,
  },
  "practice.show_solutions": {
    label: "Show reference solutions",
    description:
      "Let signed-in students reveal the reference solution. Always hidden while a contest uses the problem.",
    group: "Features",
    schema: z.boolean(),
    default: true,
  },
  "practice.solutions_after_solve": {
    label: "Editorials only after solving",
    description:
      "Students see a problem's editorial and solution only once they've solved it themselves.",
    group: "Features",
    schema: z.boolean(),
    default: true,
  },
  "daily.enabled": {
    label: "Daily challenge",
    description:
      "One problem a day for everyone, with streaks. Schedule them in Daily, or a problem is picked automatically.",
    group: "Features",
    schema: z.boolean(),
    default: true,
  },
  "lists.enabled": {
    label: "Favorites and lists",
    description: "Students can save problems to favorites and their own lists.",
    group: "Features",
    schema: z.boolean(),
    default: true,
  },
  "profiles.enabled": {
    label: "Profiles and leaderboard",
    description:
      "Public profiles with stats, streaks and badges, and a leaderboard of problems solved. Only signed-in users can see them.",
    group: "Features",
    schema: z.boolean(),
    default: true,
  },
  "assignments.enabled": {
    label: "Assignments",
    description:
      "Problem sets with a due date, graded automatically, with a gradebook you can download as CSV.",
    group: "Features",
    schema: z.boolean(),
    default: true,
  },
  "contests.enabled": {
    label: "Contests",
    description: "Contest pages, registration and leaderboards.",
    group: "Features",
    schema: z.boolean(),
    default: true,
  },
  "ads.enabled": {
    label: "Advertising",
    description:
      "Show ads on public problem pages. Ads also need the AdSense IDs set on the host.",
    group: "Features",
    schema: z.boolean(),
    default: true,
  },
} as const

export type SettingKey = keyof typeof SETTINGS
export type Settings = {
  [K in SettingKey]: z.infer<(typeof SETTINGS)[K]["schema"]>
}

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[]

export function defaultSettings(): Settings {
  return Object.fromEntries(
    SETTING_KEYS.map((key) => [key, SETTINGS[key].default])
  ) as Settings
}

/** Stored values over defaults. Anything invalid or removed falls back to its default. */
export function resolveSettings(stored: Record<string, unknown>): Settings {
  const settings = defaultSettings() as Record<string, unknown>
  for (const key of SETTING_KEYS) {
    const parsed = SETTINGS[key].schema.safeParse(stored[key])
    if (parsed.success) settings[key] = parsed.data
  }
  return settings as Settings
}

export function emailDomainAllowed(email: string, domains: string[]): boolean {
  if (!domains.length) return true
  const domain = email.toLowerCase().split("@").pop() ?? ""
  return domains.includes(domain)
}
