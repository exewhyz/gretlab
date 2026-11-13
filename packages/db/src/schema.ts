import { sql } from "drizzle-orm"
import {
  boolean,
  customType,
  doublePrecision,
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
  PeerReviewSettings,
  QuestionKind,
  AttainmentRules,
  NotificationEvent,
  PolicyOverrides,
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
  /** Notifications also by email, when the server has SMTP set up. */
  emailNotifications: boolean("email_notifications").notNull().default(true),
  /** Which events' email they chose to get or not; missing ones follow the event's default. */
  notificationPrefs: jsonb("notification_prefs")
    .$type<Partial<Record<NotificationEvent, boolean>>>()
    .notNull()
    .default({}),
  /** A secret for the person's calendar feed (iCal); null until they turn it on. */
  calendarToken: text("calendar_token").unique(),
  /** Sign-in with email and password: scrypt, never the password itself. Null: none set. */
  passwordHash: text("password_hash"),
  /** When they proved the address is theirs (a sign-up link, a reset, or Google). */
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  /** Wrong passwords in a row, and until when password sign-in waits after too many. */
  passwordFailures: integer("password_failures").notNull().default(0),
  passwordLockedUntil: timestamp("password_locked_until", { withTimezone: true }),
  /** Sessions signed in before this are signed out (a password reset, "sign out everywhere"). */
  sessionsValidAfter: timestamp("sessions_valid_after", { withTimezone: true }),
  createdAt: createdAt(),
})

/**
 * Single-use links sent by email: confirming a new account's address, and resetting a
 * password. Only a hash of the token is kept, so a database leak gives no working links.
 */
export const authTokens = pgTable(
  "auth_tokens",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"verify" | "reset">().notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index("auth_tokens_by_user").on(table.userId, table.kind)]
)

/** A custom platform role: a name and a set of platform permissions. Built-in ones live in code. */
export const platformRoles = pgTable("platform_roles", {
  id: id(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
  createdAt: createdAt(),
})

/**
 * Platform staff and their role: a built-in one (`systemRole`) or a custom one (`roleId`).
 * People not listed fall back to their account role (admin: Owner, teacher: Content admin).
 */
export const platformStaff = pgTable("platform_staff", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  systemRole: text("system_role"),
  roleId: uuid("role_id").references(() => platformRoles.id, { onDelete: "restrict" }),
  addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
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
    /**
     * Who else may use it: "everyone" (every college; the platform's default), "selected"
     * (the colleges and teachers in content_shares) or "owner" (its owner's staff only).
     */
    sharing: text("sharing").$type<Sharing>().notNull().default("everyone"),
    /** The item it was copied from, when a college copied it to adapt. */
    copiedFrom: uuid("copied_from"),
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
  /** The day's problem; null on a day of questions alone (see daily_questions). */
  problemId: uuid("problem_id").references(() => problems.id, { onDelete: "cascade" }),
})

/** A day's questions, in order: several MCQs and short answers beside or instead of the problem. */
export const dailyQuestions = pgTable(
  "daily_questions",
  {
    day: text("day").notNull(),
    questionId: uuid("question_id")
      .notNull()
      .references((): AnyPgColumn => questions.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.day, table.questionId] })]
)

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
  /** For save conflicts: a form saved over a newer version is refused. */
  updatedAt: updatedAt(),
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
  /** Students review each other's work after the due time. Null: no peer review. */
  peerReview: jsonb("peer_review").$type<PeerReviewSettings | null>(),
  /** Made from this template; until it opens, the template's edits reach it. */
  templateId: uuid("template_id").references((): AnyPgColumn => templates.id, {
    onDelete: "set null",
  }),
  createdAt: createdAt(),
  /** For save conflicts: a form saved over a newer version is refused. */
  updatedAt: updatedAt(),
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
    /** Times a "System error" was sent back to be judged again (runner housekeeping). */
    rejudges: integer("rejudges").notNull().default(0),
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

/** The kinds (packages/judge/src/kinds): a new kind adds its key here, in the same order. */
export const orgType = pgEnum("org_type", [
  "school",
  "college",
  "coaching",
  "cohort",
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
  /** "pending": signed up on the site and waiting for a platform admin's approval. */
  signupStatus: text("signup_status"),
  /** Languages allowed in its contests and members-only problems; null for all enabled. */
  languages: jsonb("languages").$type<string[] | null>(),
  /** false blocks pasting code in its contests (a deterrent, not a guarantee). */
  allowPaste: boolean("allow_paste").notNull().default(true),
  /** How course outcome attainment is judged; null for the defaults (60%; 50/60/70). */
  attainment: jsonb("attainment").$type<AttainmentRules | null>(),
  /**
   * Which notifications this organization allows, within what the platform allows: only
   * what it changed (packages/judge/src/notifications.ts).
   */
  notifications: jsonb("notifications")
    .$type<PolicyOverrides>()
    .notNull()
    .default({}),
  /**
   * Optional modules switched on or off for this organization, over its type's defaults
   * (packages/judge/src/org-types.ts). Only what was chosen is stored.
   */
  modules: jsonb("modules")
    .$type<Record<string, boolean>>()
    .notNull()
    .default({}),
  /** Each module's own settings, by module key (e.g. timetable: { days }). */
  moduleSettings: jsonb("module_settings")
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  /** The week (its Monday, YYYY-MM-DD) of the last weekly summary sent, so each goes once. */
  digestWeek: text("digest_week"),
  createdAt: createdAt(),
})

/**
 * The platform's decisions for a kind of organization (Admin › Organization kinds): for
 * each module the kind can support, off, optional or on by default. Kinds with no row use
 * their own defaults (packages/judge/src/kinds).
 */
