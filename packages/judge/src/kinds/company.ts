import type { KindDefinition } from "./types.ts"

/** A company training its people: teams, managers, assigned learning. */
export const company = {
  key: "company",
  label: "Company",
  noun: "company",
  description:
    "Teams and managers, with training assigned to people and tracked.",
  examples: "Companies running onboarding, upskilling or compliance training.",
  decides: [
    "People are grouped in departments and teams, led by managers.",
    "Training is assigned with due dates; managers follow their team's progress.",
    "No school structures: no academic years, exams, parents or admissions.",
  ],
  terms: {
    learner: "Employee",
    learners: "Employees",
    instructor: "Manager",
    instructors: "Managers",
    guardian: null,
    guardians: null,
    group: "Team",
    groups: "Teams",
    groupLead: "Manager",
    period: "Quarter",
    periods: "Quarters",
    assessment: "Assessment",
    assessments: "Assessments",
  },
  groupLevels: ["Department", "Team"],
  capabilities: ["attendance"],
  defaults: [],
  roleNames: {
    owner: "Owner",
    admin: "L&D admin",
    teacher: "Manager",
    member: "Employee",
  },
} as const satisfies KindDefinition
