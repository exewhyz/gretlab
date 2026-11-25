import { z } from "zod"

import { DEFAULT_FEEDBACK_QUESTIONS } from "./feedback.ts"

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
  "limits.max_time_ms": {
    label: "Highest time limit an organization may set (ms)",
    description:
      "Organizations set each language's time limit for their own work under Manage › Settings, up or down from the defaults on Languages, but never past this.",
    group: "Execution",
    schema: z.number().int().min(100).max(60_000),
    default: 10_000,
  },
  "limits.max_memory_mb": {
    label: "Highest memory limit an organization may set (MB)",
    description:
      "The same for memory. Each judge only takes work that fits its memory, so a high limit means fewer submissions judged at once.",
    group: "Execution",
    schema: z.number().int().min(32).max(4096),
    default: 1024,
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
  "alerts.enabled": {
    label: "Monitoring alerts",
    description:
      "Email the people with \"Get monitoring alerts\" when something on Dashboard › Monitoring goes wrong, and again when it's fixed. Critical problems at once, warnings once they've lasted 5 minutes.",
    group: "Alerts",
    schema: z.boolean(),
    default: true,
  },
  "alerts.cost_limit": {
    label: "Cost alert (US$ a month)",
    description:
      "An alert when this month's judge machines are forecast to cost more than this (Dashboard › Costs). 0 is off.",
    group: "Alerts",
    schema: z.number().min(0).max(100_000),
    default: 0,
  },
  // Plans and billing (Dashboard › Plans; packages/judge/src/billing.ts): kept off the Settings page.
  "billing.enabled": {
    label: "Billing",
    description:
      "Organizations choose and pay for a plan. Off: nothing is limited and nothing is charged. Organizations from before billing keep everything until a plan is set for them.",
    group: "Billing",
    schema: z.boolean(),
    default: false,
  },
  "billing.prices": {
    label: "Feature prices",
    description:
      "Rupees per student per year, for each feature. Missing: the launch price.",
    group: "Billing",
    schema: z.record(z.string(), z.number().int().min(0).max(100_000)),
    default: {} as Record<string, number>,
  },
  "billing.staff_price": {
    label: "Staff price",
    description: "Rupees a year for each staff member past the free ones.",
    group: "Billing",
    schema: z.number().int().min(0).max(100_000),
    default: 300,
  },
  "billing.free_staff_per": {
    label: "Free staff",
    description: "One staff member free for every this many students.",
    group: "Billing",
    schema: z.number().int().min(1).max(1000),
    default: 15,
  },
  "billing.steps": {
    label: "Volume steps",
    description:
      "Percent off the student part past each number of students, like tax slabs: [students up to, percent off], the last up to null.",
    group: "Billing",
    schema: z
      .array(
        z.tuple([
          z.number().int().min(1).nullable(),
          z.number().int().min(0).max(90),
        ])
      )
      .min(1)
      .max(10),
    default: [
      [300, 0],
      [1000, 10],
      [3000, 15],
      [null, 20],
    ] as [number | null, number][],
  },
  "billing.semester_percent": {
    label: "Semester surcharge",
    description:
      "Percent added to half the yearly price for paying by the semester.",
    group: "Billing",
    schema: z.number().int().min(0).max(100),
    default: 10,
  },
  "billing.month_percent": {
    label: "Monthly surcharge",
    description:
      "Percent added to a twelfth of the yearly price for paying by the month.",
    group: "Billing",
    schema: z.number().int().min(0).max(100),
    default: 25,
  },
  "billing.quote_above": {
    label: "Custom quote above",
    description:
      "More students than this: the builder asks them to contact you.",
    group: "Billing",
    schema: z.number().int().min(100).max(1_000_000),
    default: 10_000,
  },
  "billing.judge_price": {
    label: "Own judge machine",
    description:
      "Rupees a year for an organization's own judge machine (class hours).",
    group: "Billing",
    schema: z.number().int().min(0).max(10_000_000),
    default: 72_000,
  },
  "billing.storage_price": {
    label: "Storage",
    description: "Rupees a year for each 50 GB past what's included.",
    group: "Billing",
    schema: z.number().int().min(0).max(1_000_000),
    default: 500,
  },
  "billing.free_students": {
    label: "Free plan: students",
    description: "How many students the free plan allows.",
    group: "Billing",
    schema: z.number().int().min(0).max(10_000),
    default: 50,
  },
  "billing.free_staff": {
    label: "Free plan: staff",
    description: "How many staff the free plan allows.",
    group: "Billing",
    schema: z.number().int().min(0).max(1000),
    default: 5,
  },
  "billing.gst_registered": {
    label: "Registered for GST",
    description:
      "Invoices charge GST (CGST and SGST in your state, IGST across states).",
    group: "Billing",
    schema: z.boolean(),
    default: false,
  },
  "billing.usd_rate": {
    label: "Rupees to the US dollar",
    description:
      "For Revenue: judge machines are billed in US$. Change it when the rate moves.",
    group: "Billing",
    schema: z.number().int().min(1).max(1000),
    default: 88,
  },
  "billing.gst_rate": {
    label: "GST rate",
    description: "Percent; 18 for software services.",
    group: "Billing",
    schema: z.number().int().min(0).max(28),
    default: 18,
  },
  "billing.gstin": {
    label: "Your GSTIN",
    description: "On every invoice; its first two digits are your state.",
    group: "Billing",
    schema: z.string().trim().max(15),
    default: "",
  },
  // The feedback form (Dashboard › Feedback form): kept off the Settings page.
  "feedback.questions": {
    label: "Feedback form",
    description:
      "The questions every new feedback round starts with; each round may change its own.",
    group: "Feedback",
    schema: z
      .array(
        z.object({
          id: z
            .string()
            .trim()
            .min(1)
            .max(40)
            .regex(/^[\w-]+$/),
          kind: z.enum(["rating", "comment"]),
          text: z.string().trim().min(1).max(200),
        })
      )
      .min(1)
      .max(20),
    default: DEFAULT_FEEDBACK_QUESTIONS,
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
  "judges.autoscale": {
    label: "Automatic scaling",
    description:
      "Start shared judges when work waits or an exam is about to open, and end the ones it started once they're idle. Off: only people start and stop judges.",
    group: "Judges",
    schema: z.boolean(),
    default: false,
  },
  "judges.min_shared": {
    label: "Judges for everyone, at least",
    description:
      "Shared judges kept online even when quiet, judges set up by hand included.",
    group: "Judges",
    schema: z.number().int().min(0).max(20),
    default: 1,
  },
  "judges.scale_up_seconds": {
    label: "Start another after work waits (seconds)",
    description:
      "How long shared work may wait for a judge before another starts.",
    group: "Judges",
    schema: z.number().int().min(10).max(3600),
    default: 30,
  },
  "judges.idle_minutes": {
    label: "End an idle judge after (minutes)",
    description:
      "How long a judge started by automatic scaling may have nothing to do before it's ended.",
    group: "Judges",
    schema: z.number().int().min(5).max(1440),
    default: 20,
  },
  "judges.exam_students_per_judge": {
    label: "Students per judge for an exam",
    description:
      "Before an exam opens, a shared judge is warmed up for every this many students sitting it.",
    group: "Judges",
    schema: z.number().int().min(10).max(2000),
    default: 60,
  },
  "judges.exam_warmup_minutes": {
    label: "Warm up before an exam (minutes)",
    description: "How long before an exam opens its judges are started.",
    group: "Judges",
    schema: z.number().int().min(0).max(240),
    default: 15,
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
