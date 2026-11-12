/*
 * The audit log's shared rules (written by features/audit/server.ts, read on the Activity
 * pages): which area an action belongs to, what changed in an edit, and a person-readable
 * device from a browser's user agent. Pure, so they're unit-tested here.
 */

/** Areas of the log, by an action's first word ("role.update" is Roles). */
export const AUDIT_CATEGORIES: Record<string, string> = {
  org: "Organization",
  member: "Members",
  invite: "Invites",
  group: "Groups",
  role: "Roles",
  staff: "Platform staff",
  user: "Accounts",
  security: "Security",
  notifications: "Notifications",
  lti: "LMS",
  assignment: "Assignments",
  contest: "Contests",
  problem: "Problems",
  question: "Questions",
  course: "Courses",
  template: "Templates",
  notice: "Notices",
  discussion: "Discussions",
  certificate: "Certificates",
  gradebook: "Grades",
  outcomes: "Outcomes",
  class: "Classes",
  syllabus: "Classes",
  attendance: "Attendance",
  subject: "Subjects",
  timetable: "Timetable",
  records: "Student records",
  exam: "Exams",
  leave: "Leave",
  parent: "Parents",
  library: "Library",
  transport: "Transport",
  hostel: "Hostel",
}

export const auditCategory = (action: string) => action.split(".")[0] ?? action

export const categoryLabel = (category: string) =>
  AUDIT_CATEGORIES[category] ?? category.charAt(0).toUpperCase() + category.slice(1)

export interface FieldChange {
  field: string
  from: string
  to: string
}

/** Things added to and removed from a named list (permissions, modules). */
export interface ListChange {
  label: string
  added: string[]
  removed: string[]
}

const shown = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "—"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (Array.isArray(value)) return value.length ? value.map(shown).join(", ") : "—"
  if (typeof value === "object") return JSON.stringify(value)
  const text = String(value)
  // Long text (a description) is shortened: the entry says it changed, not all of it.
  return text.length > 120 ? `${text.slice(0, 117)}…` : text
}

/** The fields (by label) whose value differs between before and after, as text. */
export function changesBetween(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  labels: Record<string, string>
): FieldChange[] {
  return Object.entries(labels).flatMap(([key, field]) => {
    if (!(key in after)) return []
    const from = shown(before[key])
    const to = shown(after[key])
    return from === to ? [] : [{ field, from, to }]
  })
}

/** What was added to and removed from a list, named; null when nothing changed. */
export function listChanges(
  label: string,
  before: readonly string[],
  after: readonly string[]
): ListChange | null {
  const was = new Set(before)
  const now = new Set(after)
  const added = [...now].filter((x) => !was.has(x))
  const removed = [...was].filter((x) => !now.has(x))
  return added.length || removed.length ? { label, added, removed } : null
}

/** "Chrome on macOS", "Safari on iPhone", or null when there's nothing to tell. */
export function describeDevice(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null
  const ua = userAgent
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : /curl\//i.test(ua)
              ? "curl"
              : null
  const system = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "macOS"
            : /CrOS/.test(ua)
              ? "ChromeOS"
              : /Linux/.test(ua)
                ? "Linux"
                : null
  if (browser && system) return `${browser} on ${system}`
  return browser ?? system ?? "Another app"
}
