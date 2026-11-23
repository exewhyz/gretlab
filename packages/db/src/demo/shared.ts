import { scryptSync, randomBytes } from "node:crypto"

import { KINDS, ORG_TYPE_CONFIG, ROLE_TEMPLATES, SYSTEM_ROLES, type OrgType } from "@workspace/judge"

import {
  getDb,
  groupMembers,
  orgGroups,
  orgMembers,
  orgRoles,
  organizations,
  roleAssignments,
  users,
} from "../index.ts"

/*
 * What every part of the demo data uses: a seeded random source (the same data on every
 * run), Indian names, days relative to today, batch inserts, and creating an organization
 * exactly as the app does (built-in roles with the kind's names, the kind's suggested
 * roles, its owner).
 */

export const db = getDb()

/**
 * The password every demo account shares, from the DEMO_PASSWORD setting. It's never
 * written in the code, docs or commits: whoever builds the demo chooses it, and demo.ts
 * refuses to wipe without a valid one.
 */
export const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? ""

/** Demo addresses can never receive mail (.invalid), so nothing is ever sent to them. */
export const DOMAIN = "demo.invalid"

// scrypt like apps/web/features/auth/password.ts, worked out once (when the first account is
// made, after demo.ts has checked the password): every demo account shares it.
let hash: string | null = null
function passwordHash() {
  if (hash) return hash
  const salt = randomBytes(16)
  const key = scryptSync(DEMO_PASSWORD.normalize("NFKC"), salt, 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 128 * 2 ** 15 * 8 * 2 })
  hash = ["scrypt", 2 ** 15, 8, 1, salt.toString("base64url"), key.toString("base64url")].join("$")
  return hash
}

/* ---------- randomness that's the same every run ---------- */

let seed = 20261113
export function random() {
  seed |= 0
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
export const chance = (p: number) => random() < p
export const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1))
export const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]!
export function shuffle<T>(list: readonly T[]) {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}
/** Roughly normal, kept within [lo, hi]. */
export function normal(mean: number, sd: number, lo: number, hi: number) {
  const u = random() || 1e-9
  const v = random()
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  return Math.min(hi, Math.max(lo, mean + z * sd))
}

/* ---------- days ---------- */

const DAY = 86_400_000
export const TODAY = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z")
/** YYYY-MM-DD, `n` days from today (negative: before). */
export const day = (n: number) => new Date(TODAY.getTime() + n * DAY).toISOString().slice(0, 10)
/** A moment `n` days from now, at an hour of the day (UTC). */
export const at = (n: number, hour = 9, minute = 0) => new Date(TODAY.getTime() + n * DAY + (hour * 60 + minute) * 60_000)
/** The last `count` days before today that aren't Sundays (or weekends too). */
export function pastWorkdays(count: number, saturdays = true) {
  const out: string[] = []
  for (let n = -1; out.length < count; n--) {
    const d = new Date(TODAY.getTime() + n * DAY).getUTCDay()
    if (d === 0 || (!saturdays && d === 6)) continue
    out.unshift(day(n))
  }
  return out
}
/** The academic year today is in: April to March (schools), or July to June (colleges). */
export function academicYear(startMonth: 4 | 7) {
  const y = TODAY.getUTCFullYear()
  const start = TODAY.getUTCMonth() + 1 >= startMonth ? y : y - 1
  const pad = (m: number) => String(m).padStart(2, "0")
  const endMonth = startMonth - 1
  const last = new Date(Date.UTC(start + 1, endMonth, 0)).getUTCDate()
  return {
    name: `${start}-${String(start + 1).slice(2)}`,
    startsOn: `${start}-${pad(startMonth)}-01`,
    endsOn: `${start + 1}-${pad(endMonth)}-${last}`,
    start,
  }
}

/* ---------- people ---------- */

