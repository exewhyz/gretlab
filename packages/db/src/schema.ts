import { sql } from "drizzle-orm"
import {
  boolean,
  customType,
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
import type {
  ProblemCode,
  RubricCriterion,
  ExamSettings,
  AttainmentRules,
  SourceFile,
  Verdict,
} from "@workspace/judge"

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
    /** The problem as markdown: statement, input and output format, constraints. */
    description: text("description").notNull().default(""),
    /** The structured form problems were first written in; `description` replaces it. */
    statement: jsonb("statement").$type<(string | string[][])[]>().notNull(),
    inputFormat: jsonb("input_format").$type<string[]>().notNull().default([]),
    outputFormat: jsonb("output_format")
      .$type<string[]>()
      .notNull()
      .default([]),
    constraints: jsonb("constraints").$type<string[]>().notNull().default([]),
    /** The Python reference solution, kept in step with `code.python.solution`. */
    solution: text("solution").notNull().default(""),
    /**
     * Per language: starter code students begin with, the reference solution (same
     * visibility rules as the editorial). Older rows may also hold driver code, which the
     * migrations fold into the starter.
     */
    code: jsonb("code")
      .$type<Record<string, ProblemCode>>()
      .notNull()
      .default({}),
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
    /**
     * false: written for assignments, exams or contests. Never in the library or on public
     * pages; reachable only through the assignments and contests that use it.
     */
    listed: boolean("listed").notNull().default(true),
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
  /** For an organization's notice: who it's for, like contests and assignments. */
  audience: jsonb("audience").$type<string[][]>().notNull().default([]),
  authorId: uuid("author_id").references((): AnyPgColumn => users.id, {
    onDelete: "set null",
  }),
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
  /** Rubric marks and line comments stay hidden from students until released. */
  holdFeedback: boolean("hold_feedback").notNull().default(false),
  /** A lab exam: one timed sitting per student. Null for ordinary assignments. */
  exam: jsonb("exam").$type<ExamSettings | null>(),
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
    /** Marks from the tests. */
    points: integer("points").notNull().default(100),
    /** Criteria a teacher marks by hand, on top of the tests: "Readable code, 5". */
    rubric: jsonb("rubric").$type<RubricCriterion[]>().notNull().default([]),
    /** Course outcomes this problem assesses (ids in `course_outcomes`). */
    outcomes: jsonb("outcomes").$type<string[]>().notNull().default([]),
  },
  (table) => [primaryKey({ columns: [table.assignmentId, table.problemId] })]
)

/** A teacher's marks for one student on one assignment problem, by rubric criterion id. */
export const rubricMarks = pgTable(
  "rubric_marks",
  {
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    marks: jsonb("marks").$type<Record<string, number>>().notNull().default({}),
    graderId: uuid("grader_id").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.assignmentId, table.problemId, table.userId] })]
)

/** A teacher's comment on one line of a submitted file, given in an assignment. */
export const submissionComments = pgTable(
  "submission_comments",
  {
    id: id(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    path: text("path").notNull(),
    /** 1-based. */
    line: integer("line").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("submission_comments_submission").on(table.submissionId)]
)

/** Comments a teacher saves to reuse: "Use a dictionary here". */
export const feedbackSnippets = pgTable(
  "feedback_snippets",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (table) => [index("feedback_snippets_user").on(table.userId)]
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
  /** How course outcome attainment is judged; null for the defaults (60%; 50/60/70). */
  attainment: jsonb("attainment").$type<AttainmentRules | null>(),
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

/** Who was at a logged class. A student with no row wasn't marked either way. */
export const attendance = pgTable(
  "attendance",
  {
    sessionId: uuid("session_id")
      .notNull()
      .references(() => teachingSessions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    present: boolean("present").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.userId] }),
    index("attendance_user").on(table.userId),
  ]
)

/**
 * A student's code on a problem in one language, saved as they type, so it follows them to
 * any computer. Teachers who can see the student's graded work for an assignment can also
 * see this, live.
 */
export const drafts = pgTable(
  "drafts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    language: text("language").notNull(),
    files: jsonb("files").$type<SourceFile[]>().notNull(),
    entry: text("entry").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.problemId, table.language] }),
    index("drafts_problem").on(table.problemId),
  ]
)

/** The draft as it changed, every few seconds while typing: replayed to see how code was written. */
export const draftSnapshots = pgTable(
  "draft_snapshots",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    language: text("language").notNull(),
    files: jsonb("files").$type<SourceFile[]>().notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("draft_snapshots_by").on(table.userId, table.problemId, table.at)]
)

/** What a program's graduates should be able to do (PO1..PO12, PSOs): one list per organization. */
export const programOutcomes = pgTable(
  "program_outcomes",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    title: text("title").notNull(),
    position: integer("position").notNull().default(0),
  },
  (table) => [index("program_outcomes_by_org").on(table.orgId, table.position)]
)

/** What a course (a group someone teaches) sets out to teach, and the POs it supports. */
export const courseOutcomes = pgTable(
  "course_outcomes",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => orgGroups.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    title: text("title").notNull(),
    position: integer("position").notNull().default(0),
    /** Program outcome id → strength 1 (low), 2 (medium) or 3 (high). */
    mapping: jsonb("mapping").$type<Record<string, number>>().notNull().default({}),
  },
  (table) => [index("course_outcomes_by_group").on(table.groupId, table.position)]
)

/** A student's one sitting of a lab exam. */
export const examSessions = pgTable(
  "exam_sessions",
  {
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    /** The time limit or the due time, fixed when it started. */
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    /** Set when the student finishes early. */
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Where it was started from. */
    ip: text("ip"),
  },
  (table) => [
    primaryKey({ columns: [table.assignmentId, table.userId] }),
    // Every Run and Submit asks whether the student is sitting an exam.
    index("exam_sessions_by_user").on(table.userId, table.endsAt),
  ]
)

/** Things the browser noticed during a sitting: leaving the tab or fullscreen, pasting. */
export const examEvents = pgTable(
  "exam_events",
  {
    id: id(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    detail: text("detail").notNull().default(""),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("exam_events_by").on(table.assignmentId, table.userId, table.at)]
)

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" })

/**
 * Images in problem statements, editorials and notices. Kept in Postgres so every web
 * replica serves them without shared storage. Content-addressed: the same image uploaded
 * twice is stored once.
 */
export const uploads = pgTable(
  "uploads",
  {
    id: id(),
    /** SHA-256 of the bytes. */
    hash: text("hash").notNull().unique(),
    contentType: text("content_type").notNull(),
    size: integer("size").notNull(),
    data: bytea("data").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (table) => [index("uploads_by").on(table.uploadedBy, table.createdAt)]
)

export type Organization = typeof organizations.$inferSelect
export type OrgGroup = typeof orgGroups.$inferSelect
export type OrgRole = typeof orgRoles.$inferSelect

export type User = typeof users.$inferSelect
export type Problem = typeof problems.$inferSelect
export type TestCase = typeof testCases.$inferSelect
export type Contest = typeof contests.$inferSelect
export type Submission = typeof submissions.$inferSelect
