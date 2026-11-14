---
title: Assignments and the gradebook
description: Problem sets with open and due times, late penalties, rubrics, line comments, extensions, and a gradebook that's always worked out from submissions.
glance:
  who:
    - role: Teacher
      note: sets and grades work for their groups
    - role: Student
      note: does the work
  where:
    path: /orgs/<slug>/manage/assignments
    menu: "Manage › Assignments › Gradebook"
  permissions: [assignments.manage, assignments.grade, assignments.extend, gradebook.view, gradebook.export]
  module: coding
  demo:
    as: the school's owner
    email: owner@greenwood.demo.invalid
    path: /orgs/greenwood/manage/assignments
---

An assignment is a set of problems (and, if you like, quiz questions and GitHub projects) with an
opening time, a due time and an audience. Students solve its problems on the assignment's own pages,
and the gradebook works out everyone's marks from their submissions.

## How it works

- **Grades are computed, never stored.** Change the points, the due time or the late penalty and
  everyone is regraded at once.
- **What counts:** only graded submissions from the opening time on. Per problem, a student's best
  on-time result, or a better late one minus the penalty when late work is allowed. Partial credit
  comes from IOI-style scores.
- **The audience** decides who it's for: groups, combined ("3rd Year and CAC"). Anyone outside it gets
  "not found".
- **Only published problems** can be assigned, because students solve them on the normal problem
  pages. Problems written for the assignment stay out of the library.
- Students solve them at `/assignments/<slug>/problems/<n>`, numbered Q1, Q2, with only this
  assignment's problems in the list.

## Feedback

- **Rubrics:** each problem can have up to 20 criteria marked by hand; a problem is out of its test
  points plus its rubric's.
- **Line comments:** on any line of the student's submission, from the student's panel in the
  gradebook. Teachers keep reusable comments.
- **Hold feedback:** keeps rubric marks and comments from students, and out of their totals, until
  **Release feedback**.

## Step by step

### Set an assignment

1. **Manage › Assignments › New assignment** (or **New assignment** from a class, which aims it at that
   class).
2. Give it a title, opening and due times, and an audience.
3. Pick problems (and questions) with their points. **Write a problem** and **Import problems** are in
   the picker, so you don't leave the form.
4. Set late work and its penalty, then **Publish**.

### Grade and give feedback

1. Open the assignment's **Gradebook**. Every student in the audience is listed, including those who
   haven't started.
2. Click a student's cell to open their work in a side sheet: submissions, the live working copy and a
   playback of how the code was written.
3. Mark the rubric, select a line number to comment on it, and release feedback when you're ready.

### Give more time

**Extend** in the gradebook gives one student a later due time, for the whole assignment or only some
problems (reopening them after feedback is resubmission).

## Who sees what

| Who | Sees |
| --- | --- |
| Students in the audience | The assignment, its problems and their own marks |
| Teachers who set work for the audience | The gradebook, every student's code and drafts |
| Anyone else | "Not found" |

## Edge cases

- The gradebook leaves out people with teaching permissions.
- CSV exports quote every field and defuse spreadsheet formulas.
- A save made while someone else edited the same assignment is refused, with **Load their version** or
  **Keep mine**.

## Related

- [Quizzes and the question bank](/features/coding/quizzes/)
- [Lab exams](/features/coding/lab-exams/)
- [Problem file format](/problem-format/)
