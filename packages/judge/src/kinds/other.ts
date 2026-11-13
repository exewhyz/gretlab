import type { KindDefinition } from "./types.ts"

/** Anything else: plain groups and the core features, with a few modules to add. */
export const other = {
  key: "other",
  label: "Other",
  noun: "organization",
  description:
    "Plain groups with the core features, for anything that isn't one of the above.",
  examples: "Training centres, NGOs, study groups and anything else.",
  decides: [
    "People are in plain groups you name yourself.",
    "The core features (assignments, contests, practice, notices) are on; a few modules can be added.",
    "No school structures unless the platform allows them.",
  ],
  terms: {
    learner: "Member",
    learners: "Members",
    instructor: "Instructor",
    instructors: "Instructors",
    guardian: null,
    guardians: null,
    group: "Group",
    groups: "Groups",
    groupLead: "Lead",
    period: "Term",
    periods: "Terms",
    part: "Term",
    parts: "Terms",
    assessment: "Assessment",
    assessments: "Assessments",
  },
  groupLevels: ["Group"],
  capabilities: ["attendance", "timetable", "subjects", "library"],
  defaults: [],
  grading: "marks",
  roleNames: {
    owner: "Owner",
    admin: "Admin",
    teacher: "Instructor",
    member: "Member",
  },
} as const satisfies KindDefinition
