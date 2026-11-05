import { sql } from "drizzle-orm"
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core"
import type { SourceFile, Verdict } from "@workspace/judge"

const id = () => uuid("id").primaryKey().defaultRandom()
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date())

export const userRole = pgEnum("user_role", ["student", "teacher", "admin"])
export const problemLevel = pgEnum("problem_level", ["easy", "medium", "hard"])
export const submissionKind = pgEnum("submission_kind", ["run", "submit"])
export const submissionStatus = pgEnum("submission_status", [
  "queued",
  "running",
  "done",
])
export const contestScoring = pgEnum("contest_scoring", ["icpc", "ioi"])

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name"),
  /** Public profile address, /u/<handle>. Generated from the email on first sign-in. */
  handle: text("handle").unique(),
  role: userRole("role").notNull().default("student"),
  disabled: boolean("disabled").notNull().default(false),
  createdAt: createdAt(),
})

/** Overrides of the defaults in packages/judge/src/features.ts. */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: updatedAt(),
})

/** Overrides of the registry in packages/judge/src/languages.ts. */
export const languageConfigs = pgTable("language_configs", {
  id: text("id").primaryKey(),
  enabled: boolean("enabled").notNull().default(true),
  timeLimitMs: integer("time_limit_ms"),
  memoryLimitMb: integer("memory_limit_mb"),
  updatedAt: updatedAt(),
})

export const units = pgTable("units", {
  id: id(),
  name: text("name").notNull(),
  position: integer("position").notNull().default(0),
})

export const problems = pgTable(
  "problems",
  {
    id: id(),
    /** Stable, public id used in URLs and by saved browser progress. */
    slug: text("slug").notNull().unique(),
    unitId: uuid("unit_id").references(() => units.id, {
      onDelete: "set null",
    }),
    position: integer("position").notNull().default(0),
    title: text("title").notNull(),
    level: problemLevel("level").notNull().default("easy"),
    statement: jsonb("statement").$type<(string | string[][])[]>().notNull(),
    inputFormat: jsonb("input_format").$type<string[]>().notNull().default([]),
    outputFormat: jsonb("output_format")
      .$type<string[]>()
      .notNull()
      .default([]),
    constraints: jsonb("constraints").$type<string[]>().notNull().default([]),
    /** Never sent to students unless show_solutions allows it. */
    solution: text("solution").notNull().default(""),
    /** Revealed one at a time, so a stuck student can take as little help as they need. */
    hints: jsonb("hints").$type<string[]>().notNull().default([]),
    /** The explanation behind the solution. Same visibility rules as the solution. */
    editorial: text("editorial").notNull().default(""),
    /** Null means the language default applies. */
    timeLimitMs: integer("time_limit_ms"),
    memoryLimitMb: integer("memory_limit_mb"),
    /** Null means every enabled language. */
    allowedLanguages: jsonb("allowed_languages").$type<string[] | null>(),
    published: boolean("published").notNull().default(true),
    /**
     * Only the owning organization's members can see and solve it, on the organization's
     * pages. Never in the public library or on public problem pages.
     */
    membersOnly: boolean("members_only").notNull().default(false),
    /** The organization that wrote it, credited in the library. null: the platform's. */
    orgId: uuid("org_id").references((): AnyPgColumn => organizations.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("problems_unit_position").on(table.unitId, table.position)]
)

export const testCases = pgTable(
  "test_cases",
  {
    id: id(),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    input: text("input").notNull(),
    expected: text("expected").notNull(),
    /** Samples are public. Every other case's input and output stay on the server. */
    isSample: boolean("is_sample").notNull().default(false),
    /** Points toward an IOI-scored contest. */
    points: integer("points").notNull().default(1),
  },
  (table) => [index("test_cases_problem").on(table.problemId, table.position)]
)

export const tags = pgTable("tags", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
})

export const problemTags = pgTable(
  "problem_tags",
  {
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.problemId, table.tagId] }),
    index("problem_tags_tag").on(table.tagId),
  ]
)

/** A student's private notes on a problem. */
export const problemNotes = pgTable(
  "problem_notes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    updatedAt: updatedAt(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.problemId] })]
)

export const listKind = pgEnum("list_kind", [
  "favorites",
  "custom",
  "study_plan",
])

