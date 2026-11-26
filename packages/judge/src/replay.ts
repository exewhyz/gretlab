/**
 * Replaying how code was written (drafts' snapshots, apps/web/features/drafts): the steps where a
 * lot of new code appeared at once, a likely paste. The editor saves to the account a moment
 * after typing starts and then at least every 5 seconds while it goes on, so one snapshot holds
 * a few seconds of work however long the pause before it; typing that fast never brings in
 * this much. A reason to look, never proof: code can come from the student's own notes.
 */

/** New characters (spaces aside) in one save that are worth pointing out. */
export const JUMP_CHARS = 150

interface Snapshot {
  language: string
  at: string | Date
  files: readonly { path: string; content: string }[]
}

export interface Jump {
  /** The snapshot's position in the history. */
  step: number
  /** Characters of code never seen before in this language, spaces left out. */
  added: number
  /** Since the snapshot before; null for the first. */
  seconds: number | null
}

/** A line as code, so reformatting or reindenting it doesn't make it new. */
const normal = (line: string) => line.replace(/\s+/g, "")

/**
 * The steps that brought in at least JUMP_CHARS of code not seen before: not in the language's
 * starter (`starters`, by language) and not in any earlier snapshot in that language, so undoing
 * back to earlier code, reformatting or switching languages and back isn't new code.
 */
export function bigJumps(
  history: readonly Snapshot[],
  starters: Readonly<Record<string, string | undefined>> = {}
): Jump[] {
  const seen = new Map<string, Set<string>>()
  const seenIn = (language: string) => {
    let set = seen.get(language)
    if (!set) {
      set = new Set((starters[language] ?? "").split("\n").map(normal))
      seen.set(language, set)
    }
    return set
  }
  const jumps: Jump[] = []
  history.forEach((snapshot, step) => {
    const known = seenIn(snapshot.language)
    let added = 0
    const fresh = new Set<string>()
    for (const file of snapshot.files)
      for (const line of file.content.split("\n")) {
        const code = normal(line)
        if (code && !known.has(code) && !fresh.has(code)) {
          fresh.add(code)
          added += code.length
        }
      }
    for (const code of fresh) known.add(code)
    if (added >= JUMP_CHARS) {
      const before = history[step - 1]
      jumps.push({
        step,
        added,
        seconds: before
          ? Math.round(
              (new Date(snapshot.at).getTime() -
                new Date(before.at).getTime()) /
                1000
            )
          : null,
      })
    }
  })
  return jumps
}
