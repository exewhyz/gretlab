import type { KindDefinition } from "./types.ts"

/** A cohort program or bootcamp: learners go through together, with mentors. */
export const cohort = {
  key: "cohort",
  label: "Cohort program",
  noun: "program",
  description:
    "Learners go through a program together on a schedule, in pods with mentors.",
  examples: "Bootcamps, fellowships, accelerators and cohort-based courses.",
  decides: [
    "Learners are grouped in cohorts and pods, each pod with a mentor.",
    "Work runs on the cohort's schedule: live sessions, projects and deadlines.",
    "Progress is by work done and sessions attended; there are no school-style exams.",
    "No parents, admissions office, hostel or transport.",
  ],
  terms: {
    learner: "Learner",
    learners: "Learners",
    instructor: "Mentor",
    instructors: "Mentors",
    guardian: null,
    guardians: null,
    group: "Cohort",
    groups: "Cohorts",
    groupLead: "Mentor",
    period: "Cohort run",
    periods: "Cohort runs",
    part: "Module",
    parts: "Modules",
    assessment: "Assessment",
    assessments: "Assessments",
  },
  groupLevels: ["Cohort", "Pod"],
  capabilities: ["attendance", "timetable", "subjects", "leave"],
  defaults: ["attendance"],
  grading: "none",
  groupDates: true,
  leadPerGroup: true,
  roleNames: {
    owner: "Owner",
    admin: "Program manager",
    teacher: "Mentor",
    member: "Learner",
  },
} as const satisfies KindDefinition