export const orgKindPolicies = pgTable("org_kind_policies", {
  kind: orgType("kind").primaryKey(),
  modules: jsonb("modules").$type<Record<string, string>>().notNull().default({}),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
    /** For kinds whose groups run between dates (a cohort): YYYY-MM-DD, inclusive. */
    startsOn: text("starts_on"),
    endsOn: text("ends_on"),
    /** For kinds with a lead per group (a pod's mentor), not per academic year. */
    leadId: uuid("lead_id").references(() => users.id, { onDelete: "set null" }),
    /** For kinds with open groups (a community): members join and leave it themselves. */
    open: boolean("open").notNull().default(false),
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

/**
 * A parent (or guardian) of a student in an organization (Parent accounts module). A parent
 * isn't a member: this link alone lets them follow that one student, read only.
 */
export const guardians = pgTable(
  "guardians",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    studentId: uuid("student_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Mother, Father, Guardian, or whatever the school writes; may be empty. */
    relation: text("relation").notNull().default(""),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("guardians_link").on(table.orgId, table.parentId, table.studentId),
    index("guardians_parent").on(table.parentId),
    index("guardians_student").on(table.orgId, table.studentId),
  ]
)

/** A title in an organization's library (Library module), with how many copies it owns. */
export const libraryBooks = pgTable(
  "library_books",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    author: text("author").notNull().default(""),
    isbn: text("isbn").notNull().default(""),
    category: text("category").notNull().default(""),
    /** Where it's kept, e.g. "Shelf B3". */
    shelf: text("shelf").notNull().default(""),
    copies: integer("copies").notNull().default(1),
    createdAt: createdAt(),
  },
  (table) => [index("library_books_org").on(table.orgId, table.title)]
)

/** A book lent to a member. Days are "YYYY-MM-DD" in the site's time zone. */
export const libraryLoans = pgTable(
  "library_loans",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    bookId: uuid("book_id")
      .notNull()
      .references(() => libraryBooks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    issuedOn: text("issued_on").notNull(),
    dueOn: text("due_on").notNull(),
    returnedOn: text("returned_on"),
    /** out, returned or lost. */
    status: text("status").notNull().default("out"),
    issuedBy: uuid("issued_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (table) => [
    index("library_loans_org").on(table.orgId, table.status),
    index("library_loans_user").on(table.userId),
    index("library_loans_book").on(table.bookId, table.status),
  ]
)

/** A bus (or van) route of an organization (Transport module). */
export const transportRoutes = pgTable(
  "transport_routes",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** The vehicle's number or registration. */
    vehicle: text("vehicle").notNull().default(""),
    driver: text("driver").notNull().default(""),
    driverPhone: text("driver_phone").notNull().default(""),
    /** Seats; null when not limited. */
    capacity: integer("capacity"),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("transport_routes_name").on(table.orgId, table.name)]
)

/** A stop on a route, in order, with its morning pick-up and afternoon drop-off times. */
export const transportStops = pgTable(
  "transport_stops",
  {
    id: id(),
    routeId: uuid("route_id")
      .notNull()
      .references(() => transportRoutes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    /** "HH:MM", or "" when not set. */
    pickup: text("pickup").notNull().default(""),
    drop: text("drop").notNull().default(""),
  },
  (table) => [index("transport_stops_route").on(table.routeId, table.position)]
)

/** Who rides which route, from which stop. One route per person per organization. */
export const transportRiders = pgTable(
  "transport_riders",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    routeId: uuid("route_id")
      .notNull()
      .references(() => transportRoutes.id, { onDelete: "cascade" }),
    stopId: uuid("stop_id")
      .notNull()
      .references(() => transportStops.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.userId] }),
    index("transport_riders_route").on(table.routeId),
  ]
)

/** A hostel of an organization (Hostel module). */
export const hostels = pgTable(
  "hostels",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Who it's for, as the school says it: "Boys", "Girls", "Staff"; may be empty. */
    forWhom: text("for_whom").notNull().default(""),
    warden: text("warden").notNull().default(""),
    wardenPhone: text("warden_phone").notNull().default(""),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("hostels_name").on(table.orgId, table.name)]
)

export const hostelRooms = pgTable(
  "hostel_rooms",
  {
    id: id(),
    hostelId: uuid("hostel_id")
      .notNull()
      .references(() => hostels.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    floor: text("floor").notNull().default(""),
  },
  (table) => [uniqueIndex("hostel_rooms_name").on(table.hostelId, table.name)]
)

/** A bed in a room, lettered A, B, C... */
export const hostelBeds = pgTable(
  "hostel_beds",
  {
    id: id(),
    roomId: uuid("room_id")
      .notNull()
      .references(() => hostelRooms.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
  },
  (table) => [uniqueIndex("hostel_beds_label").on(table.roomId, table.label)]
)

/** Who sleeps in which bed. One bed per person per organization, one person per bed. */
export const hostelResidents = pgTable(
  "hostel_residents",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    bedId: uuid("bed_id")
      .notNull()
      .references(() => hostelBeds.id, { onDelete: "cascade" }),
    since: text("since").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.userId] }),
    uniqueIndex("hostel_residents_bed").on(table.bedId),
  ]
)

/**
 * A person's second sign-in step (apps/web/features/auth/two-factor.ts): an authenticator
 * app (its secret encrypted with the auth secret), codes by email, or both, and one-time
 * backup codes, hashed. While the app is being set up, its new secret and codes wait in
 * the pending columns.
 */