/**
 * Collections of problems. Each student has one favorites list and any number of their own.
 * Study plans are made by staff and shown to everyone.
 */
export const problemLists = pgTable(
  "problem_lists",
  {
    id: id(),
    ownerId: uuid("owner_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    kind: listKind("kind").notNull().default("custom"),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    published: boolean("published").notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [index("problem_lists_owner").on(table.ownerId)]
)

export const problemListItems = pgTable(
  "problem_list_items",
  {
    listId: uuid("list_id")
      .notNull()
      .references(() => problemLists.id, { onDelete: "cascade" }),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.listId, table.problemId] })]
)

/** Scheduled daily challenges. A day with no row gets one picked automatically. */
export const dailyChallenges = pgTable("daily_challenges", {
  day: text("day").primaryKey(),
  problemId: uuid("problem_id")
    .notNull()
    .references(() => problems.id, { onDelete: "cascade" }),
})

export const notes = pgTable("notes", {
  id: id(),
  /** Null for a notice shown to everyone. */
  problemId: uuid("problem_id").references(() => problems.id, {
    onDelete: "cascade",
  }),
  /** An organization's notice, shown only to its members. */
  orgId: uuid("org_id").references((): AnyPgColumn => organizations.id, {
    onDelete: "cascade",
  }),
  text: text("text").notNull(),
  createdAt: createdAt(),
})

export const contests = pgTable("contests", {
  id: id(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  scoring: contestScoring("scoring").notNull().default("icpc"),
  /** ICPC: minutes added per wrong attempt on a problem later solved. */
  penaltyMinutes: integer("penalty_minutes").notNull().default(20),
  /** Minutes before the end when others' results stop updating. 0 disables. */
  freezeMinutes: integer("freeze_minutes").notNull().default(0),
  published: boolean("published").notNull().default(false),
  registrationOpen: boolean("registration_open").notNull().default(true),
  /** null: a platform contest. Otherwise it belongs to this organization. */
  orgId: uuid("org_id").references((): AnyPgColumn => organizations.id, {
    onDelete: "cascade",
  }),
  /** Who it's for: conditions that must all hold, each any of its groups. Empty: everyone. */
  audience: jsonb("audience").$type<string[][]>().notNull().default([]),
  createdAt: createdAt(),
})

/** A set of problems with a due date. Grades are computed from submissions, never stored. */
export const assignments = pgTable("assignments", {
  id: id(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  /** Only submissions from this time on count. */
  opensAt: timestamp("opens_at", { withTimezone: true }).notNull(),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  allowLate: boolean("allow_late").notNull().default(false),
  /** Percent taken off marks earned after the due time. */
  latePenaltyPercent: integer("late_penalty_percent").notNull().default(0),
  published: boolean("published").notNull().default(false),
  orgId: uuid("org_id").references((): AnyPgColumn => organizations.id, {
    onDelete: "cascade",
  }),
  audience: jsonb("audience").$type<string[][]>().notNull().default([]),
  createdAt: createdAt(),
})

export const assignmentProblems = pgTable(
  "assignment_problems",
  {
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "restrict" }),
    position: integer("position").notNull().default(0),
    points: integer("points").notNull().default(100),
  },
  (table) => [primaryKey({ columns: [table.assignmentId, table.problemId] })]
)

export type Assignment = typeof assignments.$inferSelect

export const contestProblems = pgTable(
  "contest_problems",
  {
    contestId: uuid("contest_id")
      .notNull()
      .references(() => contests.id, { onDelete: "cascade" }),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "restrict" }),
    /** A, B, C… */
    label: text("label").notNull(),
    position: integer("position").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.contestId, table.problemId] }),
    uniqueIndex("contest_problem_label").on(table.contestId, table.label),
  ]
)

