export interface SyllabusTopic {
  id: string
  title: string
  /** YYYY-MM-DD it should be taught by, or null. */
  plannedFor: string | null
}

/**
 * How far through its syllabus a group is: topics covered by logged classes, and topics
 * whose planned day has passed without being covered ("behind").
 */
export function syllabusProgress(
  topics: readonly SyllabusTopic[],
  sessions: readonly { topicIds: readonly string[] }[],
  today: string
) {
  const covered = new Set(sessions.flatMap((s) => s.topicIds))
  const done = topics.filter((t) => covered.has(t.id))
  const behind = topics.filter(
    (t) => !covered.has(t.id) && t.plannedFor !== null && t.plannedFor < today
  )
  return {
    total: topics.length,
    covered: done.length,
    percent: topics.length ? Math.round((100 * done.length) / topics.length) : 0,
    behind: behind.map((t) => t.title),
    next: topics.find((t) => !covered.has(t.id))?.title ?? null,
  }
}
