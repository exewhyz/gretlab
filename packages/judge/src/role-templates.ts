import type { OrgType } from "./org-types.ts"
import { isPermission, type Permission } from "./permissions.ts"

/*
 * Suggested roles for each kind of organization, beyond the four built-in ones (owner,
 * admin, instructor, member): the jobs such places actually have, each a ready set of
 * permissions. A new organization starts with its kind's; the Roles page offers any it
 * doesn't have yet; they're ordinary roles after that (rename, change, delete). Platform
 * staff may replace a kind's list (Dashboard › Organization kinds), stored in
 * org_kind_policies.role_templates; this is the default.
 *
 * `scope` says how the role is meant to be given: across the organization, or within a
 * group (a head of department for their department, a class teacher for their class).
 */

export interface RoleTemplate {
  key: string
  name: string
  description: string
  permissions: Permission[]
  scope: "organization" | "group"
}

const t = (
  key: string,
  name: string,
  scope: RoleTemplate["scope"],
  description: string,
  permissions: Permission[]
): RoleTemplate => ({ key, name, scope, description, permissions })

const TEACHING: Permission[] = [
  "org.members.view",
  "problems.manage",
  "assignments.manage",
  "gradebook.view",
  "gradebook.export",
  "notices.manage",
  "teaching.log",
  "attendance.mark",
  "attendance.view",
]

const LEADERSHIP: Permission[] = [
  "org.members.view",
  "org.members.invite",
  "org.groups.manage",
  "students.manage",
  "parents.manage",
  "exams.manage",
  "subjects.manage",
  "timetable.manage",
  "attendance.view",
  "staff_attendance.view",
  "leave.manage",
  "admissions.manage",
  "gradebook.view",
  "reports.view",
  "notices.manage",
  "events.manage",
  "org.outcomes.manage",
  "org.audit.view",
]

