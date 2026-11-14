---
title: Courses
description: Modules of library problems and questions with release rules, given to classes from a start day; practice that's never graded.
glance:
  who:
    - role: Teacher
      note: gives courses to their classes
    - role: Student
      note: works through the modules
  where:
    path: /orgs/<slug>/manage/courses
    menu: "Academics › Courses; a class's Course tab"
  permissions: [assignments.manage]
---

A course is an ordered outline of modules, each an ordered list of library problems and questions,
for practice nobody marks.

## How it works

- **What a course may hold:** public library problems, other ready problems the owner may use, and
  questions that mark themselves. Drafts, assessment-only problems and written questions are refused.
- **Given to a class from a start day.** A module opens a number of days after the start, and, if set,
  only once the student finished the module before.
- **Progress is computed:** a problem is done with an accepted submission, a question with a right
  answer (tries again allowed; the answer shows once right or after three tries).
- **Platform courses** are shared with organizations; an organization gives them to classes, or copies
  one to change it.

## Step by step

1. **Academics › Courses › New course:** add modules, and open each to choose its items.
2. On a class's **Course** tab, give it a course and a start day.
3. Teachers see every module and how many finished; students see modules as they open.

## Edge cases

- A course in use can't be deleted; taking it off a class keeps students' work.

## Related

- [Certificates](/features/classes/certificates/)
- [The content library](/features/coding/content-library/)
