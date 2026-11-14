---
title: Class pages
description: Everything about one class in tabs (stream, classwork, course, discussion, people, grades, syllabus and log, outcomes and insights), for its teachers and its students.
glance:
  who:
    - role: Teacher
      note: everything about their class
    - role: Student
      note: their side of it
  where:
    path: /orgs/<slug>/classes/<group>
    menu: "Learn › My classes; Teach"
  permissions: [teaching.log, gradebook.view, attendance.mark]
  demo:
    as: a class teacher
    email: teacher@greenwood.demo.invalid
    path: /teach
---

A class is any group someone teaches, at any level. Its page gathers everything about it.

## The tabs

| Tab | What's there |
| --- | --- |
| Stream | Class notices, logged classes and new work |
| Classwork | Assignments and contests reaching the class, and its syllabus |
| Course | Its courses, and certificates for teachers |
| Discussion | Threads and replies (see [Discussions](/features/classes/discussions/)) |
| People | Who's in it |
| Grades | Marks, with **Needs attention** for teachers (see [Early warnings](/features/classes/early-warnings/)) |
| Syllabus and log | Topics, classes taught and attendance |
| Outcomes and Insights | Course outcomes and how the class is doing |

## How it works

- **What reaches a class:** work aimed at it, at a group above it ("From CSE") or a group inside it;
  organization-wide work reaches every class.
- **Who sees it:** teachers of the group see everything; students sitting in it see their side; anyone
  else gets "not found".
- **New assignment** and **New contest** from a class open the form aimed at it, and come back after
  saving.
- Teachers find their classes under **Teach** (`/teach`), with what's due this week and what's behind
  the syllabus first. Students find theirs under **My classes**.

## Related

- [Attendance](/features/daily/attendance/)
- [Assignments and the gradebook](/features/coding/assignments/)
