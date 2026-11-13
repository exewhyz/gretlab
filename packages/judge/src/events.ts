/*
 * Events (the "events" module): who gets a place. Places go in the order people said
 * they're going; past the capacity they wait, and when someone drops out the longest
 * waiting moves up. Pure, so it's unit-tested.
 */

export type Rsvp = "going" | "waitlist" | "not_going"

/** What someone saying they're going gets: a place, or a spot on the waitlist. */
export function placeFor(capacity: number | null, going: number): Exclude<Rsvp, "not_going"> {
  return capacity == null || going < capacity ? "going" : "waitlist"
}

/**
 * After a change (someone dropped out, or the capacity grew): who on the waitlist moves
 * up, in the order they joined it.
 */
export function promote(
  capacity: number | null,
  going: number,
  waitlist: readonly { userId: string; at: Date }[]
): string[] {
  const free = capacity == null ? waitlist.length : Math.max(0, capacity - going)
  return [...waitlist]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .slice(0, free)
    .map((w) => w.userId)
}

/** Why an event's times can't be saved, or null. */
export function eventProblem(startsAt: Date, endsAt: Date) {
  if (endsAt <= startsAt) return "An event has to end after it starts."
  if (endsAt.getTime() - startsAt.getTime() > 14 * 86_400_000) return "Keep an event under two weeks."
  return null
}