const MALE = ["Aarav", "Vivaan", "Aditya", "Arjun", "Reyansh", "Krishna", "Ishaan", "Rohan", "Kabir", "Ayaan", "Dhruv", "Karthik", "Rahul", "Siddharth", "Nikhil", "Pranav", "Harsh", "Yash", "Manav", "Varun", "Aniket", "Rajat", "Imran", "Joseph", "Gurpreet", "Sameer", "Tanmay", "Om", "Dev", "Neel"]
const FEMALE = ["Ananya", "Diya", "Saanvi", "Aadhya", "Isha", "Priya", "Kavya", "Meera", "Riya", "Sneha", "Pooja", "Neha", "Aishwarya", "Tanvi", "Shreya", "Nisha", "Fatima", "Sara", "Harleen", "Lakshmi", "Divya", "Nandini", "Anjali", "Pallavi", "Zoya", "Mira", "Aditi", "Bhavna", "Ira", "Gauri"]
const SURNAMES = ["Sharma", "Verma", "Gupta", "Iyer", "Nair", "Reddy", "Patel", "Shah", "Mehta", "Singh", "Kaur", "Das", "Banerjee", "Chatterjee", "Mukherjee", "Rao", "Pillai", "Menon", "Joshi", "Kulkarni", "Deshpande", "Khan", "Ahmed", "Fernandes", "D'Souza", "Bose", "Agarwal", "Malhotra", "Kapoor", "Chopra", "Saxena", "Mishra", "Pandey", "Tiwari", "Yadav", "Naidu", "Hegde", "Shetty", "Gill", "Sinha"]

export interface Person {
  name: string
  gender: "male" | "female"
  first: string
  last: string
}
export function person(gender?: "male" | "female", last?: string, notFirst?: string): Person {
  const g = gender ?? (chance(0.5) ? "male" : "female")
  let first = pick(g === "male" ? MALE : FEMALE)
  while (first === notFirst) first = pick(g === "male" ? MALE : FEMALE)
  const surname = last ?? pick(SURNAMES)
  return { name: `${first} ${surname}`, gender: g, first, last: surname }
}

const used = new Set<string>()
/** A unique address on the demo domain: first.last@<org>.demo.invalid. */
export function emailFor(local: string, org: string) {
  const base = local
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9.]+/g, "")
    .replace(/\.+/g, ".")
  let candidate = `${base}@${org}.${DOMAIN}`
  for (let n = 2; used.has(candidate); n++) candidate = `${base}${n}@${org}.${DOMAIN}`
  used.add(candidate)
  return candidate
}

const handles = new Set<string>()
function handleFor(email: string) {
  const base = email.split("@")[0]!.replace(/[^a-z0-9]+/g, "-").slice(0, 30) || "user"
  let h = base
  for (let n = 2; handles.has(h); n++) h = `${base}-${n}`
  handles.add(h)
  return h
}

export interface UserRow {
  id: string
  name: string
  email: string
}

/** Makes accounts that sign in with the demo password (address already confirmed). */
export async function makeUsers(list: { name: string; email: string }[]): Promise<UserRow[]> {
  const out: UserRow[] = []
  for (const chunk of chunks(list, 500)) {
    const rows = await db
      .insert(users)
      .values(
        chunk.map((u) => ({
          name: u.name,
          email: u.email,
          handle: handleFor(u.email),
          role: "student" as const,
          passwordHash: passwordHash(),
          emailVerifiedAt: new Date(),
          createdAt: at(-int(60, 200)),
        }))
      )
      .returning({ id: users.id, name: users.name, email: users.email })
    out.push(...rows.map((r) => ({ id: r.id, name: r.name ?? "", email: r.email })))
  }
  return out
}