export const twoFactor = pgTable("two_factor", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  secret: text("secret"),
  /** When it was turned on; a session must have passed the second step since. */
  enabledAt: timestamp("enabled_at", { withTimezone: true }),
  /** The last 30-second step accepted, so a code can't be used twice. */
  lastStep: integer("last_step"),
  backupCodes: jsonb("backup_codes").$type<string[]>().notNull().default([]),
  pendingSecret: text("pending_secret"),
  pendingBackupCodes: jsonb("pending_backup_codes").$type<string[]>().notNull().default([]),
  failures: integer("failures").notNull().default(0),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  /** Codes by email: on or off, and the one code waiting to be typed (hashed). */
  emailOn: boolean("email_on").notNull().default(false),
  emailCode: text("email_code"),
  emailCodeExpires: timestamp("email_code_expires", { withTimezone: true }),
  emailCodeTries: integer("email_code_tries").notNull().default(0),
  emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
  emailSends: integer("email_sends").notNull().default(0),
  emailWindowStart: timestamp("email_window_start", { withTimezone: true }),
  /** Raised to forget every browser trusted for 30 days. */
  trustVersion: integer("trust_version").notNull().default(0),
  updatedAt: updatedAt(),
})

/** A school year of an organization (Student records module); one at most is current. */
export const academicYears = pgTable(
  "academic_years",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** "YYYY-MM-DD". */
    startsOn: text("starts_on").notNull(),
    endsOn: text("ends_on").notNull(),
    isCurrent: boolean("is_current").notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("academic_years_name").on(table.orgId, table.name),
    uniqueIndex("academic_years_current").on(table.orgId).where(sql`${table.isCurrent}`),
  ]
)

/**
 * A student's record in an organization: admission number and details. Phone, date of
 * birth and address are sealed (apps/web/lib/sealed.ts). The person is a user, possibly
 * one who never signs in (packages/judge/src/records.ts, noLoginEmail).
 */
export const studentRecords = pgTable(
  "student_records",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    admissionNo: text("admission_no").notNull(),
    gender: text("gender").notNull().default(""),
    birthDate: text("birth_date"),
    phone: text("phone"),
    address: text("address"),
    admittedOn: text("admitted_on").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.userId] }),
    uniqueIndex("student_records_admission").on(table.orgId, table.admissionNo),
  ]
)

/**
 * Where a student sits in one academic year: a group (section), a roll number, a status.
 * One per student per year. The current year's active ones are the students' places
 * (group_members), kept in step by apps/web/features/records/server.ts.
 */
export const enrolments = pgTable(
  "enrolments",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    yearId: uuid("year_id")
      .notNull()
      .references(() => academicYears.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").references(() => orgGroups.id, {
      onDelete: "set null",
    }),
    rollNo: integer("roll_no"),
    /** active, transferred, graduated or withdrawn. */
    status: text("status").notNull().default("active"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("enrolments_year_user").on(table.yearId, table.userId),
    index("enrolments_group").on(table.groupId),
  ]
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
    /** The action's area ("role" for role.update), for filtering. */
    category: text("category").notNull().default(""),
    summary: text("summary").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    /** Who it was, as they were then ("Name <email>"), kept if the account goes. */
    actorLabel: text("actor_label").notNull().default(""),
    /** Where the request came from, when it came through the API. */
    ip: text("ip"),
    userAgent: text("user_agent"),
    /** Platform staff acting inside an organization they aren't a member of. */
    support: boolean("support").notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    index("audit_log_org").on(table.orgId, table.createdAt),
    index("audit_log_org_category").on(table.orgId, table.category, table.createdAt),
    index("audit_log_org_actor").on(table.orgId, table.actorId, table.createdAt),
  ]
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
    /**
     * "class": a class taught (minutes, topics), from the teaching log. "register": an
     * attendance register only (Attendance module), no minutes or topics. Teaching views
     * read only classes; attendance reads both.
     */
    kind: text("kind").$type<"class" | "register">().notNull().default("class"),
    /** A register's period or subject ("Period 3", "Physics"); "" for a whole-day register. */
    period: text("period").notNull().default(""),
    /** The course a register is for (colleges' course-wise attendance); null for none. */
    subjectId: uuid("subject_id").references((): AnyPgColumn => subjects.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (table) => [
    // One register per group, day, period and course.
    uniqueIndex("attendance_register_unique")
      .on(
        table.groupId,
        table.day,
        table.period,
        sql`coalesce(${table.subjectId}, '00000000-0000-0000-0000-000000000000'::uuid)`
      )
      .where(sql`${table.kind} = 'register'`),
    index("teaching_sessions_subject").on(table.subjectId, table.day),
    index("teaching_sessions_group").on(table.groupId, table.day),
    index("teaching_sessions_teacher").on(table.teacherId, table.day),
  ]
)

/** The subjects an organization teaches (Subjects module): Mathematics, Physics, English. */
export const subjects = pgTable(
  "subjects",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** A short code ("MATH"); "" for none. */
    code: text("code").notNull().default(""),
    description: text("description").notNull().default(""),
    /** Credits, where the kind grades by credits (a college course: 3, 4, 1.5). */
    credits: doublePrecision("credits"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("subjects_name").on(table.orgId, sql`lower(${table.name})`),
    uniqueIndex("subjects_code")
      .on(table.orgId, sql`lower(${table.code})`)
      .where(sql`${table.code} <> ''`),
  ]
)

/** A subject taught in a class (a group), and by whom. */
export const classSubjects = pgTable(
  "class_subjects",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => orgGroups.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    teacherId: uuid("teacher_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("class_subjects_unique").on(table.groupId, table.subjectId),
    index("class_subjects_org").on(table.orgId),
  ]
)

/**
 * A term within an academic year: a semester in a college, a term in a school. Exams
 * belong to one; credit-graded kinds work out an SGPA per term and a CGPA across them.
 */
