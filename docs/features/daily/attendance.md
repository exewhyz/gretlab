---
title: Attendance
description: A register per class, day and period (and course, for colleges), with present, absent, late and excused, and the minimum to sit exams.
glance:
  who:
    - role: Teacher
      note: their own classes
    - role: Owner and admin
      note: every class
    - role: Student
      note: their own figures
    - role: Parent
      note: their child's
  where:
    path: /orgs/<slug>/manage/attendance
    menu: "Every day › Attendance"
  permissions: [attendance.mark, attendance.view]
  module: attendance
  demo:
    as: a class teacher
    email: teacher@greenwood.demo.invalid
    path: /orgs/greenwood/manage/attendance
---

A **register** is taken for a class on a day, for a period or the whole day. Every page that talks
about attendance (homes, the class page, early warnings, parents' alerts, reports) reads these
records.

## How it works

- **Four marks:** present, absent, late and excused. Late counts as present; **excused is left out of
  every percentage**.
- **One register per class, day and period** (and course, for colleges). Saving again replaces the
  marks and is logged as a correction.
- Attendance taken while logging a class goes into the same records, so both count.
- **Below 75%** shows in red to the teacher and the student, once four classes are marked.

## By course (colleges)

A register can be for one of the courses the class takes. The **minimum to sit exams** (75% by
default, set on the report's **By course** tab) is checked per course over the current term: each
student is eligible, at risk (within five points) or short, with how many classes in a row they need
to reach it. Students see this on their home as **Attendance by course**.

## Step by step

### Take today's register

1. **Every day › Attendance** and pick the class (and period, or course).
2. Everyone starts present. Mark the absent, late and excused; students on approved
   [leave](/features/daily/leave/) start as excused, tagged **On leave**.
3. **Save.** Parents of children newly marked absent today or yesterday are told once.

### Follow the month

**Reports › Attendance report** shows each class by month (late counts, excused left out) and, for
colleges, the **By course** tab.

## Who sees what

| Who | Sees |
| --- | --- |
| Teachers with "Take attendance" for a class | Its register |
| Anyone with "See attendance" for a class | Its registers and reports |
| A student | Only their own figures, on the class page and their home |
| A parent | Their child's, on the child's page |

## Edge cases

- A register can't be taken for a day that hasn't come, or for anyone who isn't a student of the class.
- No register is expected on a [day off](/start-here/glossary/#day-off): a holiday or a day outside the
  school days.
- With the module off, the pages and API answer "not found" and the menu hides it.

## Related

- [Leave](/features/daily/leave/)
- [Timetable](/features/daily/timetable/)
