---
title: Subjects
description: The organization's subjects, which classes take them, and who teaches each one there.
glance:
  who:
    - role: Academic coordinator
      note: keeps the subject list
    - role: Class teacher
      note: assigns subjects to their class
  where:
    path: /orgs/<slug>/manage/subjects
    menu: "Academics › Subjects"
  permissions: [subjects.manage, subjects.create, subjects.edit, subjects.delete, subjects.assign]
  module: subjects
  demo:
    as: the principal
    email: principal@greenwood.demo.invalid
    path: /orgs/greenwood/manage/subjects
---

Subjects (courses, in a college) are what classes study. The [timetable](/features/daily/timetable/),
exam papers and course-wise attendance all build on them.

## How it works

- A subject has a name and an optional code, unique in the organization (ignoring case). In a college
  it carries **credits** (whole or halves).
- **Each class takes some subjects,** each with its teacher there. The teacher must already be given
  teaching for that class.
- Deleting a subject takes it off every class.

## Step by step

1. **Academics › Subjects › Add subject.**
2. Open a subject and add it to classes, choosing who teaches it in each.

## Related

- [Timetable](/features/daily/timetable/)
- [Exams and report cards](/features/assessment/exams-and-report-cards/)