export const academicTerms = pgTable(
  "academic_terms",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    yearId: uuid("year_id")
      .notNull()
      .references(() => academicYears.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** "YYYY-MM-DD", optional. */
    startsOn: text("starts_on"),
    endsOn: text("ends_on"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("academic_terms_name").on(table.yearId, sql`lower(${table.name})`),
    index("academic_terms_org").on(table.orgId),
  ]
)

/**
 * An exam in an academic year (Exams module): "Unit test 1", "Half-yearly". `weight`
 * says how much it counts toward the year's result (0: it doesn't). Results are seen by
 * students and parents only once published, and marks are locked while they are.
 */
export const termExams = pgTable(
  "term_exams",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    yearId: uuid("year_id")
      .notNull()
      .references(() => academicYears.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** "YYYY-MM-DD", optional. */
    startsOn: text("starts_on"),
    endsOn: text("ends_on"),
    weight: integer("weight").notNull().default(0),
    /** The term (semester) it's part of, if the organization uses terms. */
    termId: uuid("term_id").references(() => academicTerms.id, {
      onDelete: "set null",
    }),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("term_exams_name").on(table.yearId, sql`lower(${table.name})`),
    index("term_exams_org").on(table.orgId),
  ]
)

/** One subject of one exam in one class (a section): its full and pass marks. */
export const examPapers = pgTable(
  "exam_papers",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    examId: uuid("exam_id")
      .notNull()
      .references(() => termExams.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => orgGroups.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    maxMarks: integer("max_marks").notNull(),
    passMarks: doublePrecision("pass_marks").notNull(),
    /** "YYYY-MM-DD", optional. */
    heldOn: text("held_on"),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("exam_papers_unique").on(table.examId, table.groupId, table.subjectId),
    index("exam_papers_group").on(table.groupId),
  ]
)

/** A student's marks in a paper (halves allowed), or that they missed it. */
export const examMarks = pgTable(
  "exam_marks",
  {
    paperId: uuid("paper_id")
      .notNull()
      .references(() => examPapers.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    marks: doublePrecision("marks"),
    absent: boolean("absent").notNull().default(false),
    enteredBy: uuid("entered_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.paperId, table.userId] }),
    index("exam_marks_user").on(table.userId),
  ]
)

/** Each section's class teacher for a year (Student records): they write report card remarks. */
export const classTeachers = pgTable(
  "class_teachers",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    yearId: uuid("year_id")
      .notNull()
      .references(() => academicYears.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => orgGroups.id, { onDelete: "cascade" }),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.yearId, table.groupId] }),
    index("class_teachers_teacher").on(table.teacherId),
  ]
)

/**
 * A report card remark: the class teacher's for a student in an exam (no paper), or a
 * subject teacher's on one paper.
 */
export const reportRemarks = pgTable(
  "report_remarks",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    examId: uuid("exam_id")
      .notNull()
      .references(() => termExams.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    paperId: uuid("paper_id").references(() => examPapers.id, {
      onDelete: "cascade",
    }),
    text: text("text").notNull(),
    writtenBy: uuid("written_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("report_remarks_overall")
      .on(table.examId, table.userId)
      .where(sql`${table.paperId} is null`),
    uniqueIndex("report_remarks_paper")
      .on(table.paperId, table.userId)
      .where(sql`${table.paperId} is not null`),
    index("report_remarks_user").on(table.userId),
  ]
)

/**
 * A request for leave (Leave module): a student's (asked by them or a parent) or a staff
 * member's. `days` counts school days when asked; `type` is a student reason or a staff
 * leave type key (module settings).
 */
export const leaveRequests = pgTable(
  "leave_requests",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** Who is away. */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** student or staff. */
    kind: text("kind").notNull(),
    type: text("type").notNull(),
    startsOn: text("starts_on").notNull(),
    endsOn: text("ends_on").notNull(),
    halfDay: boolean("half_day").notNull().default(false),
    days: doublePrecision("days").notNull(),
    reason: text("reason").notNull().default(""),
    /** pending, approved, rejected or cancelled. */
    status: text("status").notNull().default("pending"),
    requestedBy: uuid("requested_by").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedBy: uuid("decided_by").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    note: text("note").notNull().default(""),
    createdAt: createdAt(),
  },
  (table) => [
    index("leave_requests_org").on(table.orgId, table.status),
    index("leave_requests_user").on(table.userId, table.startsOn),
  ]
)

/** A staff member's attendance on a day (Staff attendance module). */
export const staffAttendance = pgTable(
  "staff_attendance",
  {
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "YYYY-MM-DD" in the site's timezone. */
    day: text("day").notNull(),
    /** present, late, half_day, absent or on_leave. */
    status: text("status").notNull(),
    /** "HH:MM", when they arrived, if known. */
    checkIn: text("check_in"),
    note: text("note").notNull().default(""),
    /** Who marked it; themselves for a self check-in. */
    markedBy: uuid("marked_by").references(() => users.id, {
      onDelete: "set null",
    }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.userId, table.day] }),
    index("staff_attendance_day").on(table.orgId, table.day),
  ]
)

/**
 * An application for admission (Admissions module), made by a signed-in applicant (a
 * parent, or the student themselves) for a grade in an academic year. Birth date, phone
 * and address are sealed (apps/web/lib/sealed.ts). Admitting creates the student
 * (`student_id`) through Student records.
 */
