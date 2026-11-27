import type { KindDefinition } from "./types.ts"

/**
 * A university: schools, departments and programs, semesters and credits, and (an affiliating
 * university) the colleges affiliated to it, for which it sets the syllabus, registers
 * students, holds the university exams and publishes results.
 */
export const university = {
  key: "university",
  label: "University",
  noun: "university",
  description:
    "Schools, departments and programs, semesters and credits, and the colleges affiliated to it.",
  examples:
    "State and private universities, deemed universities, affiliating universities.",
  decides: [
    "Programs sit under schools and departments (Engineering › CSE › B.Tech), with batches below.",
    "Teaching is by course with credits; grade cards show SGPA and CGPA.",
    "Affiliated colleges can be approved: the university sets their syllabus, registers their students and publishes their university results.",
    "It sees its colleges' academics, never their fees, parents or staff records.",
    "Admissions, hostel, transport and the library are available for its own campus.",
  ],
  terms: {
    learner: "Student",
    learners: "Students",
    instructor: "Faculty member",
    instructors: "Faculty",
    guardian: "Parent",
    guardians: "Parents",
    group: "Program",
    groups: "Programs",
    groupLead: "Program coordinator",
    period: "Academic year",
    periods: "Academic years",
    part: "Semester",
    parts: "Semesters",
    assessment: "Examination",
    assessments: "Examinations",
  },
  groupLevels: ["School", "Department", "Program"],
  capabilities: [
    "coding",
    "records",
    "admissions",
    "exams",
    "leave",
    "staffAttendance",
    "attendance",
    "timetable",
    "subjects",
    "parents",
    "library",
    "transport",
    "hostel",
    "events",
    "finance",
    "affiliation",
  ],
  defaults: [
    "coding",
    "records",
    "admissions",
    "exams",
    "leave",
    "staffAttendance",
    "attendance",
    "timetable",
    "subjects",
    "affiliation",
  ],
  grading: "credits",
  groupDates: false,
  leadPerGroup: false,
  openGroups: false,
  roleNames: {
    owner: "Owner",
    admin: "Admin",
    teacher: "Faculty",
    member: "Member",
  },
} as const satisfies KindDefinition
