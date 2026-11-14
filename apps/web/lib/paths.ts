/*
 * Addresses of an organization's pages, in one place: a page that moves is changed here,
 * not hunted down across components. API addresses stay with the calls that use them.
 */

/** A class page's tabs. */
export type ClassTab =
  | "stream"
  | "classwork"
  | "course"
  | "discussion"
  | "people"
  | "grades"
  | "classes"
  | "timetable"

export function orgPages(slug: string) {
  const base = `/orgs/${slug}`
  return {
    /** The organization's home: its dashboard for members, its profile for others. */
    home: base,
    about: `${base}/about`,
    apply: `${base}/apply`,
    books: `${base}/books`,
    events: `${base}/events`,
    event: (id: string) => `${base}/events/${id}`,
    groups: `${base}/groups`,
    leave: `${base}/leave`,
    myAttendance: `${base}/my-attendance`,
    practice: (problem: string) => `${base}/practice/${problem}`,
    child: (studentId: string) => `${base}/children/${studentId}`,
    results: (studentId: string | "me") => `${base}/results/${studentId}`,
    /** A class (group) page, optionally on one tab. */
    cls: (groupId: string, tab?: ClassTab, extra?: Record<string, string>) => {
      const q = new URLSearchParams({ ...(tab ? { tab } : {}), ...extra }).toString()
      return `${base}/classes/${groupId}${q ? `?${q}` : ""}`
    },
    /** A management page ("/exams", "/students/<id>"); "" is not a page of its own. */
    manage: (page: string) => `${base}/manage${page}`,
  }
}