export const contestParticipants = pgTable(
  "contest_participants",
  {
    contestId: uuid("contest_id")
      .notNull()
      .references(() => contests.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    registeredAt: timestamp("registered_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.contestId, table.userId] })]
)

export interface StoredCaseResult {
  /** Null for a custom-input run. */
  testCaseId: string | null
  isSample: boolean
  verdict: Verdict
  stdout: string
  stderr: string
  wallMs: number
  maxRssKb: number | null
  points: number
  /** Set for Run cases, which aren't in test_cases. */
  label?: string
  input?: string
  expected?: string | null
}

/** One case of a Run. `expected` is filled by the server, only for an unchanged sample. */
export interface RunCase {
  label: string
  input: string
  expected: string | null
}

export const submissions = pgTable(
  "submissions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    problemId: uuid("problem_id").references(() => problems.id, {
      onDelete: "set null",
    }),
    contestId: uuid("contest_id").references(() => contests.id, {
      onDelete: "set null",
    }),
    kind: submissionKind("kind").notNull(),
    language: text("language").notNull(),
    entry: text("entry").notNull(),
    files: jsonb("files").$type<SourceFile[]>().notNull(),
    /** What a Run executes. Graded submissions use the problem's test_cases instead. */
    runCases: jsonb("run_cases").$type<RunCase[]>(),
    /** From before Run could take several cases. */
    stdin: text("stdin"),
    timeLimitMs: integer("time_limit_ms").notNull(),
    memoryLimitMb: integer("memory_limit_mb").notNull(),

    status: submissionStatus("status").notNull().default("queued"),
    verdict: text("verdict").$type<Verdict>(),
    score: integer("score"),
    maxScore: integer("max_score"),
    compileOutput: text("compile_output"),
    results: jsonb("results").$type<StoredCaseResult[]>(),
    /** Summaries, so lists never have to read the large results column. */
    runtimeMs: integer("runtime_ms"),
    memoryKb: integer("memory_kb"),
    passedTests: integer("passed_tests"),
    totalTests: integer("total_tests"),

    /** When this job is due: arrival plus a head start by kind. The queue orders by this. */
    queueAt: timestamp("queue_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Queue bookkeeping: a crashed runner's claim expires and the job is retried. */
    attempts: integer("attempts").notNull().default(0),
    lockedBy: text("locked_by"),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),

    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    // Partial, so the queue stays fast however many finished rows pile up.
    index("submissions_queue")
      .on(table.queueAt)
      .where(sql`status = 'queued'`),
    index("submissions_active_user")
      .on(table.userId)
      .where(sql`status <> 'done'`),
    index("submissions_leases")
      .on(table.lockedUntil)
      .where(sql`status = 'running'`),
    index("submissions_old_runs")
      .on(table.createdAt)
      .where(sql`kind = 'run'`),
    index("submissions_kind_created").on(table.kind, table.createdAt),
    index("submissions_user").on(table.userId, table.createdAt),
    index("submissions_contest").on(table.contestId, table.createdAt),
    index("submissions_user_problem").on(table.userId, table.problemId),
    // Assignment gradebooks read every graded submission for a few problems.
    index("submissions_problem_graded")
      .on(table.problemId, table.createdAt)
      .where(sql`kind = 'submit' and status = 'done'`),
  ]
)

/** Each runner announces itself, so the dashboard can show real capacity. */
export const runners = pgTable("runners", {
  id: text("id").primaryKey(),
  host: text("host").notNull(),
  slots: integer("slots").notNull(),
  busy: integer("busy").notNull().default(0),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
})

/* ---------- organizations ---------- */

export const orgType = pgEnum("org_type", [
  "college",
  "company",
  "community",
  "other",
])
/** open: anyone joins at once. approval: requests wait for a person. invite: links only. */
export const joinPolicy = pgEnum("join_policy", ["open", "approval", "invite"])
export const membershipStatus = pgEnum("membership_status", [
  "active",
  "pending",
])

/** A college, company or community. People keep one account and join several. */
export const organizations = pgTable("organizations", {
  id: id(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  type: orgType("type").notNull().default("college"),
  description: text("description").notNull().default(""),
  website: text("website"),
  /** Shown in the public directory. Private ones are reached by invite only. */
  listed: boolean("listed").notNull().default(true),
  joinPolicy: joinPolicy("join_policy").notNull().default("approval"),
  /** People with these email domains join without waiting for approval. */
  emailDomains: jsonb("email_domains").$type<string[]>().notNull().default([]),
  /** What each level of groups is called, top first: ["Branch", "Batch"] or ["Team"]. */
  groupLevels: jsonb("group_levels")
    .$type<string[]>()
    .notNull()
    .default(["Group"]),
  active: boolean("active").notNull().default(true),
  /** Languages allowed in its contests and members-only problems; null for all enabled. */
  languages: jsonb("languages").$type<string[] | null>(),
  /** false blocks pasting code in its contests (a deterrent, not a guarantee). */
  allowPaste: boolean("allow_paste").notNull().default(true),
  createdAt: createdAt(),
})

/** Branches, batches, teams or cohorts: a tree inside one organization. */
export const orgGroups = pgTable(
  "org_groups",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    createdAt: createdAt(),
  },
  (table) => [index("org_groups_org").on(table.orgId, table.parentId)]
)

