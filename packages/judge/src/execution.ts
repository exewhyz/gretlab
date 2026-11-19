/*
 * Where code runs and is graded. Three levels decide, each only narrowing the one above:
 * the platform's settings, the organization's (for its own work and members-only
 * problems), then an assignment's or contest's choice.
 *
 * "browser" grading is provisional: the server sends only the tests' inputs, the browser
 * runs them and sends the outputs back, and the server compares them with expected outputs
 * that never leave it. The sandbox judges the code again once server execution is back.
 */

/** Languages that can run in a visitor's browser (Pyodide and a JavaScript worker). */
export const BROWSER_LANGUAGES = ["python", "javascript"] as const
export type BrowserLanguage = (typeof BROWSER_LANGUAGES)[number]

export const isBrowserLanguage = (id: string): id is BrowserLanguage =>
  (BROWSER_LANGUAGES as readonly string[]).includes(id)

/** What an assignment or contest chooses. */
export const WORK_EXECUTION = ["server", "browser"] as const
export type WorkExecution = (typeof WORK_EXECUTION)[number]

export const isWorkExecution = (value: unknown): value is WorkExecution =>
  value === "server" || value === "browser"

export interface PlatformExecution {
  server: boolean
  browser: boolean
  /** Whether provisional browser grading may be used at all. */
  browserGrading: boolean
}

/** An organization's own choices; anything missing follows the platform. */
export interface OrgExecution {
  /** false: server execution off for this organization's work. */
  server?: boolean
  /** true: its work may be graded in the browser (when the platform allows it). */
  browserGrading?: boolean
}

export type Where = "server" | "browser" | "none"

export interface ExecutionPlan {
  run: Where
  submit: Where
  /** Languages offered: every enabled one, or only those that run in a browser. */
  browserOnly: boolean
}

export interface ExecutionInput {
  platform: PlatformExecution
  /** The organization the work or problem belongs to; null for the platform's own. */
  org: OrgExecution | null
  /** An assignment's or contest's choice; null for practice. */
  work: WorkExecution | null
  /** What the code is for: practice, an assignment (or exam), or a contest. */
  context: "practice" | "assignment" | "contest"
  signedIn: boolean
}

/** A stored organization setting cleaned up: only known keys, as booleans. */
export function readOrgExecution(stored: unknown): OrgExecution {
  if (!stored || typeof stored !== "object") return {}
  const value = stored as Record<string, unknown>
  const out: OrgExecution = {}
  if (typeof value.server === "boolean") out.server = value.server
  if (typeof value.browserGrading === "boolean")
    out.browserGrading = value.browserGrading
  return out
}

/** Whether the server sandbox may run this organization's code (or the platform's). */
export const serverAllowed = (
  platform: PlatformExecution,
  org: OrgExecution | null
) => platform.server && org?.server !== false

/**
 * Whether provisional browser grading may be used. The platform's own practice needs only
 * the platform's switch; an organization's work needs the organization to opt in too.
 */
export const browserGradingAllowed = (
  platform: PlatformExecution,
  org: OrgExecution | null
) =>
  platform.browser &&
  platform.browserGrading &&
  (org === null || org.browserGrading === true)

export function planExecution(input: ExecutionInput): ExecutionPlan {
  const { platform, org, work, context, signedIn } = input
  const server = serverAllowed(platform, org)
  const grading = browserGradingAllowed(platform, org)

  // Visitors only ever run in their own browser, and never in contests.
  if (!signedIn) {
    const run = platform.browser && context !== "contest" ? "browser" : "none"
    return { run, submit: "none", browserOnly: run === "browser" }
  }

  if (work === "browser") {
    const run = platform.browser ? "browser" : "none"
    return {
      run,
      submit: run === "browser" && grading ? "browser" : "none",
      browserOnly: true,
    }
  }

  if (server) return { run: "server", submit: "server", browserOnly: false }

  // The server is off for this work. Runs fall back to the browser outside contests;
  // Submit does only for practice, since assignments and contests choose it explicitly.
  const run = platform.browser && context !== "contest" ? "browser" : "none"
  const submit =
    run === "browser" && context === "practice" && grading ? "browser" : "none"
  return { run, submit, browserOnly: run === "browser" }
}

/**
 * Submissions a student may make per minute: the platform's limit, or an assignment's or
 * contest's lower one. A work can't allow more than the platform does.
 */
export function perMinuteLimit(platform: number, work: number | null) {
  return work === null ? platform : Math.max(1, Math.min(platform, work))
}

/** What a work's form must refuse: a limit above the platform's, or browser mode not allowed. */
export function workExecutionProblem(input: {
  execution: WorkExecution
  perMinute: number | null
  platform: PlatformExecution
  platformPerMinute: number
  org: OrgExecution | null
}): string | null {
  if (input.perMinute !== null) {
    if (!Number.isInteger(input.perMinute) || input.perMinute < 1)
      return "The submission limit must be a whole number, at least 1."
    if (input.perMinute > input.platformPerMinute)
      return `The submission limit can't be above the platform's ${input.platformPerMinute} a minute.`
  }
  if (input.execution === "browser") {
    if (!input.platform.browser)
      return "Running code in the browser is turned off for the whole site."
    if (!browserGradingAllowed(input.platform, input.org))
      return input.org && input.org.browserGrading !== true
        ? "Grading in the browser isn't turned on for this organization (Settings › Code execution)."
        : "Grading in the browser is turned off for the whole site."
  }
  return null
}

/** The platform's level, from its settings. */
export const platformExecution = (settings: {
  "server_execution.enabled": boolean
  "browser_execution.enabled": boolean
  "browser_execution.grading": boolean
}): PlatformExecution => ({
  server: settings["server_execution.enabled"],
  browser: settings["browser_execution.enabled"],
  browserGrading: settings["browser_execution.grading"],
})
