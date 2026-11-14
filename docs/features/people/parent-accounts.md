---
title: Parent accounts
description: Parents linked to their children follow attendance, timetable, marks, the bus, library and notices, read-only, and are told when it matters.
glance:
  who:
    - role: Office staff
      note: links parents
    - role: Parent
      note: follows their child
  where:
    path: /orgs/<slug>/manage/parents
    menu: "People › Parents"
  permissions: [parents.manage, parents.view, parents.link]
  module: parents
  demo:
    as: a parent
    email: parent@greenwood.demo.invalid
    path: /children
---

A parent is linked to a student in one organization. The link is all they have: they aren't a member,
hold no role and see only that child, read-only.

## What parents see

Each child's page is built from the child's own pages, as the child, so a parent never sees more than
their child does: attendance, timetable, notices, work, marks and report cards, the bus, the hostel
room and library books. They find their children under **My children** (`/children`).

## What parents are told

- Copies of what their child is told about new work, marks, extensions, notices and teachers' notes.
- When their child is marked absent, for today or yesterday, once per register (not for a day on
  approved leave).

## Step by step

1. **People › Parents:** search for the student, then enter the parent's email (found, or invited like
  anyone else), and the relation.
2. Or paste a list (student email, parent email, name, relation) and read the report line by line.

## Edge cases

- Not their child, or the module off, answers "not found".
- Linking and unlinking are scoped to the students' groups and logged.

## Related

- [Leave](/features/daily/leave/)
- [Admissions](/features/people/admissions/)