export const admissionApplications = pgTable(
  "admission_applications",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** "APP-2026-0001", unique per organization. */
    number: text("number").notNull(),
    yearId: uuid("year_id").references(() => academicYears.id, {
      onDelete: "set null",
    }),
    gradeId: uuid("grade_id").references(() => orgGroups.id, {
      onDelete: "set null",
    }),
    applicantId: uuid("applicant_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    studentName: text("student_name").notNull(),
    birthDate: text("birth_date").notNull(),
    gender: text("gender").notNull().default(""),
    previousSchool: text("previous_school").notNull().default(""),
    parentName: text("parent_name").notNull(),
    /** mother, father, guardian, or self when the student applies. */
    relation: text("relation").notNull().default(""),
    phone: text("phone").notNull(),
    address: text("address"),
    notes: text("notes").notNull().default(""),
    /** submitted, reviewing, waitlisted, rejected, admitted or withdrawn. */
    status: text("status").notNull().default("submitted"),
    /** What the school tells the applicant with its last decision. */
    message: text("message").notNull().default(""),
    studentId: uuid("student_id").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedBy: uuid("decided_by").references(() => users.id, {
      onDelete: "set null",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("admission_applications_number").on(table.orgId, table.number),
    index("admission_applications_status").on(table.orgId, table.status),
    index("admission_applications_applicant").on(table.applicantId),
  ]
)

/**
 * A transfer certificate issued to a student leaving (Student records). What it says is
 * kept as issued (`details`, sealed JSON: name, birth date, parents, class…), so a reprint
 * matches the original even after the record changes.
 */
export const transferCertificates = pgTable(
  "transfer_certificates",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** "TC-2026-0001", unique per organization. */
    number: text("number").notNull(),
    issuedOn: text("issued_on").notNull(),
    leavingDate: text("leaving_date").notNull(),
    reason: text("reason").notNull().default(""),
    conduct: text("conduct").notNull().default(""),
    remarks: text("remarks").notNull().default(""),
    details: text("details").notNull(),
    issuedBy: uuid("issued_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("transfer_certificates_number").on(table.orgId, table.number),
    index("transfer_certificates_user").on(table.userId),
  ]
)

/** The organization's daily periods, in order (Timetable module). */
export const timetablePeriods = pgTable(
  "timetable_periods",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** "09:00", 24-hour. */
    starts: text("starts").notNull(),
    ends: text("ends").notNull(),
    /** A break (lunch, recess): shown in the grid, never scheduled. */
    isBreak: boolean("is_break").notNull().default(false),
    position: integer("position").notNull(),
  },
  (table) => [index("timetable_periods_org").on(table.orgId, table.position)]
)

/** One cell of a class's week: on this day, in this period, this class subject. */
export const timetableSlots = pgTable(
  "timetable_slots",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => orgGroups.id, { onDelete: "cascade" }),
    /** 1 = Monday ... 7 = Sunday. */
    day: integer("day").notNull(),
    periodId: uuid("period_id")
      .notNull()
      .references(() => timetablePeriods.id, { onDelete: "cascade" }),
    classSubjectId: uuid("class_subject_id")
      .notNull()
      .references(() => classSubjects.id, { onDelete: "cascade" }),
    room: text("room").notNull().default(""),
  },
  (table) => [
    uniqueIndex("timetable_slot_unique").on(table.groupId, table.day, table.periodId),
    index("timetable_slots_org").on(table.orgId),
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
    /** Counted as there: present or late. Kept in step with `status`. */
    present: boolean("present").notNull(),
    /** present, absent, late, or excused (left out of percentages). */
    status: text("status")
      .$type<"present" | "absent" | "late" | "excused">()
      .notNull()
      .default("present"),
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

/**
 * A quiz question, kept in a bank like problems: written or imported once, used in any
 * assignment, exam, contest or daily challenge. Rules: packages/judge/src/quiz.ts.
 */
export const questions = pgTable(
  "questions",
  {
    id: id(),
    /** Its owner: an organization, or null for the platform. */
    orgId: uuid("org_id").references((): AnyPgColumn => organizations.id, {
      onDelete: "cascade",
    }),
    /** A short name for lists and pickers. */
    title: text("title").notNull(),
    kind: text("kind").$type<QuestionKind>().notNull(),
    /** Markdown. */
    prompt: text("prompt").notNull(),
    options: jsonb("options").$type<{ id: string; text: string }[]>().notNull().default([]),
    /** Choice questions: the right option ids. Never sent to students before results. */
    correct: jsonb("correct").$type<string[]>().notNull().default([]),
    /** Short answers that mark themselves right. */
    accepted: jsonb("accepted").$type<string[]>().notNull().default([]),
    /** Shown with the right answer once results are out. Markdown. */
    explanation: text("explanation").notNull().default(""),
    /** Suggested points; each assignment or contest sets its own. */
    points: integer("points").notNull().default(1),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    /** Ready to use; drafts only for their writers. */
    published: boolean("published").notNull().default(true),
    /** As on problems: everyone, selected or owner. */
    sharing: text("sharing").$type<Sharing>().notNull().default("everyone"),
    copiedFrom: uuid("copied_from"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("questions_by_org").on(table.orgId)]
)

export type Sharing = "everyone" | "selected" | "owner"

/** The colleges and teachers an item shared with "selected" reaches. */
export const contentShares = pgTable(
  "content_shares",
  {
    id: id(),
    itemType: text("item_type").$type<"problem" | "question" | "course" | "template">().notNull(),
    itemId: uuid("item_id").notNull(),
    /** A college (all its staff)… */
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    /** …or one teacher. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (table) => [index("content_shares_by_item").on(table.itemType, table.itemId)]
)

/** A named folder of library items, for an owner (the platform or a college). */
export const collections = pgTable(
  "collections",
  {
    id: id(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    createdAt: createdAt(),
  },
  (table) => [index("collections_by_org").on(table.orgId)]
)

/** What a collection holds. An item can be in several collections. */
export const collectionItems = pgTable(
  "collection_items",
  {
    collectionId: uuid("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    itemType: text("item_type").$type<"problem" | "question">().notNull(),
    itemId: uuid("item_id").notNull(),
    position: integer("position").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.collectionId, table.itemType, table.itemId] })]
)

/** A bank question in an assignment or exam, with its points there. */
export const assignmentQuestions = pgTable(
  "assignment_questions",
  {
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "restrict" }),
    points: integer("points").notNull().default(1),
    position: integer("position").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.assignmentId, table.questionId] })]
)