export const ROLE_TEMPLATES: Record<OrgType, RoleTemplate[]> = {
  school: [
    t("principal", "Principal", "organization", "Runs the school day to day: students, staff, exams, timetable, admissions and reports. Not settings or roles.", LEADERSHIP),
    t("vice_principal", "Vice principal", "organization", "Discipline, attendance, leave and the timetable; sees every class's progress.", [
      "org.members.view", "students.view", "parents.view", "exams.view", "attendance.view", "staff_attendance.mark", "staff_attendance.view",
      "leave.manage", "timetable.manage", "gradebook.view", "reports.view", "notices.manage", "events.manage",
    ]),
    t("class_teacher", "Class teacher", "group", "Looks after their class: register, leave, parents, report card remarks, as well as teaching.", [
      ...TEACHING, "students.view", "parents.view", "leave.students", "exams.remarks", "exams.marks", "reports.view",
    ]),
    t("subject_teacher", "Subject teacher", "group", "Teaches a subject in the classes they're given: work, grades, marks, register.", [...TEACHING, "exams.marks"]),
    t("exam_coordinator", "Exam coordinator", "organization", "Sets up exams and grading, follows marks entry, publishes results.", [
      "exams.manage", "students.view", "subjects.manage", "reports.view", "notices.manage",
    ]),
    t("admissions_officer", "Admissions officer", "organization", "Runs admissions: reviews applications, admits students, links parents.", [
      "admissions.manage", "students.manage", "parents.manage", "org.members.invite",
    ]),
    t("office_staff", "Office staff", "organization", "Front office: student records, parent accounts, members and notices.", [
      "org.members.view", "org.members.invite", "org.members.import", "students.manage", "parents.manage", "notices.manage", "staff_attendance.mark",
    ]),
    t("librarian", "Librarian", "organization", "The library: catalog, lending and returns.", ["library.manage", "students.view"]),
    t("transport_manager", "Transport manager", "organization", "Bus routes, stops and who rides which.", ["transport.manage", "students.view", "notices.manage"]),
    t("hostel_warden", "Hostel warden", "organization", "Hostel rooms and beds, who stays where, and boarders' leave.", ["hostel.manage", "students.view", "leave.students"]),
    t("counselor", "Counselor", "organization", "Sees how students are doing (attendance, grades, reports) to support them.", [
      "students.view", "parents.view", "attendance.view", "gradebook.view", "reports.view",
    ]),
  ],
  college: [
    t("dean", "Dean / Principal", "organization", "Runs the college: departments, faculty, exams, admissions and reports. Not settings or roles.", LEADERSHIP),
    t("hod", "Head of department", "group", "Leads a department: its courses, timetable, faculty's teaching, results and leave.", [
      ...TEACHING, "org.groups.edit", "subjects.manage", "timetable.manage", "exams.manage", "leave.manage", "reports.view", "events.manage", "org.outcomes.manage", "students.view",
    ]),
    t("faculty_advisor", "Faculty advisor", "group", "Mentors a batch: their attendance, grades, leave and parents.", [
      "org.members.view", "students.view", "parents.view", "attendance.view", "gradebook.view", "reports.view", "leave.students", "exams.remarks", "notices.manage",
    ]),
    t("lab_assistant", "Lab assistant", "group", "Helps in labs: takes the register and grades submissions.", [
      "org.members.view", "attendance.mark", "assignments.grade", "gradebook.view", "teaching.log",
    ]),
    t("exam_cell", "Exam cell", "organization", "Assessments, credits and grade cards across the college.", [
      "exams.manage", "students.view", "subjects.manage", "attendance.view", "reports.view", "notices.manage",
    ]),
    t("admissions_office", "Admissions office", "organization", "Applications, admissions and student records.", [
      "admissions.manage", "students.manage", "parents.manage", "org.members.invite", "org.members.import",
    ]),
    t("librarian", "Librarian", "organization", "The library: catalog, lending and returns.", ["library.manage", "students.view"]),
    t("hostel_warden", "Hostel warden", "organization", "Hostel rooms, allotments and boarders' leave.", ["hostel.manage", "students.view", "leave.students"]),
  ],
  coaching: [
    t("center_head", "Center head", "organization", "Runs the institute: batches, faculty, tests, admissions and reports. Not settings or roles.", LEADERSHIP),
    t("batch_coordinator", "Batch coordinator", "group", "Keeps a batch on track: timetable, register, leave, parents and notices.", [
      "org.members.view", "students.view", "parents.view", "attendance.mark", "attendance.view", "timetable.manage", "leave.students", "notices.manage", "reports.view",
    ]),
    t("admissions_counselor", "Admissions counselor", "organization", "Enquiries and admissions: applications, new students and their parents.", [
      "admissions.manage", "students.manage", "parents.manage", "org.members.invite",
    ]),
    t("front_desk", "Front desk", "organization", "Welcomes people: members, students' details, notices.", [
      "org.members.view", "org.members.invite", "students.view", "parents.view", "notices.manage",
    ]),
    t("test_coordinator", "Test coordinator", "organization", "Tests and contests, their marks and results.", [
      "exams.manage", "contests.manage", "students.view", "reports.view", "notices.manage",
    ]),
  ],
  cohort: [
    t("teaching_assistant", "Teaching assistant", "group", "Helps mentors: grades work, takes attendance, answers in discussions.", [
      "org.members.view", "assignments.grade", "gradebook.view", "attendance.mark", "teaching.log",
    ]),
    t("curriculum_designer", "Curriculum designer", "organization", "Builds the program's content: problems, assignments, contests and outcomes.", [
      "problems.manage", "assignments.manage", "contests.manage", "org.outcomes.manage", "gradebook.view",
    ]),
    t("operations", "Operations", "organization", "Runs the program's logistics: learners, cohorts and pods, events and notices.", [
      "org.members.view", "org.members.invite", "org.members.manage", "org.members.import", "org.groups.manage", "attendance.view", "reports.view", "events.manage", "notices.manage",
    ]),
  ],
  company: [
    t("hr_partner", "HR partner", "organization", "People and progress: employees, imports, training reports.", [
      "org.members.view", "org.members.invite", "org.members.import", "gradebook.view", "reports.view", "attendance.view",
    ]),
    t("trainer", "Trainer", "organization", "Makes and runs training: courses' content, assessments, sessions and events.", [
      "problems.manage", "assignments.manage", "contests.manage", "gradebook.view", "teaching.log", "events.manage", "notices.manage",
    ]),
    t("compliance_officer", "Compliance officer", "organization", "Assigns compliance training and follows who's done, overdue or expiring.", [
      "assignments.manage", "gradebook.view", "reports.view", "org.audit.view", "org.members.view",
    ]),
    t("team_lead", "Team lead", "group", "Leads a team day to day: its training progress, notices and events.", [
      "org.members.view", "gradebook.view", "notices.manage", "events.manage", "attendance.mark",
    ]),
  ],
  community: [
    t("event_organizer", "Event organizer", "organization", "Plans the community's events and announces them.", ["events.manage", "notices.manage", "org.members.view"]),
    t("content_creator", "Content creator", "organization", "Writes problems and runs contests and challenges.", ["problems.manage", "contests.manage", "assignments.manage"]),
    t("membership_coordinator", "Membership coordinator", "organization", "Welcomes members, approves requests and looks after groups.", [
      "org.members.view", "org.members.invite", "org.members.manage", "org.groups.manage",
    ]),
  ],
  other: [
    t("coordinator", "Coordinator", "organization", "Runs things day to day: members, groups, notices, events and reports.", [
      "org.members.view", "org.members.invite", "org.groups.manage", "notices.manage", "events.manage", "reports.view", "attendance.view",
    ]),
    t("assistant", "Assistant", "group", "Helps in a group: grades work and takes attendance.", [
      "org.members.view", "assignments.grade", "gradebook.view", "attendance.mark",
    ]),
  ],
}

/** A kind's suggested roles: the platform's list for it, or the default. */
export function roleTemplatesFor(type: OrgType, stored?: unknown): RoleTemplate[] {
  const list = readRoleTemplates(stored)
  return list ?? ROLE_TEMPLATES[type]
}

/** A stored list, cleaned: known permissions only, keys unique; null when nothing usable. */
export function readRoleTemplates(stored: unknown): RoleTemplate[] | null {
  if (!Array.isArray(stored)) return null
  const seen = new Set<string>()
  const out: RoleTemplate[] = []
  for (const raw of stored) {
    if (!raw || typeof raw !== "object") continue
    const r = raw as Record<string, unknown>
    const key = typeof r.key === "string" ? r.key : ""
    const name = typeof r.name === "string" ? r.name.trim() : ""
    if (!/^[a-z0-9_]{2,40}$/.test(key) || !name || seen.has(key)) continue
    seen.add(key)
    out.push({
      key,
      name: name.slice(0, 60),
      description: typeof r.description === "string" ? r.description.slice(0, 300) : "",
      permissions: Array.isArray(r.permissions) ? [...new Set(r.permissions.filter((p): p is Permission => typeof p === "string" && isPermission(p)))] : [],
      scope: r.scope === "group" ? "group" : "organization",
    })
  }
  return out
}

