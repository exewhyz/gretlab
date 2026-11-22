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
    description:
      "The site's name: in the top bar, page titles, search results and link previews.",
    group: "Site",
    schema: z.string().trim().min(1).max(80),
    default: "GretLab" as string,
  },
  "seo.site_url": {
    label: "Site address",
    description:
      "The public address search engines and link previews use: canonical links, the sitemap, structured data and share cards. Without a slash at the end.",
    group: "Search engines",
    schema: z
      .string()
      .trim()
      .regex(
        /^https?:\/\/[^\s/]+(\/[^\s]*[^\s/])?$/,
        "A full address such as https://gretlab.grettech.com, without a slash at the end"
      ),
    default: "https://gretlab.grettech.com" as string,
  },
  "seo.description": {
    label: "Site description",
    description:
      "What search results and link previews say about the site, for pages without their own. About 150 characters reads best.",
    group: "Search engines",
    schema: z.string().trim().min(20).max(300),
    default:
      "GretLab runs a school, college or training program's day (attendance, timetables, leave, records, exams and report cards) with a coding lab built in: practice problems, graded assignments, lab exams and contests judged in a secure sandbox." as string,
  },
  "seo.tagline": {
    label: "Tagline",
    description:
      "One line: the home page's title and the share card's headline.",
    group: "Search engines",
    schema: z.string().trim().min(3).max(80),
    default: "The coding lab and the school day, in one place" as string,
  },
  "seo.indexing": {
    label: "Let search engines index the site",
    description:
      "Off: every page asks search engines not to index it and robots.txt turns crawlers away. For a staging or private copy.",
    group: "Search engines",
    schema: z.boolean(),
    default: true,
  },
  "seo.google_verification": {
    label: "Google Search Console code",
    description:
      "The content of the HTML tag Search Console gives you to verify the site (google-site-verification). Empty: none.",
    group: "Search engines",
    schema: z.string().trim().max(100),
    default: "" as string,
  },
  "seo.bing_verification": {
    label: "Bing Webmaster Tools code",
    description:
      "The content of the msvalidate.01 tag Bing gives you to verify the site. Empty: none.",
    group: "Search engines",
    schema: z.string().trim().max(100),
    default: "" as string,
  },
  "landing.contact_email": {
    label: "Contact email for organizations",
    description:
      'Where the landing page\'s "Talk to us" button writes to when school sign-up is off: whoever answers schools and colleges asking to join. Empty: the button offers to create an account instead.',
    group: "Landing page",
    schema: z.union([z.literal(""), z.string().trim().email().max(200)]),
    default: "" as string,
  },
  "legal.operator": {
    label: "Who runs the site",
    description:
      "The person or company responsible for the site, as the privacy policy and terms name it. Empty: the site's name.",
    group: "Legal",
    schema: z.string().trim().max(120),
    default: "" as string,
  },
  "legal.email": {
    label: "Contact email",
    description:
      "Where people send privacy requests, complaints and questions about the terms. Shown on both pages.",
    group: "Legal",
    schema: z.union([z.literal(""), z.string().trim().email().max(200)]),
    default: "" as string,
  },
  "legal.grievance_officer": {
    label: "Grievance officer",
    description:
      "The name of the person who answers privacy complaints (India's DPDP Act and IT Rules ask for one). Empty: not named.",
    group: "Legal",
    schema: z.string().trim().max(120),
    default: "" as string,
  },
  "legal.address": {
    label: "Postal address",
    description: "Where letters reach whoever runs the site. Empty: not shown.",
    group: "Legal",
    schema: z.string().trim().max(300),
    default: "" as string,
  },
  "legal.jurisdiction": {
    label: "Governing law",
    description:
      "Whose laws the terms follow and whose courts hear disputes, such as India or Bengaluru, India.",
    group: "Legal",
    schema: z.string().trim().min(2).max(120),
    default: "India" as string,
  },
  "server_execution.enabled": {
    label: "Server execution",
    description:
      "Signed-in students run and submit code on the server sandbox. Turning it off stops server runs at once. Students can still run Python and JavaScript in their browser if that's on below, and Submit works only where grading in the browser is allowed.",
    group: "Execution",
    schema: z.boolean(),
    default: true,
  },
  "browser_execution.enabled": {
    label: "Run in the browser",
    description:
      "Python and JavaScript run in the visitor's own browser for anyone who isn't signed in, and for everyone while server execution is off. It costs nothing and touches no server. Used in contests only when a contest chooses it.",
    group: "Execution",
    schema: z.boolean(),
    default: true,
  },
  "browser_execution.grading": {
    label: "Grade in the browser",
    description:
      "Lets Submit work without the server, for Python and JavaScript: the browser runs every test's input and the server checks the output, so expected outputs never leave the server, though hidden inputs reach the student's browser. Such verdicts are provisional and are judged again on the server once it's back. Used for library practice while server execution is off, and by organizations that turn it on for their own work.",
    group: "Execution",
    schema: z.boolean(),
    default: false,
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
  // Judge machines (Dashboard › Judges, "Judge settings"): kept off the Settings page.
  "judges.max_running": {
    label: "Judges at once",
    description:
      "How many judge machines started from the dashboard may run at the same time. Each costs money while it runs.",
    group: "Judges",
    schema: z.number().int().min(0).max(50),
    default: 3,
  },
  "judges.size": {
    label: "Machine size",
    description:
      "What new judge machines are. Larger ones run more code at once and cost more. Prices are AWS's on-demand rates in Sydney (checked 22 November 2026). The AWS role allows only these.",
    group: "Judges",
    schema: z.enum([
      "c7i-flex.large",
      "c7i-flex.xlarge",
      "c7i.large",
      "c7i.xlarge",
    ]),
    default: "c7i-flex.large" as
      "c7i-flex.large" | "c7i-flex.xlarge" | "c7i.large" | "c7i.xlarge",
    choices: {
      "c7i-flex.large": "c7i-flex.large: 2 vCPUs, 4 GB (about US$0.11 an hour)",
      "c7i-flex.xlarge":
        "c7i-flex.xlarge: 4 vCPUs, 8 GB (about US$0.22 an hour)",
      "c7i.large":
        "c7i.large: 2 vCPUs, 4 GB, full speed always (about US$0.12 an hour)",
      "c7i.xlarge":
        "c7i.xlarge: 4 vCPUs, 8 GB, full speed always (about US$0.23 an hour)",
    },
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
  "orgs.self_signup": {
    label: "School sign-up",
    description:
      "Whether people can register their own school, college or cohort from the site. Reviewed: it waits for a platform admin to approve it before anyone can use it. Open: it's ready at once.",
    group: "Accounts",
    schema: z.enum(["off", "review", "open"]),
    choices: {
      off: "Off: platform admins create them",
      review: "Reviewed: an admin approves each",
      open: "Open: ready at once",
    },
    default: "off" as "off" | "review" | "open",
  },
  "registration.allowed_email_domains": {
    label: "Allowed email domains",
    description:
      "Only these domains may register, such as college.edu. Leave empty to allow any.",
    group: "Accounts",
    schema: z.array(z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)).max(50),
    default: [] as string[],
  },
  "security.require_2fa": {
    label: "Require two-factor sign-in",
    description:
      "Who must use an authenticator app as well as Google to sign in. Anyone may turn it on for themselves.",
    group: "Accounts",
    schema: z.enum(["off", "staff", "everyone"]),
    default: "off" as "off" | "staff" | "everyone",
    choices: {
      off: "No one",
      staff:
        "Staff: platform staff and anyone with a role that manages something",
      everyone: "Everyone",
    },
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
