import type { KindDefinition } from "./types.ts"

/** A community or club: people who learn and compete together, run by moderators. */
export const community = {
  key: "community",
  label: "Community",
  noun: "community",
  description: "Groups of people who practise, discuss and compete together.",
  examples:
    "Coding clubs, student chapters, meetup groups and online communities.",
  decides: [
    "Members join groups; moderators look after them.",
    "Practice, contests and discussions are the heart of it.",
    "No school structures: no academic years, exams, parents, admissions or attendance.",
  ],
  terms: {
    learner: "Member",
    learners: "Members",
    instructor: "Moderator",
    instructors: "Moderators",
    guardian: null,
    guardians: null,
    group: "Group",
    groups: "Groups",
    groupLead: "Moderator",
    period: "Season",
    periods: "Seasons",
    part: "Round",
    parts: "Rounds",
    assessment: "Contest",
    assessments: "Contests",
  },
  groupLevels: ["Group"],
  capabilities: [],
  defaults: [],
  grading: "none",
  groupDates: false,
  leadPerGroup: true,
  roleNames: {
    owner: "Owner",
    admin: "Admin",
    teacher: "Moderator",
    member: "Member",
  },
} as const satisfies KindDefinition