/** One student's answers to an assignment's questions, and any marks a teacher gave. */
export const quizResponses = pgTable(
  "quiz_responses",
  {
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Question id → chosen option ids, or text. */
    answers: jsonb("answers").$type<Record<string, string[] | string>>().notNull().default({}),
    /** Question id → a teacher's mark, replacing the automatic one. */
    marks: jsonb("marks").$type<Record<string, number>>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.assignmentId, table.userId] })]
)

/** A bank question in a contest: marked automatically, answered once. */
export const contestQuestions = pgTable(
  "contest_questions",
  {
    contestId: uuid("contest_id")
      .notNull()
      .references(() => contests.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "restrict" }),
    /** Q1, Q2… beside the problems' A, B. */
    label: text("label").notNull(),
    points: integer("points").notNull().default(1),
    position: integer("position").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.contestId, table.questionId] })]
)

/** A contestant's one answer to a contest question. */
export const contestAnswers = pgTable(
  "contest_answers",
  {
    contestId: uuid("contest_id")
      .notNull()
      .references(() => contests.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    answer: jsonb("answer").$type<string[] | string>().notNull(),
    correct: boolean("correct").notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.contestId, table.questionId, table.userId] })]
)

/** A student's one answer to each of a day's questions. */
export const dailyAnswers = pgTable(
  "daily_answers",
  {
    day: text("day").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    answer: jsonb("answer").$type<string[] | string>().notNull(),
    correct: boolean("correct").notNull(),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.day, table.userId, table.questionId] })]
)

/**
 * A later due date for one student: for the whole assignment, or only some of its
 * problems (reopening them after feedback is how resubmission works).
 */
export const assignmentExtensions = pgTable(
  "assignment_extensions",
  {
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    /** Problem ids it covers; empty for the whole assignment. */
    problemIds: jsonb("problem_ids").$type<string[]>().notNull().default([]),
    reason: text("reason").notNull().default(""),
    grantedBy: uuid("granted_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (table) => [primaryKey({ columns: [table.assignmentId, table.userId] })]
)

/**
 * Things that happened for someone: new work, feedback released, an extension, a class
 * notice. Reminders that depend on time (due tomorrow) are worked out when read instead.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    /** Where it leads, a path on this site. */
    href: text("href").notNull().default(""),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index("notifications_by_user").on(table.userId, table.createdAt)]
)

/**
 * Email waiting to go out (a transactional outbox). notify() adds rows in the same
 * transaction as the notifications, and drainOutbox() (apps/web/features/notifications)
 * sends them in batches with retries, so a slow or failing mail server never loses mail or
 * slows the action that caused it. Sent rows are deleted after a week.
 */
export const emailStatus = pgEnum("email_status", [
  "queued",
  "sending",
  "sent",
  "failed",
])