export function chunks<T>(list: readonly T[], size: number) {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** Inserts many rows, a few hundred at a time. */
export async function insertAll<T>(table: Parameters<typeof db.insert>[0], rows: T[], size = 400) {
  for (const chunk of chunks(rows, size)) {
    if (chunk.length) await db.insert(table).values(chunk as never)
  }
}

/* ---------- organizations ---------- */

export interface Org {
  id: string
  slug: string
  type: OrgType
  /** Role ids: built-in by key (owner, admin, teacher, member), suggested by template key. */
  roles: Record<string, string>
}

/** An organization as the app makes one: built-in roles named for its kind, its suggested roles, its owner. */
export async function makeOrg(input: {
  slug: string
  name: string
  type: OrgType
  description: string
  website?: string
  modules: Record<string, boolean>
  moduleSettings?: Record<string, unknown>
  joinPolicy?: "open" | "approval" | "invite"
  owner: UserRow
}): Promise<Org> {
  const [org] = await db
    .insert(organizations)
    .values({
      slug: input.slug,
      name: input.name,
      type: input.type,
      description: input.description,
      website: input.website ?? null,
      joinPolicy: input.joinPolicy ?? "approval",
      groupLevels: ORG_TYPE_CONFIG[input.type].groupLevels,
      modules: input.modules,
      moduleSettings: input.moduleSettings ?? {},
      createdAt: at(-200),
    })
    .returning()
  const names = KINDS[input.type].roleNames as Record<string, string>
  const roles = await db
    .insert(orgRoles)
    .values([
      ...Object.entries(SYSTEM_ROLES).map(([key, role]) => ({
        orgId: org!.id,
        systemKey: key,
        name: names[key] ?? role.name,
        description: role.description,
        permissions: [...role.permissions],
      })),
      ...ROLE_TEMPLATES[input.type].map((t) => ({
        orgId: org!.id,
        systemKey: null,
        templateKey: t.key,
        name: t.name,
        description: t.description,
        permissions: [...t.permissions],
      })),
    ])
    .returning({ id: orgRoles.id, systemKey: orgRoles.systemKey, templateKey: orgRoles.templateKey })
  const o: Org = {
    id: org!.id,
    slug: input.slug,
    type: input.type,
    roles: Object.fromEntries(roles.map((r) => [r.systemKey ?? r.templateKey!, r.id])),
  }
  await join(o, [input.owner])
  await give(o, input.owner, "owner")
  return o
}

/** Active members, each with the Member role (as joining gives). */
export async function join(org: Org, people: UserRow[]) {
  await insertAll(
    orgMembers,
    people.map((p) => ({ orgId: org.id, userId: p.id, status: "active" as const, joinedVia: "created", createdAt: at(-int(30, 180)) }))
  )
  await insertAll(
    roleAssignments,
    people.map((p) => ({ orgId: org.id, userId: p.id, roleId: org.roles.member!, groupId: null }))
  )
}

/** A role (built-in key or suggested-role key), across the organization or in a group. */
export async function give(org: Org, who: UserRow | UserRow[], role: string, groupId: string | null = null) {
  const list = Array.isArray(who) ? who : [who]
  const roleId = org.roles[role]
  if (!roleId) throw new Error(`No role ${role} in ${org.slug}`)
  await insertAll(
    roleAssignments,
    list.map((p) => ({ orgId: org.id, userId: p.id, roleId, groupId }))
  )
}

/** A group (and returns its id). */
export async function group(
  org: Org,
  name: string,
  parentId: string | null = null,
  extra: { startsOn?: string; endsOn?: string; leadId?: string; open?: boolean; description?: string } = {}
) {
  const [g] = await db
    .insert(orgGroups)
    .values({ orgId: org.id, name, parentId, ...extra })
    .returning({ id: orgGroups.id })
  return g!.id
}

export async function seat(groupId: string, people: UserRow[]) {
  await insertAll(
    groupMembers,
    people.map((p) => ({ groupId, userId: p.id }))
  )
}

/** People to list at the end: who to sign in as, and what they'll see. */
export const ACCOUNTS: { org: string; role: string; email: string }[] = []
export const remember = (org: string, role: string, u: UserRow) => ACCOUNTS.push({ org, role, email: u.email })
