import { inArray } from "drizzle-orm"

import { eventRsvps, notes, orgEvents, platformStaff, users } from "../index.ts"

import {
  at,
  chance,
  db,
  emailFor,
  give,
  group,
  insertAll,
  join,
  makeOrg,
  makeUsers,
  person,
  remember,
  seat,
  shuffle,
} from "./shared.ts"

/*
 * Open Source Club: open groups members join themselves, each with its moderator; events
 * coming up (one full, with a waitlist; one online), one past and one cancelled. And the
 * platform's own demo staff: support, content admin, auditor.
 */

const SLUG = "osclub"
const LABEL = "Open Source Club (community)"

export async function buildCommunity() {
  const mk = (name: string, local: string) => ({ name, email: emailFor(local, SLUG) })
  const [owner, organizer, coordinator] = await makeUsers([mk("Farhan Ahmed", "owner"), mk(person().name, "events"), mk(person().name, "membership")])
  const org = await makeOrg({
    slug: SLUG,
    name: "Open Source Club",
    type: "community",
    description: "Developers in Hyderabad who learn, build and contribute together. Everyone welcome.",
    modules: { events: true },
    joinPolicy: "open",
    owner: owner!,
  })
  await join(org, [organizer!, coordinator!])
  await give(org, organizer!, "event_organizer")
  await give(org, coordinator!, "membership_coordinator")
  remember(LABEL, "Event organizer", organizer!)

  const moderators = await makeUsers(["rust", "web", "ml", "first.contributions"].map((g, i) => mk(person().name, i === 0 ? "moderator" : `moderator.${g}`)))
  await join(org, moderators)
  remember(LABEL, "Moderator (Rust)", moderators[0]!)
  const groups = []
  for (const [i, [name, description]] of ([
    ["Rust", "Systems programming in Rust: weekly reading group and a project night."],
    ["Web", "Frontend and backend: React, Next.js, APIs."],
    ["Machine learning", "Paper reading and Kaggle together."],
    ["First contributions", "New to open source? Find your first issue here."],
  ] as const).entries()) {
    const id = await group(org, name, null, { open: true, leadId: moderators[i]!.id, description })
    await give(org, moderators[i]!, "teacher", id)
    groups.push(id)
  }
  const core = await group(org, "Core team", null, { description: "Organizers only." })
  await seat(core, [owner!, organizer!, coordinator!])

  const members = await makeUsers(Array.from({ length: 55 }, (_, i) => {
    const p = person()
    return { name: p.name, email: emailFor(i === 0 ? "member" : `${p.first}.${p.last}`, SLUG) }
  }))
  await join(org, members)
  for (const [i, g] of groups.entries()) await seat(g, members.filter((_, k) => (k + i) % 3 === 0 || chance(0.15)))
  remember(LABEL, "Member", members[0]!)

  const events = await db
    .insert(orgEvents)
    .values([
      { orgId: org.id, groupId: groups[0]!, title: "Rust project night", description: "Pair up and contribute to a Rust crate. Laptops needed.", startsAt: at(4, 13), endsAt: at(4, 16), location: "T-Hub, Hyderabad", capacity: 20, createdBy: moderators[0]!.id },
      { orgId: org.id, title: "Intro to machine learning workshop", description: "From linear regression to your first model, hands-on.", startsAt: at(11, 5), endsAt: at(11, 8), location: "", link: "https://meet.example.com/osclub-ml", capacity: 150, createdBy: organizer!.id },
      { orgId: org.id, title: "Monthly meetup: lightning talks", description: "Five-minute talks from members. Sign up to speak!", startsAt: at(18, 12, 30), endsAt: at(18, 15), location: "WeWork Raheja Mindspace", createdBy: organizer!.id },
      { orgId: org.id, title: "Hacktoberfest kickoff", description: "Finding good first issues.", startsAt: at(-30, 12), endsAt: at(-30, 15), location: "T-Hub, Hyderabad", createdBy: organizer!.id },
      { orgId: org.id, groupId: groups[1]!, title: "Next.js study session", description: "Postponed to next month.", startsAt: at(6, 13), endsAt: at(6, 15), location: "Online", link: "https://meet.example.com/osclub-web", createdBy: moderators[1]!.id, cancelledAt: at(-1) },
    ])
    .returning({ id: orgEvents.id })
  // The Rust night is full, with a few waiting.
  const rustaceans = shuffle(members).slice(0, 24)
  await insertAll(eventRsvps, rustaceans.map((m, i) => ({ eventId: events[0]!.id, userId: m.id, status: (i < 20 ? "going" : "waitlist") as "going" | "waitlist", at: at(-10 + i * 0.2) })))
  await insertAll(eventRsvps, shuffle(members).slice(0, 38).map((m) => ({ eventId: events[1]!.id, userId: m.id, status: "going" as const })))
  await insertAll(eventRsvps, shuffle(members).slice(0, 30).map((m) => ({ eventId: events[3]!.id, userId: m.id, status: "going" as const, at: at(-35) })))
  await insertAll(notes, [
    { orgId: org.id, text: "Welcome! Join the groups you like under Groups, and say hi at the next meetup.", audience: [], authorId: owner!.id, createdAt: at(-20) },
  ])

  // The platform's own demo staff.
  const [support, content, auditor] = await makeUsers([
    { name: "Platform Support", email: emailFor("support", "platform") },
    { name: "Platform Content", email: emailFor("content", "platform") },
    { name: "Platform Auditor", email: emailFor("auditor", "platform") },
  ])
  // As the app records staff: a platform role, and "teacher" on the account.
  await db.update(users).set({ role: "teacher" }).where(inArray(users.id, [support!.id, content!.id, auditor!.id]))
  await insertAll(platformStaff, [
    { userId: support!.id, systemRole: "support" },
    { userId: content!.id, systemRole: "content_admin" },
    { userId: auditor!.id, systemRole: "auditor" },
  ])
  remember("Platform", "Support (platform staff)", support!)
  remember("Platform", "Content admin (platform staff)", content!)
  remember("Platform", "Auditor (platform staff)", auditor!)
  console.log(`  community: ${members.length} members, ${groups.length} open groups`)
}