export const emailOutbox = pgTable(
  "email_outbox",
  {
    id: id(),
    to: text("to_address").notNull(),
    subject: text("subject").notNull(),
    text: text("body").notNull(),
    status: emailStatus("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** When a worker took it; a send still "sending" long after was cut off. */
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    lastError: text("last_error"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    /** Sign-in codes and security notices: sent ahead of everything else. */
    urgent: boolean("urgent").notNull().default(false),
    /** Not worth sending after this (a code that has expired); dropped instead. */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [
    index("email_outbox_due").on(table.status, table.nextAttemptAt),
    index("email_outbox_urgent").on(table.status, table.urgent, table.nextAttemptAt),
  ]
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

/**
 * A course: an ordered outline of modules, each with problems and questions, written once
 * by an owner (the platform or a college) and used by any number of classes.
 */
export const courses = pgTable(
  "courses",
  {
    id: id(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    published: boolean("published").notNull().default(false),
    /** Like the library's: the platform's courses reach every college, chosen ones, or staff. */
    sharing: text("sharing").$type<Sharing>().notNull().default("owner"),
    copiedFrom: uuid("copied_from"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("courses_by_org").on(table.orgId)]
)

/**
 * A module of a course. Release rules: `openAfterDays` after the class starts the course,
 * and/or `afterPrevious` (once the student has finished the module before it).
 */
export const courseModules = pgTable(
  "course_modules",
  {
    id: id(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    position: integer("position").notNull().default(0),
    openAfterDays: integer("open_after_days"),
    afterPrevious: boolean("after_previous").notNull().default(false),
  },
  (table) => [index("course_modules_by_course").on(table.courseId, table.position)]
)

/** A problem or question in a module, in order. */
export const courseItems = pgTable(
  "course_items",
  {
    moduleId: uuid("module_id")
      .notNull()
      .references(() => courseModules.id, { onDelete: "cascade" }),
    itemType: text("item_type").$type<"problem" | "question">().notNull(),
    itemId: uuid("item_id").notNull(),
    position: integer("position").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.moduleId, table.itemType, table.itemId] }),
    index("course_items_by_item").on(table.itemType, table.itemId),
  ]
)

/** A course taught to a class, starting on a day (module release counts from it). */
export const courseClasses = pgTable(
  "course_classes",
  {
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => orgGroups.id, { onDelete: "cascade" }),
    /** YYYY-MM-DD */
    startsOn: text("starts_on").notNull(),
    /** Assigned training: finish by this day (YYYY-MM-DD). */
    dueOn: text("due_on"),
    /** Assigned training: done again every this many months (compliance). */
    renewMonths: integer("renew_months"),
    addedBy: uuid("added_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.courseId, table.groupId] }),
    index("course_classes_by_group").on(table.groupId),
  ]
)

/** A student's latest answer to a course's practice question; they may try again. */
export const practiceAnswers = pgTable(
  "practice_answers",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    questionId: uuid("question_id")
      .notNull()
      .references(() => questions.id, { onDelete: "cascade" }),
    answer: jsonb("answer").$type<string[] | string>().notNull(),
    correct: boolean("correct").notNull(),
    tries: integer("tries").notNull().default(1),
    answeredAt: timestamp("answered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.questionId] })]
)

/** What a template holds: an assignment or exam without its dates, address or audience. */
export interface TemplateContent {
  allowLate: boolean
  latePenaltyPercent: number
  holdFeedback: boolean
  /** Lab networks belong to each use, so a template's exam has none. */
  exam: ExamSettings | null
  problems: { problemId: string; points: number; rubric: RubricCriterion[] }[]
  questions: { questionId: string; points: number }[]
}

/**
 * An assignment or exam written once and used many times: each use is an ordinary
 * assignment for a class (or the platform) with its own dates (`assignments.template_id`).
 */
export const templates = pgTable(
  "templates",
  {
    id: id(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    content: jsonb("content").$type<TemplateContent>().notNull(),
    /** Drafts can't be used yet. */
    published: boolean("published").notNull().default(true),
    sharing: text("sharing").$type<Sharing>().notNull().default("owner"),
    copiedFrom: uuid("copied_from"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("templates_by_org").on(table.orgId)]
)

/**
 * A class's discussion: threads (no parent) and their replies. Anonymous posts hide the
 * author from classmates, never from teachers. Teachers pin, lock, hide and mark answers.
 */
export const discussionPosts = pgTable(
  "discussion_posts",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => orgGroups.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => discussionPosts.id, {
      onDelete: "cascade",
    }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    /** Threads only. */
    title: text("title").notNull().default(""),
    body: text("body").notNull(),
    anonymous: boolean("anonymous").notNull().default(false),
    pinned: boolean("pinned").notNull().default(false),
    locked: boolean("locked").notNull().default(false),
    /** Hidden by a teacher: only teachers and the author see it. */
    hidden: boolean("hidden").notNull().default(false),
    /** Deleted with replies under it: kept as "deleted" so the replies make sense. */
    deleted: boolean("deleted").notNull().default(false),
    /** Threads: the reply a teacher marked as the answer. */
    answerId: uuid("answer_id"),
    createdAt: createdAt(),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    /** Threads: when it or a reply was last posted, for ordering. */
    activityAt: timestamp("activity_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("discussion_threads").on(table.groupId, table.activityAt),
    index("discussion_replies").on(table.parentId, table.createdAt),
  ]
)

/** One person's +1 on a post. */
export const discussionVotes = pgTable(
  "discussion_votes",
  {
    postId: uuid("post_id")
      .notNull()
      .references(() => discussionPosts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.postId, table.userId] })]
)

/**
 * One student's review of a classmate's final submission for an assignment problem.
 * Written against the problem's rubric (or one overall score); never changes marks.
 */
export const peerReviews = pgTable(
  "peer_reviews",
  {
    id: id(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    problemId: uuid("problem_id")
      .notNull()
      .references(() => problems.id, { onDelete: "cascade" }),
    reviewerId: uuid("reviewer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    authorId: uuid("author_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The author's work as it was when reviews were handed out. */
    submissionId: uuid("submission_id").references(() => submissions.id, { onDelete: "set null" }),
    scores: jsonb("scores").$type<Record<string, number>>().notNull().default({}),
    comment: text("comment").notNull().default(""),
    lineComments: jsonb("line_comments")
      .$type<{ path: string; line: number; body: string }[]>()
      .notNull()
      .default([]),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    /** Hidden by a teacher: its author doesn't see it. */
    hidden: boolean("hidden").notNull().default(false),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("peer_reviews_pair").on(table.assignmentId, table.problemId, table.reviewerId, table.authorId),
    index("peer_reviews_reviewer").on(table.reviewerId),
  ]
)

/**
 * A certificate given to a student: for finishing a course in a class, or one a teacher
 * writes. Anyone can check it at /certificates/<code>; revoked ones say so.
 */
export const certificates = pgTable(
  "certificates",
  {
    id: id(),
    /** Short and public: what the verification page is found by. */
    code: text("code").notNull().unique(),
    orgId: uuid("org_id").references(() => organizations.id, { onDelete: "cascade" }),
    groupId: uuid("group_id").references(() => orgGroups.id, { onDelete: "set null" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"course" | "custom" | "graduation">().notNull(),
    /** The course it's for (kind course). */
    sourceId: uuid("source_id"),
    title: text("title").notNull(),
    detail: text("detail").notNull().default(""),
    issuedBy: uuid("issued_by").references(() => users.id, { onDelete: "set null" }),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    /** For training that must be renewed: no longer valid after this day (YYYY-MM-DD). */
    expiresOn: text("expires_on"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    index("certificates_by_user").on(table.userId),
    index("certificates_by_group").on(table.groupId),
  ]
)

/** Project work in an assignment: handed in as a GitHub repository, marked by a teacher. */
export const assignmentProjects = pgTable(
  "assignment_projects",
  {
    id: id(),
    assignmentId: uuid("assignment_id")
      .notNull()
      .references(() => assignments.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    /** Markdown: what to build and how it's marked. */
    instructions: text("instructions").notNull().default(""),
    points: integer("points").notNull().default(10),
    position: integer("position").notNull().default(0),
  },
  (table) => [index("assignment_projects_by_assignment").on(table.assignmentId, table.position)]
)

/**
 * A student's repository for a project, pinned to the commit it was at when handed in, so
 * later pushes don't change what's marked. Handing in again replaces it.
 */
export const projectSubmissions = pgTable(
  "project_submissions",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => assignmentProjects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** https://github.com/owner/repo */
    repoUrl: text("repo_url").notNull(),
    ref: text("ref"),
    commitSha: text("commit_sha"),
    note: text("note").notNull().default(""),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    late: boolean("late").notNull().default(false),
    mark: integer("mark"),
    feedback: text("feedback").notNull().default(""),
    markedBy: uuid("marked_by").references(() => users.id, { onDelete: "set null" }),
    markedAt: timestamp("marked_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.userId] })]
)

/*
 * LTI 1.3: learning platforms (Moodle, Canvas, Blackboard) an organization connects, so
 * their courses open Gretlab with people signed in and grades go back. features/lti.
 */

/** An LMS registration: what the LMS gave the organization's admin. */
export const ltiPlatforms = pgTable(
  "lti_platforms",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    issuer: text("issuer").notNull(),
    clientId: text("client_id").notNull(),
    deploymentIds: jsonb("deployment_ids").$type<string[]>().notNull().default([]),
    authUrl: text("auth_url").notNull(),
    tokenUrl: text("token_url").notNull(),
    jwksUrl: text("jwks_url").notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("lti_platforms_client").on(table.issuer, table.clientId)]
)

/** A sign-in handshake in flight: state and nonce, used once, short-lived. */
export const ltiStates = pgTable("lti_states", {
  state: text("state").primaryKey(),
  nonce: text("nonce").notNull(),
  platformId: uuid("platform_id")
    .notNull()
    .references(() => ltiPlatforms.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
})

/** Who an LMS user is here. */
export const ltiUsers = pgTable(
  "lti_users",
  {
    platformId: uuid("platform_id")
      .notNull()
      .references(() => ltiPlatforms.id, { onDelete: "cascade" }),
    sub: text("sub").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.platformId, table.sub] }), index("lti_users_user").on(table.userId)]
)

/** An LMS course, linked by an admin to one of the organization's classes. */
export const ltiContexts = pgTable(
  "lti_contexts",
  {
    id: id(),
    platformId: uuid("platform_id")
      .notNull()
      .references(() => ltiPlatforms.id, { onDelete: "cascade" }),
    contextId: text("context_id").notNull(),
    title: text("title").notNull().default(""),
    groupId: uuid("group_id").references(() => orgGroups.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("lti_contexts_key").on(table.platformId, table.contextId)]
)

/** A link in an LMS course that opens an assignment, with its gradebook column there. */
export const ltiLinks = pgTable(
  "lti_links",
  {
    id: id(),
    platformId: uuid("platform_id")
      .notNull()
      .references(() => ltiPlatforms.id, { onDelete: "cascade" }),
    resourceLinkId: text("resource_link_id").notNull(),
    contextId: uuid("context_id").references(() => ltiContexts.id, { onDelete: "set null" }),
    assignmentId: uuid("assignment_id").references(() => assignments.id, { onDelete: "set null" }),
    /** Where its scores go (LTI Assignment and Grade Services). */
    lineItemUrl: text("line_item_url"),
    title: text("title").notNull().default(""),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("lti_links_key").on(table.platformId, table.resourceLinkId)]
)

/** A teacher choosing what to add to an LMS course (deep linking), short-lived. */
export const ltiDeepLinks = pgTable("lti_deep_links", {
  id: id(),
  platformId: uuid("platform_id")
    .notNull()
    .references(() => ltiPlatforms.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  deploymentId: text("deployment_id").notNull(),
  returnUrl: text("return_url").notNull(),
  data: text("data"),
  contextId: uuid("context_id").references(() => ltiContexts.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
})

/** Gretlab's own signing keys (deep linking responses, grade service tokens). */
export const ltiKeys = pgTable("lti_keys", {
  kid: text("kid").primaryKey(),
  privateKey: text("private_key").notNull(),
  publicJwk: jsonb("public_jwk").$type<Record<string, string>>().notNull(),
  createdAt: createdAt(),
})

/**
 * An organization's events (the "events" module): a meetup, workshop or talk, for everyone
 * or one group (and the groups inside it), in person or online, with an optional capacity.
 */
export const orgEvents = pgTable(
  "org_events",
  {
    id: id(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    /** null: everyone in the organization. */
    groupId: uuid("group_id").references(() => orgGroups.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
    location: text("location").notNull().default(""),
    /** An online meeting's address; shown only to people going. */
    link: text("link").notNull().default(""),
    /** Places; null for no limit. Past it, people wait. */
    capacity: integer("capacity"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (table) => [index("org_events_by_org").on(table.orgId, table.startsAt)]
)

/** Who's coming to an event: going, waiting for a place, or not going. */
export const eventRsvps = pgTable(
  "event_rsvps",
  {
    eventId: uuid("event_id")
      .notNull()
      .references(() => orgEvents.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status").$type<"going" | "waitlist" | "not_going">().notNull(),
    /** When they last said they were coming: their place in the queue. */
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.eventId, table.userId] }),
    index("event_rsvps_by_user").on(table.userId),
  ]
)

export type OrgEvent = typeof orgEvents.$inferSelect
