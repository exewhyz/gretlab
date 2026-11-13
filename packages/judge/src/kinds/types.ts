/*
 * What a kind of organization is (school, college, coaching institute, cohort program,
 * company, community…). Each kind is one file in this folder describing how that kind of
 * place works: its words, how its people are grouped, which modules it can use and which
 * start on, and what its roles are called. Everything that differs by kind reads from here,
 * so a new kind is a new file (plus the enum value in the database).
 */

/** The words a kind uses, singular and plural where both are needed. */
export interface KindTerms {
  /** Who learns there: Student, Learner, Employee, Member. */
  learner: string
  learners: string
  /** Who teaches or leads them: Teacher, Faculty, Mentor, Manager, Moderator. */
  instructor: string
  instructors: string
  /** Who looks after a learner, when the kind has them: Parent. */
  guardian: string | null
  guardians: string | null
  /** A group people sit in: Class, Batch, Cohort, Team, Group. */
  group: string
  groups: string
  /** The one in charge of a group: Class teacher, Faculty advisor, Mentor. */
  groupLead: string
  /** The span work is organized in: Academic year, Session, Cohort run. */
  period: string
  periods: string
  /** A part of a period: Semester, Term, Module. */
  part: string
  parts: string
  /** A formal test: Exam, Assessment. */
  assessment: string
  assessments: string
}

/** How much a module is available to a kind, as the platform decides. */
export type ModuleLevel = "off" | "optional" | "default"

export interface KindDefinition {
  key: string
  /** Its name: School, College. */
  label: string
  /** What its people call it in a sentence: "the school", "the institute", "the program". */
  noun: string
  /** One line saying what it's for, shown when choosing a kind. */
  description: string
  /** What choosing it decides, shown before creating (the kind can't be changed later). */
  decides: string[]
  /** Examples, so people pick the right one. */
  examples: string
  terms: KindTerms
  /** Default names of the group levels, top first (editable per organization later). */
  groupLevels: string[]
  /** Modules this kind can use at all; the platform may switch them off, never add others. */
  capabilities: readonly string[]
  /** Of those, the ones on when an organization of this kind starts. */
  defaults: readonly string[]
  /**
   * How it grades: by marks and a percentage scale (schools, coaching), by credits and grade
   * points with SGPA and CGPA (colleges), or not at all (cohorts, companies, communities).
   */
  grading: "marks" | "credits" | "none"
  /** Its groups run between dates (a cohort, a coaching batch): week 3 of 12. */
  groupDates: boolean
  /**
   * Each group has its own lead (a pod's mentor, a team's manager), not a lead per academic
   * year (a school's class teacher, kept in class_teachers).
   */
  leadPerGroup: boolean
  /** Members find groups and join or leave them themselves (a club's groups). */
  openGroups: boolean
  /** What its built-in roles are called (the permissions stay the same). */
  roleNames: { owner: string; admin: string; teacher: string; member: string }
  /** The platform's default for a capable module that isn't on by default. */
  optionalByDefault?: true
}