export const orgMembers = pgTable(
  "org_members",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: membershipStatus("status").notNull().default("active"),
    /** The member agreed that the organization may see their practice progress. */
    shareProgress: boolean("share_progress").notNull().default(false),
    /** How they got in: open, domain, invite, approval, created, import. */
    joinedVia: text("joined_via").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.userId] }),
    index("org_members_user").on(table.userId),
  ]
)

export const groupMembers = pgTable(
  "group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => orgGroups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.userId] }),
    index("group_members_user").on(table.userId),
  ]
)

/** A named bundle of permissions from packages/judge/src/permissions.ts. */
export const orgRoles = pgTable(
  "org_roles",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** owner, admin, teacher or member for the built-in roles; null for custom ones. */
    systemKey: text("system_key"),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("org_roles_name").on(table.orgId, table.name)]
)

/** A role given to a member, across the organization or limited to one group. */
export const roleAssignments = pgTable(
  "role_assignments",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => orgRoles.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").references(() => orgGroups.id, {
      onDelete: "cascade",
    }),
    createdAt: createdAt(),
  },
  (table) => [index("role_assignments_user").on(table.userId, table.orgId)]
)

/** A link or code that lets people join, optionally into a group and with a role. */
export const orgInvites = pgTable(
  "org_invites",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    token: text("token").notNull().unique(),
    label: text("label").notNull().default(""),
    roleId: uuid("role_id").references(() => orgRoles.id, {
      onDelete: "set null",
    }),
    groupId: uuid("group_id").references(() => orgGroups.id, {
      onDelete: "set null",
    }),
    /** Only this person may use it, when set. */
    email: text("email"),
    maxUses: integer("max_uses"),
    uses: integer("uses").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (table) => [index("org_invites_org").on(table.orgId)]
)

/** Who changed what. Written in the same transaction as the change. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    orgId: uuid("org_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    actorId: uuid("actor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    summary: text("summary").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (table) => [index("audit_log_org").on(table.orgId, table.createdAt)]
)

/** The topics a group is taught, in order, with an optional date each should be done by. */
export const syllabi = pgTable("syllabi", {
  groupId: uuid("group_id")
    .primaryKey()
    .references(() => orgGroups.id, { onDelete: "cascade" }),
  orgId: uuid("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  topics: jsonb("topics")
    .$type<{ id: string; title: string; plannedFor: string | null }[]>()
    .notNull()
    .default([]),
  updatedAt: updatedAt(),
})

/** One class taught: when, to which group, how long, and which syllabus topics it covered. */
export const teachingSessions = pgTable(
  "teaching_sessions",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => orgGroups.id, { onDelete: "cascade" }),
    teacherId: uuid("teacher_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** The day it was taught, YYYY-MM-DD in the organization's sense of a day. */
    day: text("day").notNull(),
    minutes: integer("minutes").notNull(),
    topicIds: jsonb("topic_ids").$type<string[]>().notNull().default([]),
    note: text("note").notNull().default(""),
    createdAt: createdAt(),
  },
  (table) => [
    index("teaching_sessions_group").on(table.groupId, table.day),
    index("teaching_sessions_teacher").on(table.teacherId, table.day),
  ]
)

/** A student's rating of a class they were in. Teachers see averages and comments, not names. */
export const sessionFeedback = pgTable(
  "session_feedback",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => teachingSessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rating: integer("rating").notNull(),
    comment: text("comment").notNull().default(""),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.userId] })]
)

export type Organization = typeof organizations.$inferSelect
export type OrgGroup = typeof orgGroups.$inferSelect
export type OrgRole = typeof orgRoles.$inferSelect

export type User = typeof users.$inferSelect
export type Problem = typeof problems.$inferSelect
export type TestCase = typeof testCases.$inferSelect
export type Contest = typeof contests.$inferSelect
export type Submission = typeof submissions.$inferSelect
