---
title: Peer review
description: Students review classmates' final code against the rubric, with line comments, anonymously if chosen; it never changes marks.
glance:
  who:
    - role: Teacher
      note: starts and reads reviews
    - role: Student
      note: writes and receives reviews
  where:
    path: /orgs/<slug>/manage/assignments
    menu: "Coding lab › Assignments › Gradebook › Start peer review"
  permissions: [assignments.manage, gradebook.view]
  module: coding
---

An assignment (not an exam) can have peer review: how many reviews each student writes, whether it's
anonymous, and an optional review due time.

## How it works

- **After the due time,** the teacher presses **Start peer review** in the gradebook, once.
- **Pairing:** per problem, everyone with a graded submission reviews the set number of others, in a
  shuffled ring: never themselves, and everyone gives and gets the same number.
- **A review** scores each rubric criterion (or one Overall out of 5), comments on lines of the code
  and sums up. Drafts may be partial; handing in needs every score and a summary.
- **Anonymous** means reviewers are "Classmate N" and authors "Reviewer N", both ways.
- Peer review never changes marks.

## Who sees what

Authors see handed-in reviews of their work. Teachers see every review with names and scores, and can
hide one from its author.

## Related

- [Assignments and the gradebook](/features/coding/assignments/)
